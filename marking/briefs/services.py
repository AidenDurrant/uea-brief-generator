"""The assessment-brief workflow, ported from the Supabase functions.

Each function here replaces one Postgres RPC, trigger or RLS policy from
supabase/migrations/. Validation order and the exact message strings are
preserved, because the React pages display those messages verbatim.

Two things Postgres did for free have to be done by hand:

* Row-level security. Every SELECT policy became a queryset helper
  (`visible_assessments`, `can_access_assessment`) and every mutating function
  re-checks object-level permission itself. Both halves matter -- a reader that
  is stricter than its writer, or looser, is the bug this port is most likely
  to introduce.
* The app.workflow_transition GUC that stopped clients writing `version`,
  `status`, `submitted_at` and `approved_at` directly. There is no equivalent
  here; instead those four names never appear in an API payload, and only the
  functions below assign them.

Errors map straight onto the SQL errcodes: 42501 -> PermissionDenied (403),
22023 -> ValidationError (400).
"""

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import connection, transaction
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone

from web.models import Supervisor

from .models import (
    BRIEF_FIELDS,
    ROLE_ADMIN,
    ROLE_CLUSTER_LEAD,
    ROLE_TEACHING_DIRECTOR,
    STAGE_CHECKER,
    STAGE_CLUSTER_LEAD,
    STAGES,
    WORKFLOW_ROLES,
    Assessment,
    BriefRole,
    ClusterLeadScope,
    ReviewAssignment,
    ReviewEvent,
    normalise_programme,
)

OVERSIGHT_REQUIRED = 'Administrator or Teaching Director access required'


def _locked(queryset):
    """`SELECT ... FOR UPDATE` where the backend has it (Postgres), plain otherwise.

    SQLite, used for local development, serialises writers across the whole
    database, so dropping the row lock there changes nothing.
    """
    if connection.features.has_select_for_update:
        return queryset.select_for_update()
    return queryset


# -----------------------------------------------------------------------------
# Authorization helpers -- were private.workflow_* plus the RLS SELECT policies
# -----------------------------------------------------------------------------

def has_oversight(supervisor):
    """Administrator or Teaching Director: may read and administer everything."""
    if supervisor is None:
        return False
    return BriefRole.objects.filter(
        supervisor=supervisor, role__in=[ROLE_ADMIN, ROLE_TEACHING_DIRECTOR]
    ).exists()


def is_admin(supervisor):
    if supervisor is None:
        return False
    return BriefRole.objects.filter(supervisor=supervisor, role=ROLE_ADMIN).exists()


def cluster_lead_scope_matches(supervisor, programme, module_level):
    """Does this cluster lead's scope cover this programme and level?"""
    key = normalise_programme(programme)
    if key is None or module_level is None:
        return False
    if not BriefRole.objects.filter(
        supervisor=supervisor, role=ROLE_CLUSTER_LEAD
    ).exists():
        return False
    return ClusterLeadScope.objects.filter(
        supervisor=supervisor, programme_key=key, module_level=module_level
    ).exists()


def user_can_review(supervisor, assessment, stage):
    """Stage eligibility, deliberately independent of stage ordering.

    A cluster lead can therefore see a brief queued behind its checker without
    yet being able to act on it -- `stage_is_actionable` is the separate gate.
    """
    if supervisor is None or assessment is None or stage not in STAGES:
        return False
    if assessment.owner_id == supervisor.pk:
        return False
    if stage == STAGE_CHECKER:
        return assessment.checker_id == supervisor.pk
    # Cluster lead. Keeps the two stages in different hands: the nominated
    # checker cannot also sign off as cluster lead.
    if assessment.checker_id is not None and assessment.checker_id == supervisor.pk:
        return False
    return cluster_lead_scope_matches(
        supervisor, assessment.programme, assessment.module_level
    )


def stage_is_actionable(assessment, stage, assignments=None):
    """Stage ordering: setter -> checker -> cluster lead.

    The checker stage opens as soon as the brief is submitted; the cluster lead
    stage only opens once the checker has approved the version currently on the
    table. `assignments` may be a pre-fetched {stage: ReviewAssignment} map so
    callers building a queue do not re-query per row.
    """
    if stage == STAGE_CHECKER:
        return True
    if stage != STAGE_CLUSTER_LEAD:
        return False
    if assignments is None:
        checker = ReviewAssignment.objects.filter(
            assessment=assessment, stage=STAGE_CHECKER
        ).first()
    else:
        checker = assignments.get(STAGE_CHECKER)
    return bool(
        checker
        and checker.state == 'approved'
        and checker.reviewer_id is not None
        and checker.reviewed_version == assessment.version
    )


