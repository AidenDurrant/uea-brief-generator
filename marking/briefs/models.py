"""Assessment brief storage and the approval-workflow bookkeeping around it.

Ported from supabase/migrations/001_initial_schema.sql and 002_admin_override.sql.
Identity comes from the marking site, so every reference to a person is a foreign
key onto web.models.Supervisor rather than a Supabase auth user, and the separate
`profiles` table is gone: display names are Supervisor.dn.

The workflow columns on Assessment (version, status, submitted_at, approved_at)
are owned by briefs.services. Nothing else may write them -- in Postgres that was
enforced by a trigger reading the app.workflow_transition GUC, here it is enforced
by keeping those four names out of every form, serializer and API payload.
"""

import uuid

from django.db import models

STAGE_CHECKER = 'checker'
STAGE_CLUSTER_LEAD = 'cluster_lead'
# Approval runs in a fixed order: the nominated checker, then the cluster lead.
STAGES = [STAGE_CHECKER, STAGE_CLUSTER_LEAD]
STAGE_CHOICES = [
    (STAGE_CHECKER, 'Checker'),
    (STAGE_CLUSTER_LEAD, 'Cluster lead'),
]

STATUS_CHOICES = [
    ('draft', 'Draft'),
    ('in_review', 'In review'),
    ('changes_requested', 'Changes requested'),
    ('approved', 'Approved'),
]

STATE_CHOICES = [
    ('pending', 'Pending'),
    ('approved', 'Approved'),
    ('changes_requested', 'Changes requested'),
]

ROLE_ADMIN = 'admin'
ROLE_CLUSTER_LEAD = 'cluster_lead'
ROLE_TEACHING_DIRECTOR = 'teaching_director'
ROLE_CHOICES = [
    (ROLE_ADMIN, 'Administrator'),
    (ROLE_CLUSTER_LEAD, 'Cluster Lead'),
    (ROLE_TEACHING_DIRECTOR, 'Teaching Director'),
]
# The two roles the workflow-roles admin panel can toggle. Administrator is
# managed by its own promote/demote pair because of the last-admin rule.
WORKFLOW_ROLES = [ROLE_CLUSTER_LEAD, ROLE_TEACHING_DIRECTOR]

ACTION_CHOICES = [
    ('assigned', 'Assigned'),
    ('submitted', 'Submitted'),
    ('approved', 'Approved'),
    ('withdrawn', 'Withdrawn'),
    ('invalidated', 'Invalidated'),
    ('overridden', 'Overridden'),
]

# The nine fields that make up the brief itself. A change to any of them bumps
# the version and voids the approvals; a change to anything else does not.
BRIEF_FIELDS = [
    'title',
    'module_code',
    'academic_year',
    'assessment_type',
    'ai_policy',
    'group_work_permitted',
    'content',
    'programme',
    'module_level',
]


def normalise_programme(programme):
    """Casefolded, trimmed programme name, or None when there isn't one.

    Postgres stored the raw string but matched scopes on lower(trim(...)), so
    "Computing" and "computing" were two rows that both matched one assessment.
    Normalising on write makes the unique constraint agree with the match.
    """
    if programme is None:
        return None
    key = str(programme).strip().lower()
    return key or None


class Assessment(models.Model):
    # Must stay a UUID: frontend/app/review/page.tsx validates the ?assessment=
    # query parameter against a UUID regex before it will load anything.
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        'web.Supervisor',
        on_delete=models.CASCADE,
        related_name='owned_assessments',
    )
    # Nominated by the setter, reviews the brief before the cluster lead.
    # A setter cannot nominate themselves.
    checker = models.ForeignKey(
        'web.Supervisor',
        on_delete=models.SET_NULL,
        related_name='checking_assessments',
        blank=True,
        null=True,
    )

    title = models.TextField()
    module_code = models.TextField()
    academic_year = models.TextField()
    assessment_type = models.TextField()
    ai_policy = models.TextField()
    group_work_permitted = models.BooleanField(default=False)
    content = models.JSONField(default=dict)
    programme = models.TextField(blank=True, null=True)
    # Derived from `programme` on every save. Denormalised rather than computed
    # in the query so that scope matching uses one normalisation -- Python's --
    # on both sides. SQL LOWER() is ASCII-only on SQLite and locale-aware on
    # Postgres, so a query-side lower() would disagree with the stored scope key
    # for a non-ASCII programme name, and only on one of the two databases.
    programme_key = models.TextField(blank=True, null=True)
    module_level = models.IntegerField(blank=True, null=True)

    # Service-owned. See the module docstring.
    version = models.IntegerField(default=1)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default='draft')
    submitted_at = models.DateTimeField(blank=True, null=True)
    approved_at = models.DateTimeField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['owner']),
            models.Index(fields=['checker']),
            models.Index(fields=['status']),
            models.Index(fields=['academic_year']),
            models.Index(fields=['assessment_type']),
            models.Index(fields=['-updated_at']),
            models.Index(fields=['programme_key', 'module_level']),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(checker__isnull=True)
                | ~models.Q(checker=models.F('owner')),
                name='assessments_checker_is_not_owner',
            ),
            models.CheckConstraint(
                condition=models.Q(version__gte=1),
                name='assessments_version_at_least_one',
            ),
        ]

    def __str__(self):
        return f'{self.module_code} - {self.title}'