def can_access_assessment(supervisor, assessment):
    """The read side of the assessment RLS policies, for one row."""
    if supervisor is None or assessment is None:
        return False
    if assessment.owner_id == supervisor.pk:
        return True
    if has_oversight(supervisor):
        return True
    return assessment.status != 'draft' and any(
        user_can_review(supervisor, assessment, stage) for stage in STAGES
    )


def visible_assessments(supervisor):
    """The read side of the assessment RLS policies, as a queryset.

    Kept deliberately in step with `can_access_assessment`: owner, oversight, or
    an eligible reviewer of a brief that has left draft.
    """
    if supervisor is None:
        return Assessment.objects.none()
    if has_oversight(supervisor):
        return Assessment.objects.all()

    visible = Q(owner=supervisor)
    # Nominated checker of a submitted brief.
    visible |= ~Q(status='draft') & Q(checker=supervisor) & ~Q(owner=supervisor)

    if BriefRole.objects.filter(
        supervisor=supervisor, role=ROLE_CLUSTER_LEAD
    ).exists():
        scope_q = Q()
        matched = False
        for scope in ClusterLeadScope.objects.filter(supervisor=supervisor):
            scope_q |= Q(
                programme_key=scope.programme_key, module_level=scope.module_level
            )
            matched = True
        if matched:
            visible |= (
                ~Q(status='draft')
                & ~Q(owner=supervisor)
                & (Q(checker__isnull=True) | ~Q(checker=supervisor))
                & scope_q
            )

    return Assessment.objects.filter(visible)


def require_oversight(supervisor):
    if not has_oversight(supervisor):
        raise PermissionDenied(OVERSIGHT_REQUIRED)


# -----------------------------------------------------------------------------
# Serialisation -- the shapes the React pages already consume
# -----------------------------------------------------------------------------

def _iso(value):
    return value.isoformat() if value else None


def _pk_str(value):
    return str(value) if value is not None else None


def _name(supervisor):
    return supervisor.dn if supervisor else None


def serialize_assessment(assessment):
    return {
        'id': str(assessment.id),
        'owner_id': _pk_str(assessment.owner_id),
        'checker_id': _pk_str(assessment.checker_id),
        'title': assessment.title,
        'module_code': assessment.module_code,
        'academic_year': assessment.academic_year,
        'assessment_type': assessment.assessment_type,
        'ai_policy': assessment.ai_policy,
        'group_work_permitted': assessment.group_work_permitted,
        'status': assessment.status,
        'content': assessment.content,
        'programme': assessment.programme,
        'module_level': assessment.module_level,
        'version': assessment.version,
        'submitted_at': _iso(assessment.submitted_at),
        'approved_at': _iso(assessment.approved_at),
        'created_at': _iso(assessment.created_at),
        'updated_at': _iso(assessment.updated_at),
    }


def serialize_assignment(assignment):
    return {
        'assessment_id': str(assignment.assessment_id),
        'stage': assignment.stage,
        'reviewer_id': _pk_str(assignment.reviewer_id),
        'assigned_by': _pk_str(assignment.assigned_by_id),
        'state': assignment.state,
        'reviewed_version': assignment.reviewed_version,
        'comment': assignment.comment,
        'reviewed_at': _iso(assignment.reviewed_at),
        'overridden_by': _pk_str(assignment.overridden_by_id),
        'assigned_at': _iso(assignment.assigned_at),
        'updated_at': _iso(assignment.updated_at),
    }


def serialize_event(event):
    return {
        'id': event.id,
        'assessment_id': str(event.assessment_id),
        'assessment_version': event.assessment_version,
        'stage': event.stage,
        'reviewer_id': _pk_str(event.reviewer_id),
        'actor_id': _pk_str(event.actor_id),
        'action': event.action,
        'comment': event.comment,
        'created_at': _iso(event.created_at),
    }


def _stage_order(stage):
    return STAGES.index(stage) if stage in STAGES else len(STAGES)


# -----------------------------------------------------------------------------
# Saving a brief -- was the prepare_assessment_version_update trigger
# -----------------------------------------------------------------------------

def _clean_brief_fields(payload):
    """Pull the nine brief fields out of an API payload, with the SQL's coercions."""
    programme = payload.get('programme')
    if programme is not None:
        programme = str(programme).strip() or None

    module_level = payload.get('module_level')
    if module_level not in (None, ''):
        try:
            module_level = int(module_level)
        except (TypeError, ValueError):
            raise ValidationError('Module level must be a whole number')
    else:
        module_level = None

    content = payload.get('content')
    if content is None:
        content = {}

    return {
        'title': str(payload.get('title') or ''),
        'module_code': str(payload.get('module_code') or ''),
        'academic_year': str(payload.get('academic_year') or ''),
        'assessment_type': str(payload.get('assessment_type') or ''),
        'ai_policy': str(payload.get('ai_policy') or ''),
        'group_work_permitted': bool(payload.get('group_work_permitted')),
        'content': content,
        'programme': programme,
        'module_level': module_level,
    }


def _resolve_checker(checker_id):
    if checker_id in (None, ''):
        return None
    try:
        return Supervisor.objects.get(pk=int(checker_id))
    except (Supervisor.DoesNotExist, TypeError, ValueError):
        raise ValidationError('The selected checker must be a registered user')


@transaction.atomic
def save_brief(supervisor, assessment_id, payload):
    """Create or update a brief, applying the version/status rules.

    Editing the brief itself sends a reviewed assessment back to draft on a new
    version; editing anything else leaves the workflow alone.
    """
    fields = _clean_brief_fields(payload)
    checker = _resolve_checker(payload.get('checker_id'))
    if checker is not None and checker.pk == supervisor.pk:
        raise ValidationError('You cannot nominate yourself as the checker')

    if not assessment_id:
        return Assessment.objects.create(
            owner=supervisor,
            checker=checker,
            programme_key=normalise_programme(fields['programme']),
            version=1,
            status='draft',
            submitted_at=None,
            approved_at=None,
            **fields,
        )

    existing = _locked(Assessment.objects.filter(pk=assessment_id)).first()
    if existing is None or existing.owner_id != supervisor.pk:
        raise PermissionDenied('Assessment owner access required')

    # jsonb equality is key-order-insensitive, and so is comparing parsed dicts.
    brief_changed = any(
        getattr(existing, field) != fields[field] for field in BRIEF_FIELDS
    )
    checker_changed = existing.checker_id != (checker.pk if checker else None)

    # The nominated checker is fixed for the duration of a review round. Editing
    # the brief sends it back to draft, so a save that also bumps the version may
    # re-nominate; a bare checker swap mid-review may not.
    if checker_changed and existing.status != 'draft' and not brief_changed:
        raise PermissionDenied(
            'The checker can only be changed while the assessment is a draft'
        )

    previous_version = existing.version
    for field, value in fields.items():
        setattr(existing, field, value)
    existing.checker = checker
    existing.programme_key = normalise_programme(existing.programme)

    version_bumped = False
    if brief_changed and existing.status != 'draft':
        existing.version = previous_version + 1
        existing.status = 'draft'
        existing.submitted_at = None
        existing.approved_at = None
        version_bumped = True

    existing.save()

    if version_bumped:
        invalidate_reviews(existing, supervisor, previous_version)

    return existing


def invalidate_reviews(assessment, actor, previous_version):
    """Void every decision on an assessment whose brief just changed.

    In Postgres this was an AFTER UPDATE OF version trigger, which the client
    could never actually fire (it was not granted UPDATE on `version`), so the
    audit event was silently never written. The intent is what is ported here:
    the caller invokes this whenever it bumps the version.
    """
    ReviewAssignment.objects.filter(assessment=assessment, stage=STAGE_CHECKER).update(
        # The setter's checker nomination survives so the brief can be
        # resubmitted without re-picking.
        reviewer_id=assessment.checker_id,
        assigned_by_id=assessment.owner_id,
        state='pending',
        reviewed_version=None,
        comment=None,
        reviewed_at=None,
        overridden_by=None,
    )
    ReviewAssignment.objects.filter(
        assessment=assessment, stage=STAGE_CLUSTER_LEAD
    ).update(
        reviewer=None,
        assigned_by=None,
        state='pending',
        reviewed_version=None,
        comment=None,
        reviewed_at=None,
        overridden_by=None,
    )

    ReviewEvent.objects.create(
        assessment_id=assessment.id,
        assessment_version=assessment.version,
        actor_id=actor.pk if actor else None,
        action='invalidated',
        comment=(
            f'Assessment brief changed; version {previous_version} reviews were '
            f'invalidated by version {assessment.version}'
        ),
    )