class BriefRole(models.Model):
    """Brief-generator roles, separate from the marking site's Supervisor.admin.

    Merges Supabase's admin_users and reviewer_roles: the three roles behave the
    same way (a membership granted by another oversight user), and one table
    means one query to answer "what can this person do here?".
    """

    supervisor = models.ForeignKey(
        'web.Supervisor',
        on_delete=models.CASCADE,
        related_name='brief_roles',
    )
    role = models.CharField(max_length=32, choices=ROLE_CHOICES)
    assigned_by = models.ForeignKey(
        'web.Supervisor',
        on_delete=models.SET_NULL,
        related_name='brief_roles_assigned',
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['supervisor', 'role'], name='brief_role_unique'
            ),
        ]
        indexes = [
            models.Index(fields=['role', 'supervisor']),
        ]

    def __str__(self):
        return f'{self.supervisor} = {self.role}'


class ClusterLeadScope(models.Model):
    """Which programme/level combinations a cluster lead signs off.

    `programme` keeps what the administrator typed for display;
    `programme_key` is the normalised value everything matches on.
    """

    supervisor = models.ForeignKey(
        'web.Supervisor',
        on_delete=models.CASCADE,
        related_name='cluster_lead_scopes',
    )
    programme = models.TextField()
    programme_key = models.TextField()
    module_level = models.IntegerField()
    assigned_by = models.ForeignKey(
        'web.Supervisor',
        on_delete=models.SET_NULL,
        related_name='cluster_lead_scopes_assigned',
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['supervisor', 'programme_key', 'module_level'],
                name='cluster_lead_scope_unique',
            ),
        ]
        indexes = [
            models.Index(fields=['programme_key', 'module_level', 'supervisor']),
        ]

    def __str__(self):
        return f'{self.supervisor} / {self.programme} L{self.module_level}'


class ReviewAssignment(models.Model):
    """One row per (assessment, stage) holding that stage's current decision."""

    assessment = models.ForeignKey(
        Assessment,
        on_delete=models.CASCADE,
        related_name='review_assignments',
    )
    stage = models.CharField(max_length=32, choices=STAGE_CHOICES)
    reviewer = models.ForeignKey(
        'web.Supervisor',
        on_delete=models.SET_NULL,
        related_name='brief_reviews',
        blank=True,
        null=True,
    )
    assigned_by = models.ForeignKey(
        'web.Supervisor',
        on_delete=models.SET_NULL,
        related_name='brief_reviews_assigned',
        blank=True,
        null=True,
    )
    state = models.CharField(max_length=32, choices=STATE_CHOICES, default='pending')
    reviewed_version = models.IntegerField(blank=True, null=True)
    comment = models.TextField(blank=True, null=True)
    reviewed_at = models.DateTimeField(blank=True, null=True)
    # Null means a genuine review decision; non-null names the administrator who
    # bypassed the stage.
    overridden_by = models.ForeignKey(
        'web.Supervisor',
        on_delete=models.SET_NULL,
        related_name='brief_reviews_overridden',
        blank=True,
        null=True,
    )
    assigned_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['assessment', 'stage'], name='review_assignment_unique'
            ),
        ]
        indexes = [
            models.Index(fields=['reviewer']),
            models.Index(fields=['state']),
        ]

    def __str__(self):
        return f'{self.assessment_id} {self.stage} = {self.state}'


class ReviewEvent(models.Model):
    """Append-only audit log.

    Deliberately has no foreign keys, exactly as the Postgres original: an audit
    row has to outlive the assessment it describes and the accounts it names.
    """

    assessment_id = models.UUIDField()
    assessment_version = models.IntegerField()
    stage = models.CharField(max_length=32, choices=STAGE_CHOICES, blank=True, null=True)
    reviewer_id = models.IntegerField(blank=True, null=True)
    actor_id = models.IntegerField(blank=True, null=True)
    action = models.CharField(max_length=32, choices=ACTION_CHOICES)
    comment = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['assessment_id', '-created_at']),
            models.Index(fields=['reviewer_id']),
            models.Index(fields=['actor_id']),
        ]

    def __str__(self):
        return f'{self.assessment_id} {self.action}'