@transaction.atomic
def delete_brief(supervisor, assessment_id):
    assessment = Assessment.objects.filter(pk=assessment_id).first()
    if assessment is None or assessment.owner_id != supervisor.pk:
        raise PermissionDenied('Assessment owner access required')
    assessment.delete()


# -----------------------------------------------------------------------------
# Workflow RPCs
# -----------------------------------------------------------------------------

@transaction.atomic
def submit_for_review(supervisor, assessment_id):
    assessment = _locked(Assessment.objects.filter(pk=assessment_id)).first()
    if assessment is None or assessment.owner_id != supervisor.pk:
        raise PermissionDenied('Assessment owner access required')

    if assessment.status != 'draft':
        raise ValidationError('Only draft assessments can be submitted for review')

    if assessment.programme is None or assessment.module_level is None:
        raise ValidationError(
            'Programme and module level are required before submission'
        )

    if assessment.checker_id is None:
        raise ValidationError('Select a checker before submitting for approval')

    if assessment.checker_id == assessment.owner_id:
        raise ValidationError('You cannot nominate yourself as the checker')

    if not Supervisor.objects.filter(pk=assessment.checker_id).exists():
        raise ValidationError('The selected checker must be a registered user')

    programme_key = normalise_programme(assessment.programme)
    cluster_lead_available = (
        ClusterLeadScope.objects.filter(
            programme_key=programme_key,
            module_level=assessment.module_level,
            supervisor__brief_roles__role=ROLE_CLUSTER_LEAD,
        )
        .exclude(supervisor_id=assessment.owner_id)
        .exclude(supervisor_id=assessment.checker_id)
        .exists()
    )
    if not cluster_lead_available:
        raise ValidationError(
            'A cluster lead scoped to this programme and level, other than you '
            'and your chosen checker, is required'
        )

    # The checker is known up front because the setter nominates them. The
    # cluster lead is whichever scoped role-holder picks the brief up.
    now = timezone.now()
    for stage in STAGES:
        is_checker_stage = stage == STAGE_CHECKER
        ReviewAssignment.objects.update_or_create(
            assessment=assessment,
            stage=stage,
            defaults={
                'reviewer_id': assessment.checker_id if is_checker_stage else None,
                'assigned_by_id': supervisor.pk if is_checker_stage else None,
                'state': 'pending',
                'reviewed_version': None,
                'comment': None,
                'reviewed_at': None,
                # A pending stage has not been overridden. Unreachable in
                # practice -- an override approves the brief, and getting back to
                # draft goes through invalidate_reviews -- but leaving the marker
                # set on a pending row would misattribute the next decision.
                'overridden_by': None,
                'assigned_at': now,
            },
        )

    submitted_version = assessment.version
    assessment.status = 'in_review'
    assessment.submitted_at = now
    assessment.approved_at = None
    assessment.save(update_fields=['status', 'submitted_at', 'approved_at', 'updated_at'])

    ReviewEvent.objects.create(
        assessment_id=assessment.id,
        assessment_version=submitted_version,
        actor_id=supervisor.pk,
        action='submitted',
    )


def assessment_review_status(supervisor, assessment_id):
    assessment = Assessment.objects.filter(pk=assessment_id).first()
    if assessment is None or not can_access_assessment(supervisor, assessment):
        raise PermissionDenied('Assessment review access required')

    assignments = list(
        ReviewAssignment.objects.filter(assessment=assessment).select_related(
            'reviewer', 'overridden_by'
        )
    )
    by_stage = {assignment.stage: assignment for assignment in assignments}
    assignments.sort(key=lambda assignment: _stage_order(assignment.stage))

    return [
        {
            'stage': assignment.stage,
            'reviewer_id': _pk_str(assignment.reviewer_id),
            'reviewer_name': _name(assignment.reviewer),
            'state': assignment.state,
            'reviewed_version': assignment.reviewed_version,
            'comment': assignment.comment,
            'reviewed_at': _iso(assignment.reviewed_at),
            'awaiting_previous_stage': not stage_is_actionable(
                assessment, assignment.stage, by_stage
            ),
            'overridden_by': _pk_str(assignment.overridden_by_id),
            'overridden_by_name': _name(assignment.overridden_by),
        }
        for assignment in assignments
    ]


def can_export_final(supervisor, assessment_id):
    assessment = Assessment.objects.filter(pk=assessment_id).first()
    if assessment is None or assessment.owner_id != supervisor.pk:
        raise PermissionDenied('Only the assessment owner can export the final brief')

    if assessment.status != 'approved':
        return False

    approved_stages = set(
        ReviewAssignment.objects.filter(
            assessment=assessment,
            stage__in=STAGES,
            state='approved',
            reviewer__isnull=False,
            reviewed_version=assessment.version,
        ).values_list('stage', flat=True)
    )
    return len(approved_stages) == len(STAGES)


def review_queue(supervisor):
    """One row per (assessment, stage) the caller may see, newest submission first."""
    oversight = has_oversight(supervisor)
    if oversight:
        assessments = list(
            Assessment.objects.select_related('owner', 'checker').all()
        )
    else:
        assessments = list(
            visible_assessments(supervisor)
            .exclude(status='draft')
            .exclude(owner=supervisor)
            .select_related('owner', 'checker')
        )

    assignments_by_assessment = {}
    for assignment in ReviewAssignment.objects.filter(
        assessment__in=assessments
    ):
        assignments_by_assessment.setdefault(assignment.assessment_id, {})[
            assignment.stage
        ] = assignment

    rows = []
    for assessment in assessments:
        stage_assignments = assignments_by_assessment.get(assessment.id, {})
        for stage in STAGES:
            eligible = user_can_review(supervisor, assessment, stage)
            if not oversight and not (assessment.status != 'draft' and eligible):
                continue

            assignment = stage_assignments.get(stage)
            actionable = stage_is_actionable(assessment, stage, stage_assignments)
            rows.append(
                {
                    'assessment_id': str(assessment.id),
                    'title': assessment.title,
                    'module_code': assessment.module_code,
                    'owner_id': _pk_str(assessment.owner_id),
                    'owner_name': _name(assessment.owner),
                    'checker_id': _pk_str(assessment.checker_id),
                    'checker_name': _name(assessment.checker),
                    'stage': stage,
                    'reviewer_id': _pk_str(assignment.reviewer_id)
                    if assignment
                    else None,
                    'state': assignment.state if assignment else 'pending',
                    'assessment_version': assessment.version,
                    'reviewed_version': assignment.reviewed_version
                    if assignment
                    else None,
                    'comment': assignment.comment if assignment else None,
                    'submitted_at': _iso(assessment.submitted_at),
                    'status': assessment.status,
                    'content': assessment.content,
                    'updated_at': _iso(assessment.updated_at),
                    'can_review': (
                        assessment.status in ('in_review', 'approved')
                        and eligible
                        and actionable
                    ),
                    'awaiting_previous_stage': not actionable,
                }
            )

    # submitted_at desc nulls last, then updated_at desc, then stage order.
    # Applied as chained stable sorts, least significant key first. Timestamps
    # are ISO-8601 strings here, which sort correctly as text.
    rows.sort(key=lambda row: _stage_order(row['stage']))
    rows.sort(key=lambda row: row['updated_at'] or '', reverse=True)
    rows.sort(
        key=lambda row: (row['submitted_at'] is not None, row['submitted_at'] or ''),
        reverse=True,
    )
    return rows


@transaction.atomic
def record_review(supervisor, assessment_id, stage, decision, comment=None):
    if stage not in STAGES:
        raise ValidationError(f'Invalid review stage: {stage}')

    normalized_decision = (decision or '').strip().lower()
    if normalized_decision not in ('approve', 'withdraw'):
        raise ValidationError('Decision must be approve or withdraw')

    normalized_comment = (comment or '').strip() or None
    if normalized_decision == 'withdraw' and (
        normalized_comment is None or len(normalized_comment) < 2
    ):
        raise ValidationError(
            'A withdrawal comment of at least 2 characters is required'
        )

    assessment = _locked(Assessment.objects.filter(pk=assessment_id)).first()
    if assessment is None:
        raise ValidationError(f'Assessment not found: {assessment_id}')

    if assessment.status not in ('in_review', 'approved'):
        raise ValidationError('Assessment is not available for review')

    if supervisor.pk == assessment.owner_id:
        raise PermissionDenied('Assessment owners cannot review their own assessment')

    if not user_can_review(supervisor, assessment, stage):
        raise PermissionDenied('Reviewer role and scope eligibility required')

    # setter -> checker -> cluster lead: the cluster lead cannot act until the
    # checker has approved the version currently under review.
    if not stage_is_actionable(assessment, stage):
        raise ValidationError(
            'This stage is waiting on the checker to approve the current version'
        )

    assignment = _locked(
        ReviewAssignment.objects.filter(assessment=assessment, stage=stage)
    ).first()
    if assignment is None:
        raise ValidationError('Assessment stage is not pending review')

    if (
        normalized_decision == 'approve'
        and assignment.state == 'approved'
        and assignment.reviewed_version == assessment.version
    ):
        raise ValidationError('This stage is already approved for the current version')

    now = timezone.now()
    assignment.reviewer = supervisor
    assignment.reviewed_version = assessment.version
    assignment.comment = normalized_comment
    assignment.reviewed_at = now

    if normalized_decision == 'withdraw':
        assignment.state = 'changes_requested'
        assignment.save()

        assessment.status = 'changes_requested'
        assessment.approved_at = None
        assessment.save(update_fields=['status', 'approved_at', 'updated_at'])

        ReviewEvent.objects.create(
            assessment_id=assessment.id,
            assessment_version=assessment.version,
            stage=stage,
            reviewer_id=supervisor.pk,
            actor_id=supervisor.pk,
            action='withdrawn',
            comment=normalized_comment,
        )
        return

    assignment.state = 'approved'
    assignment.save()

    ReviewEvent.objects.create(
        assessment_id=assessment.id,
        assessment_version=assessment.version,
        stage=stage,
        reviewer_id=supervisor.pk,
        actor_id=supervisor.pk,
        action='approved',
        comment=normalized_comment,
    )

    approved_stages = set(
        ReviewAssignment.objects.filter(
            assessment=assessment,
            stage__in=STAGES,
            state='approved',
            reviewer__isnull=False,
            reviewed_version=assessment.version,
        ).values_list('stage', flat=True)
    )
    all_approved = len(approved_stages) == len(STAGES)
    assessment.status = 'approved' if all_approved else 'in_review'
    assessment.approved_at = now if all_approved else None
    assessment.save(update_fields=['status', 'approved_at', 'updated_at'])


@transaction.atomic
def admin_override(supervisor, assessment_id, reason):
    """Force-approve both stages of one assessment.

    Writes through the existing approval records rather than adding a parallel
    bypass, so every downstream gate keeps working unmodified.
    """
    require_oversight(supervisor)

    # The reason lands in the permanent audit log, so it is not optional.
    normalized_reason = (reason or '').strip() or None
    if normalized_reason is None or len(normalized_reason) < 2:
        raise ValidationError(
            'An override reason of at least 2 characters is required'
        )

    # Locked before the assignment write, mirroring record_review, so a
    # concurrent save cannot bump the version underneath the approval.
    assessment = _locked(Assessment.objects.filter(pk=assessment_id)).first()
    if assessment is None:
        raise ValidationError(f'Assessment not found: {assessment_id}')

    now = timezone.now()
    overridden_stages = []
    for stage in STAGES:
        assignment = ReviewAssignment.objects.filter(
            assessment=assessment, stage=stage
        ).first()
        # A genuine sign-off at this version is preserved rather than
        # overwritten, which also keeps the audit log to the stages bypassed.
        if (
            assignment is not None
            and assignment.state == 'approved'
            and assignment.reviewed_version == assessment.version
        ):
            continue

        ReviewAssignment.objects.update_or_create(
            assessment=assessment,
            stage=stage,
            defaults={
                'reviewer': supervisor,
                'assigned_by': supervisor,
                'state': 'approved',
                'reviewed_version': assessment.version,
                'comment': normalized_reason,
                'reviewed_at': now,
                'overridden_by': supervisor,
            },
        )
        overridden_stages.append(stage)

    if not overridden_stages:
        raise ValidationError(
            'This assessment is already fully approved for the current version'
        )

    ReviewEvent.objects.bulk_create(
        [
            ReviewEvent(
                assessment_id=assessment.id,
                assessment_version=assessment.version,
                stage=stage,
                reviewer_id=supervisor.pk,
                actor_id=supervisor.pk,
                action='overridden',
                comment=normalized_reason,
            )
            for stage in overridden_stages
        ]
    )

    assessment.status = 'approved'
    # An overridden draft was never submitted, so give it a submission time.
    assessment.submitted_at = assessment.submitted_at or now
    assessment.approved_at = now
    assessment.save(update_fields=['status', 'submitted_at', 'approved_at', 'updated_at'])


# -----------------------------------------------------------------------------
# Administration RPCs
# -----------------------------------------------------------------------------

def _directory():
    return Supervisor.objects.all().order_by(Lower('dn'), 'id')


def admin_list_users(supervisor):
    require_oversight(supervisor)
    admins = set(
        BriefRole.objects.filter(role=ROLE_ADMIN).values_list(
            'supervisor_id', flat=True
        )
    )
    return [
        {
            'user_id': str(person.pk),
            'display_name': person.dn,
            'is_admin': person.pk in admins,
        }
        for person in _directory()
    ]


def admin_promote_user(supervisor, target_id):
    require_oversight(supervisor)
    target = _require_supervisor(
        target_id, f'Cannot promote user without an existing profile: {target_id}'
    )
    BriefRole.objects.get_or_create(
        supervisor=target,
        role=ROLE_ADMIN,
        defaults={'assigned_by': supervisor},
    )


@transaction.atomic
def admin_demote_user(supervisor, target_id):
    require_oversight(supervisor)
    if target_id in (None, ''):
        raise ValidationError('Administrator user is required')

    # Replaces the advisory lock: serialises the count against a concurrent
    # demotion, so the last administrator cannot be removed twice over.
    admin_roles = list(
        _locked(BriefRole.objects.filter(role=ROLE_ADMIN).order_by('pk'))
    )

    # Check order matters and is deliberately odd: demoting someone who is not
    # an administrator is a no-op, not an error, even for yourself.
    target_role = next(
        (role for role in admin_roles if str(role.supervisor_id) == str(target_id)),
        None,
    )
    if target_role is None:
        return

    if str(target_id) == str(supervisor.pk):
        raise ValidationError('You cannot demote your own administrator account')

    if len(admin_roles) <= 1:
        raise ValidationError('The final administrator cannot be demoted')

    target_role.delete()


def admin_review_workflow_users(supervisor):
    require_oversight(supervisor)
    roles = {}
    for role in BriefRole.objects.filter(role__in=WORKFLOW_ROLES):
        roles.setdefault(role.supervisor_id, set()).add(role.role)

    return [
        {
            'user_id': str(person.pk),
            'display_name': person.dn,
            'cluster_lead': ROLE_CLUSTER_LEAD in roles.get(person.pk, ()),
            'teaching_director': ROLE_TEACHING_DIRECTOR in roles.get(person.pk, ()),
        }
        for person in _directory()
    ]


@transaction.atomic
def admin_set_workflow_role(supervisor, target_id, role, enabled):
    require_oversight(supervisor)

    if role not in WORKFLOW_ROLES:
        raise ValidationError(f'Invalid workflow role: {role}')

    if not isinstance(enabled, bool):
        raise ValidationError('enabled must be true or false')

    target = _require_supervisor(
        target_id,
        f'Cannot set workflow role without an existing profile: {target_id}',
    )

    if enabled:
        BriefRole.objects.update_or_create(
            supervisor=target,
            role=role,
            defaults={'assigned_by': supervisor},
        )
        return

    if role == ROLE_CLUSTER_LEAD:
        ClusterLeadScope.objects.filter(supervisor=target).delete()
    BriefRole.objects.filter(supervisor=target, role=role).delete()


def admin_review_assignments(supervisor):
    require_oversight(supervisor)
    assignments = list(
        ReviewAssignment.objects.select_related('reviewer', 'overridden_by').all()
    )
    assignments.sort(
        key=lambda assignment: (
            str(assignment.assessment_id),
            _stage_order(assignment.stage),
        )
    )
    return [
        {
            'assessment_id': str(assignment.assessment_id),
            'stage': assignment.stage,
            'reviewer_id': _pk_str(assignment.reviewer_id),
            'reviewer_name': _name(assignment.reviewer),
            'state': assignment.state,
            'reviewed_version': assignment.reviewed_version,
            'comment': assignment.comment,
            'reviewed_at': _iso(assignment.reviewed_at),
            'overridden_by': _pk_str(assignment.overridden_by_id),
            'overridden_by_name': _name(assignment.overridden_by),
        }
        for assignment in assignments
    ]


def admin_cluster_lead_scopes(supervisor):
    require_oversight(supervisor)
    scopes = ClusterLeadScope.objects.select_related('supervisor').order_by(
        'programme_key', 'module_level', 'supervisor_id'
    )
    return [
        {
            'user_id': str(scope.supervisor_id),
            'display_name': scope.supervisor.dn,
            'programme': scope.programme,
            'module_level': scope.module_level,
            'assigned_by': _pk_str(scope.assigned_by_id),
            'created_at': _iso(scope.created_at),
        }
        for scope in scopes
    ]


@transaction.atomic
def admin_set_cluster_lead_scope(
    supervisor, target_id, programme, module_level, enabled
):
    require_oversight(supervisor)

    normalized_programme = (programme or '').strip() or None
    try:
        module_level = int(module_level) if module_level is not None else None
    except (TypeError, ValueError):
        module_level = None
    try:
        target_id = int(target_id) if target_id not in (None, '') else None
    except (TypeError, ValueError):
        target_id = None

    if target_id is None or normalized_programme is None or module_level is None:
        raise ValidationError('User, programme, and module level are required')

    if not isinstance(enabled, bool):
        raise ValidationError('enabled must be true or false')

    if enabled and not BriefRole.objects.filter(
        supervisor_id=target_id, role=ROLE_CLUSTER_LEAD
    ).exists():
        raise ValidationError('User must hold the cluster_lead role')

    target = _require_supervisor(
        target_id, 'User, programme, and module level are required'
    )

    programme_key = normalise_programme(normalized_programme)
    if enabled:
        ClusterLeadScope.objects.update_or_create(
            supervisor=target,
            programme_key=programme_key,
            module_level=module_level,
            defaults={
                'programme': normalized_programme,
                'assigned_by': supervisor,
                'created_at': timezone.now(),
            },
        )
    else:
        ClusterLeadScope.objects.filter(
            supervisor=target,
            programme_key=programme_key,
            module_level=module_level,
        ).delete()


def _require_supervisor(target_id, message):
    try:
        return Supervisor.objects.get(pk=int(target_id))
    except (Supervisor.DoesNotExist, TypeError, ValueError):
        raise ValidationError(message)


# -----------------------------------------------------------------------------
# Table reads that replaced the PostgREST queries
# -----------------------------------------------------------------------------

def my_assessments(supervisor):
    return [
        serialize_assessment(assessment)
        for assessment in Assessment.objects.filter(owner=supervisor).order_by(
            '-updated_at'
        )
    ]


def all_assessments(supervisor):
    require_oversight(supervisor)
    return [
        serialize_assessment(assessment)
        for assessment in Assessment.objects.all().order_by('-updated_at')
    ]


def checker_candidates(supervisor):
    """Anyone other than the setter may be nominated as the checker."""
    return [
        {'user_id': str(person.pk), 'display_name': person.dn}
        for person in Supervisor.objects.exclude(pk=supervisor.pk).order_by(
            Lower('dn'), 'id'
        )
    ]


def my_roles(supervisor):
    roles = set(
        BriefRole.objects.filter(supervisor=supervisor).values_list('role', flat=True)
    )
    return {
        'roles': [
            {'role': role} for role in sorted(roles) if role in WORKFLOW_ROLES
        ],
        'is_admin': ROLE_ADMIN in roles,
        'has_oversight': ROLE_ADMIN in roles or ROLE_TEACHING_DIRECTOR in roles,
    }


def my_review_assignments(supervisor):
    """Approval summaries for the caller's own briefs, for the dashboard tiles."""
    return [
        serialize_assignment(assignment)
        for assignment in ReviewAssignment.objects.filter(
            assessment__owner=supervisor
        )
    ]


def review_events(supervisor, limit=200):
    require_oversight(supervisor)
    return [
        serialize_event(event)
        for event in ReviewEvent.objects.all().order_by('-created_at')[:limit]
    ]
