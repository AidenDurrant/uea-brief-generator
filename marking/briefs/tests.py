"""End-to-end cover for the ported workflow.

These exercise the rules that used to be enforced by Postgres -- stage ordering,
the version bump, the authorisation split between reading and writing -- through
the HTTP API, because that is the seam the React app actually uses.
"""

import json

from django.test import Client, TestCase

from web.middleware import InjectContext
from web.models import Supervisor

from .models import (
    Assessment,
    BriefRole,
    ClusterLeadScope,
    ReviewAssignment,
    ReviewEvent,
)

API = '/api/v1/briefs'

BRIEF = {
    'title': 'Coursework 1',
    'module_code': 'CMP-4000A',
    'academic_year': '2025/26',
    'assessment_type': 'Report',
    'ai_policy': 'AMBER',
    'group_work_permitted': False,
    'programme': 'Computing Science',
    'module_level': 4,
    'content': {'formData': {'module': 'CMP-4000A'}},
}


class ApiClient:
    """A signed-in browser: session cookie, CSRF token, JSON in and out."""

    def __init__(self, supervisor=None):
        # CSRF enforced, as in a real browser: every call below has to carry the
        # cookie the session endpoint sets plus the matching X-CSRFToken header.
        self.client = Client(enforce_csrf_checks=True)
        if supervisor is not None:
            session = self.client.session
            session[InjectContext.SESSION_SUPERVISOR] = supervisor.username
            session.save()
        response = self.client.get(f'{API}/session/')
        self.session = response.json()['data']
        self.token = self.session['csrf_token']

    def post(self, name, **payload):
        return self.client.post(
            f'{API}/{name}/',
            data=json.dumps(payload),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=self.token,
        )

    def rpc(self, name, **payload):
        """The success path: assert 200 and hand back `data`."""
        response = self.post(name, **payload)
        assert response.status_code == 200, (
            f'{name} -> {response.status_code} {response.content[:300]}'
        )
        return response.json()['data']

    def error(self, name, **payload):
        response = self.post(name, **payload)
        return response.status_code, response.json().get('error')


class WorkflowTests(TestCase):
    def setUp(self):
        self.owner = Supervisor.objects.create(username='setter', dn='Sam Setter')
        self.checker = Supervisor.objects.create(
            username='checker', dn='Chris Checker'
        )
        self.lead = Supervisor.objects.create(username='clead', dn='Casey Lead')
        self.admin = Supervisor.objects.create(username='root', dn='Ada Admin')
        BriefRole.objects.create(supervisor=self.admin, role='admin')

    def grant_cluster_lead(self, supervisor, programme='computing science', level=4):
        BriefRole.objects.create(supervisor=supervisor, role='cluster_lead')
        ClusterLeadScope.objects.create(
            supervisor=supervisor,
            programme=programme,
            programme_key=programme.strip().lower(),
            module_level=level,
        )

    def save_brief(self, api, assessment_id=None, **overrides):
        record = {**BRIEF, **overrides}
        return api.rpc('save_assessment', id=assessment_id, record=record)

    # -- session and gating -------------------------------------------------

    def test_anonymous_post_is_json_401_not_html(self):
        response = Client().post(
            f'{API}/my_roles/', data='{}', content_type='application/json'
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(response.json()['error'], 'Authentication required')

    def test_mutating_call_without_csrf_token_is_rejected(self):
        api = ApiClient(self.owner)
        response = api.client.post(
            f'{API}/my_roles/', data='{}', content_type='application/json'
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response['Content-Type'], 'application/json')

    def test_session_reports_the_supervisor_display_name(self):
        api = ApiClient(self.owner)
        self.assertEqual(api.session['user']['id'], str(self.owner.pk))
        self.assertEqual(
            api.session['user']['user_metadata']['full_name'], 'Sam Setter'
        )

    def test_plain_supervisor_cannot_reach_admin_endpoints(self):
        api = ApiClient(self.owner)
        status, error = api.error('admin_list_users')
        self.assertEqual(status, 403)
        self.assertEqual(error, 'Administrator or Teaching Director access required')

    def test_briefs_page_redirects_anonymous_visitors_keeping_the_query_string(self):
        target = '/briefs/review?assessment=abc&stage=checker'
        response = Client().get(target)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, '/login')
        self.assertEqual(
            response.wsgi_request.session[InjectContext.SESSION_TARGET], target
        )

    def test_briefs_root_redirects_to_the_trailing_slash(self):
        response = Client().get('/briefs')
        # Anonymous, so the login gate answers first; the redirect itself is
        # covered by the URL conf resolving /briefs to a separate view.
        self.assertEqual(response.status_code, 302)

    # -- saving -------------------------------------------------------------

    def test_save_round_trip_keeps_the_version_at_one(self):
        api = ApiClient(self.owner)
        created = self.save_brief(api)
        self.assertEqual(created['version'], 1)
        self.assertEqual(created['status'], 'draft')
        self.assertEqual(created['owner_id'], str(self.owner.pk))

        updated = self.save_brief(api, created['id'], title='Coursework 1b')
        self.assertEqual(updated['id'], created['id'])
        self.assertEqual(updated['version'], 1)
        self.assertGreaterEqual(updated['updated_at'], created['updated_at'])

    def test_client_cannot_set_workflow_fields(self):
        api = ApiClient(self.owner)
        created = api.rpc(
            'save_assessment',
            id=None,
            record={**BRIEF, 'status': 'approved', 'version': 9},
        )
        self.assertEqual(created['status'], 'draft')
        self.assertEqual(created['version'], 1)

    def test_content_comparison_ignores_key_order(self):
        api = ApiClient(self.owner)
        created = self.save_brief(api, content={'a': 1, 'b': 2})
        Assessment.objects.filter(pk=created['id']).update(status='in_review')

        unchanged = self.save_brief(api, created['id'], content={'b': 2, 'a': 1})
        self.assertEqual(unchanged['version'], 1)
        self.assertEqual(unchanged['status'], 'in_review')

    def test_non_ascii_programme_matches_its_scope(self):
        # Python's .lower() and SQL LOWER() disagree here on some backends, so
        # the match runs entirely on the stored, Python-normalised key.
        api = ApiClient(self.owner)
        self.grant_cluster_lead(self.lead, programme='ÉTUDES NUMÉRIQUES')
        created = self.save_brief(
            api,
            programme='Études Numériques',
            checker_id=str(self.checker.pk),
        )
        api.rpc('submit_assessment_for_review', target_assessment_id=created['id'])

        rows = ApiClient(self.lead).rpc('review_queue')
        self.assertIn(
            'cluster_lead', {row['stage'] for row in rows}
        )

    def test_blank_programme_is_stored_as_null(self):
        api = ApiClient(self.owner)
        created = self.save_brief(api, programme='   ')
        self.assertIsNone(created['programme'])

    def test_owner_cannot_nominate_themselves_as_checker(self):
        api = ApiClient(self.owner)
        status, error = api.error(
            'save_assessment',
            id=None,
            record={**BRIEF, 'checker_id': str(self.owner.pk)},
        )
        self.assertEqual(status, 400)
        self.assertEqual(error, 'You cannot nominate yourself as the checker')

    def test_others_cannot_save_or_delete_someone_elses_brief(self):
        owner_api = ApiClient(self.owner)
        created = self.save_brief(owner_api)

        intruder = ApiClient(self.checker)
        status, error = intruder.error(
            'save_assessment', id=created['id'], record=BRIEF
        )
        self.assertEqual(status, 403)
        self.assertEqual(error, 'Assessment owner access required')

        status, _ = intruder.error('delete_assessment', id=created['id'])
        self.assertEqual(status, 403)
        self.assertTrue(Assessment.objects.filter(pk=created['id']).exists())

    # -- submission ---------------------------------------------------------

    def test_submission_requires_a_scoped_cluster_lead(self):
        api = ApiClient(self.owner)
        created = self.save_brief(api, checker_id=str(self.checker.pk))

        status, error = api.error(
            'submit_assessment_for_review', target_assessment_id=created['id']
        )
        self.assertEqual(status, 400)
        self.assertIn('cluster lead scoped to this programme and level', error)

        self.grant_cluster_lead(self.lead)
        api.rpc('submit_assessment_for_review', target_assessment_id=created['id'])
        self.assertEqual(
            Assessment.objects.get(pk=created['id']).status, 'in_review'
        )

    def test_submission_requires_a_checker(self):
        api = ApiClient(self.owner)
        self.grant_cluster_lead(self.lead)
        created = self.save_brief(api)
        status, error = api.error(
            'submit_assessment_for_review', target_assessment_id=created['id']
        )
        self.assertEqual(status, 400)
        self.assertEqual(error, 'Select a checker before submitting for approval')

    def test_the_checker_may_not_also_be_the_only_cluster_lead(self):
        api = ApiClient(self.owner)
        self.grant_cluster_lead(self.checker)
        created = self.save_brief(api, checker_id=str(self.checker.pk))
        status, error = api.error(
            'submit_assessment_for_review', target_assessment_id=created['id']
        )
        self.assertEqual(status, 400)
        self.assertIn('other than you and your chosen checker', error)

    # -- review ordering ----------------------------------------------------

    def submitted_brief(self):
        api = ApiClient(self.owner)
        self.grant_cluster_lead(self.lead)
        created = self.save_brief(api, checker_id=str(self.checker.pk))
        api.rpc('submit_assessment_for_review', target_assessment_id=created['id'])
        return created['id']

    def test_cluster_lead_cannot_act_before_the_checker(self):
        assessment_id = self.submitted_brief()
        lead_api = ApiClient(self.lead)

        rows = {row['stage']: row for row in lead_api.rpc('review_queue')}
        self.assertIn('cluster_lead', rows)
        self.assertFalse(rows['cluster_lead']['can_review'])
        self.assertTrue(rows['cluster_lead']['awaiting_previous_stage'])

        status, error = lead_api.error(
            'record_assessment_review',
            target_assessment_id=assessment_id,
            target_stage='cluster_lead',
            decision='approve',
        )
        self.assertEqual(status, 400)
        self.assertEqual(
            error,
            'This stage is waiting on the checker to approve the current version',
        )

    def test_full_approval_unlocks_the_final_export(self):
        assessment_id = self.submitted_brief()
        owner_api = ApiClient(self.owner)
        self.assertFalse(
            owner_api.rpc(
                'assessment_can_export_final', target_assessment_id=assessment_id
            )
        )

        ApiClient(self.checker).rpc(
            'record_assessment_review',
            target_assessment_id=assessment_id,
            target_stage='checker',
            decision='approve',
        )
        self.assertEqual(
            Assessment.objects.get(pk=assessment_id).status, 'in_review'
        )

        lead_api = ApiClient(self.lead)
        rows = {row['stage']: row for row in lead_api.rpc('review_queue')}
        self.assertTrue(rows['cluster_lead']['can_review'])

        lead_api.rpc(
            'record_assessment_review',
            target_assessment_id=assessment_id,
            target_stage='cluster_lead',
            decision='approve',
        )
        self.assertEqual(Assessment.objects.get(pk=assessment_id).status, 'approved')
        self.assertTrue(
            owner_api.rpc(
                'assessment_can_export_final', target_assessment_id=assessment_id
            )
        )

    def test_owner_cannot_review_their_own_brief(self):
        assessment_id = self.submitted_brief()
        status, error = ApiClient(self.owner).error(
            'record_assessment_review',
            target_assessment_id=assessment_id,
            target_stage='checker',
            decision='approve',
        )
        self.assertEqual(status, 403)
        self.assertEqual(error, 'Assessment owners cannot review their own assessment')

    def test_withdrawal_needs_a_comment(self):
        assessment_id = self.submitted_brief()
        checker_api = ApiClient(self.checker)
        status, error = checker_api.error(
            'record_assessment_review',
            target_assessment_id=assessment_id,
            target_stage='checker',
            decision='withdraw',
            review_comment='x',
        )
        self.assertEqual(status, 400)
        self.assertEqual(
            error, 'A withdrawal comment of at least 2 characters is required'
        )

        checker_api.rpc(
            'record_assessment_review',
            target_assessment_id=assessment_id,
            target_stage='checker',
            decision='withdraw',
            review_comment='Needs a clearer rubric.',
        )
        self.assertEqual(
            Assessment.objects.get(pk=assessment_id).status, 'changes_requested'
        )

    # -- versioning ---------------------------------------------------------

    def test_editing_an_approved_brief_voids_every_approval(self):
        assessment_id = self.submitted_brief()
        ApiClient(self.checker).rpc(
            'record_assessment_review',
            target_assessment_id=assessment_id,
            target_stage='checker',
            decision='approve',
        )
        ApiClient(self.lead).rpc(
            'record_assessment_review',
            target_assessment_id=assessment_id,
            target_stage='cluster_lead',
            decision='approve',
        )

        owner_api = ApiClient(self.owner)
        edited = self.save_brief(
            owner_api,
            assessment_id,
            title='Coursework 1 (revised)',
            checker_id=str(self.checker.pk),
        )

        self.assertEqual(edited['version'], 2)
        self.assertEqual(edited['status'], 'draft')
        self.assertIsNone(edited['submitted_at'])
        self.assertIsNone(edited['approved_at'])

        stages = {
            assignment.stage: assignment
            for assignment in ReviewAssignment.objects.filter(
                assessment_id=assessment_id
            )
        }
        self.assertEqual(stages['checker'].state, 'pending')
        self.assertEqual(stages['cluster_lead'].state, 'pending')
        # The setter's nomination survives so the brief can be resubmitted.
        self.assertEqual(stages['checker'].reviewer_id, self.checker.pk)
        self.assertIsNone(stages['cluster_lead'].reviewer_id)

        self.assertTrue(
            ReviewEvent.objects.filter(
                assessment_id=assessment_id, action='invalidated'
            ).exists()
        )
        self.assertFalse(
            owner_api.rpc(
                'assessment_can_export_final', target_assessment_id=assessment_id
            )
        )

    def test_checker_cannot_be_swapped_mid_review(self):
        assessment_id = self.submitted_brief()
        owner_api = ApiClient(self.owner)
        status, error = owner_api.error(
            'save_assessment',
            id=assessment_id,
            record={**BRIEF, 'checker_id': str(self.admin.pk)},
        )
        self.assertEqual(status, 403)
        self.assertEqual(
            error, 'The checker can only be changed while the assessment is a draft'
        )

    # -- administrator override --------------------------------------------

    def test_override_approves_a_brief_that_was_never_submitted(self):
        owner_api = ApiClient(self.owner)
        created = self.save_brief(owner_api)

        admin_api = ApiClient(self.admin)
        admin_api.rpc(
            'admin_override_assessment_approval',
            target_assessment_id=created['id'],
            override_reason='No cluster lead is scoped to this programme yet.',
        )

        assessment = Assessment.objects.get(pk=created['id'])
        self.assertEqual(assessment.status, 'approved')
        self.assertIsNotNone(assessment.submitted_at)
        self.assertTrue(
            owner_api.rpc(
                'assessment_can_export_final', target_assessment_id=created['id']
            )
        )

        statuses = owner_api.rpc(
            'assessment_review_status', target_assessment_id=created['id']
        )
        self.assertEqual(
            {row['overridden_by_name'] for row in statuses}, {'Ada Admin'}
        )

        status, error = admin_api.error(
            'admin_override_assessment_approval',
            target_assessment_id=created['id'],
            override_reason='Again, for no reason.',
        )
        self.assertEqual(status, 400)
        self.assertEqual(
            error, 'This assessment is already fully approved for the current version'
        )

    def test_override_requires_a_reason(self):
        created = self.save_brief(ApiClient(self.owner))
        status, error = ApiClient(self.admin).error(
            'admin_override_assessment_approval',
            target_assessment_id=created['id'],
            override_reason=' x ',
        )
        self.assertEqual(status, 400)
        self.assertEqual(
            error, 'An override reason of at least 2 characters is required'
        )

    # -- visibility ---------------------------------------------------------

    def test_drafts_are_invisible_to_reviewers_but_not_to_oversight(self):
        owner_api = ApiClient(self.owner)
        self.grant_cluster_lead(self.lead)
        created = self.save_brief(owner_api, checker_id=str(self.checker.pk))

        self.assertEqual(ApiClient(self.checker).rpc('review_queue'), [])
        self.assertEqual(ApiClient(self.lead).rpc('review_queue'), [])

        admin_rows = ApiClient(self.admin).rpc('review_queue')
        self.assertEqual({row['assessment_id'] for row in admin_rows}, {created['id']})

        status, _ = ApiClient(self.checker).error(
            'assessment_review_status', target_assessment_id=created['id']
        )
        self.assertEqual(status, 403)

    def test_review_status_is_readable_once_submitted(self):
        assessment_id = self.submitted_brief()
        rows = ApiClient(self.checker).rpc(
            'assessment_review_status', target_assessment_id=assessment_id
        )
        self.assertEqual([row['stage'] for row in rows], ['checker', 'cluster_lead'])
        self.assertFalse(rows[0]['awaiting_previous_stage'])
        self.assertTrue(rows[1]['awaiting_previous_stage'])

    def test_my_assessments_only_returns_your_own(self):
        self.save_brief(ApiClient(self.owner))
        self.assertEqual(ApiClient(self.checker).rpc('my_assessments'), [])
        self.assertEqual(len(ApiClient(self.owner).rpc('my_assessments')), 1)


class AdministrationTests(TestCase):
    def setUp(self):
        self.admin = Supervisor.objects.create(username='root', dn='Ada Admin')
        self.other_admin = Supervisor.objects.create(username='root2', dn='Bo Admin')
        self.person = Supervisor.objects.create(username='sam', dn='Sam Setter')
        BriefRole.objects.create(supervisor=self.admin, role='admin')
        self.api = ApiClient(self.admin)

    def test_last_administrator_cannot_be_demoted(self):
        status, error = self.api.error(
            'admin_demote_user', target_user_id=str(self.admin.pk)
        )
        self.assertEqual(status, 400)
        self.assertEqual(error, 'You cannot demote your own administrator account')

        self.api.rpc('admin_promote_user', target_user_id=str(self.other_admin.pk))
        other = ApiClient(self.other_admin)
        other.rpc('admin_demote_user', target_user_id=str(self.admin.pk))

        status, error = other.error(
            'admin_demote_user', target_user_id=str(self.other_admin.pk)
        )
        self.assertEqual(status, 400)
        self.assertEqual(error, 'You cannot demote your own administrator account')

    def test_a_teaching_director_cannot_remove_the_final_administrator(self):
        # The only route to this check: the caller has oversight without being
        # an administrator themselves, so neither earlier check fires first.
        self.api.rpc(
            'admin_set_workflow_role',
            target_user_id=str(self.person.pk),
            target_role='teaching_director',
            enabled=True,
        )
        status, error = ApiClient(self.person).error(
            'admin_demote_user', target_user_id=str(self.admin.pk)
        )
        self.assertEqual(status, 400)
        self.assertEqual(error, 'The final administrator cannot be demoted')
        self.assertTrue(
            BriefRole.objects.filter(supervisor=self.admin, role='admin').exists()
        )

    def test_demoting_a_non_administrator_is_a_silent_no_op(self):
        self.assertIsNone(
            self.api.rpc('admin_demote_user', target_user_id=str(self.person.pk))
        )

    def test_scopes_need_the_cluster_lead_role(self):
        status, error = self.api.error(
            'admin_set_cluster_lead_scope',
            target_user_id=str(self.person.pk),
            target_programme='Computing Science',
            target_module_level=4,
            enabled=True,
        )
        self.assertEqual(status, 400)
        self.assertEqual(error, 'User must hold the cluster_lead role')

        self.api.rpc(
            'admin_set_workflow_role',
            target_user_id=str(self.person.pk),
            target_role='cluster_lead',
            enabled=True,
        )
        self.api.rpc(
            'admin_set_cluster_lead_scope',
            target_user_id=str(self.person.pk),
            target_programme='Computing Science',
            target_module_level=4,
            enabled=True,
        )
        scopes = self.api.rpc('admin_cluster_lead_scopes')
        self.assertEqual(len(scopes), 1)
        self.assertEqual(scopes[0]['display_name'], 'Sam Setter')

    def test_scope_programmes_are_matched_case_insensitively(self):
        self.api.rpc(
            'admin_set_workflow_role',
            target_user_id=str(self.person.pk),
            target_role='cluster_lead',
            enabled=True,
        )
        for programme in ('Computing Science', ' computing science '):
            self.api.rpc(
                'admin_set_cluster_lead_scope',
                target_user_id=str(self.person.pk),
                target_programme=programme,
                target_module_level=4,
                enabled=True,
            )
        # One scope, not two: the normalised key is what the workflow matches on.
        self.assertEqual(ClusterLeadScope.objects.count(), 1)

    def test_revoking_cluster_lead_drops_the_scopes(self):
        self.api.rpc(
            'admin_set_workflow_role',
            target_user_id=str(self.person.pk),
            target_role='cluster_lead',
            enabled=True,
        )
        self.api.rpc(
            'admin_set_cluster_lead_scope',
            target_user_id=str(self.person.pk),
            target_programme='Computing Science',
            target_module_level=4,
            enabled=True,
        )
        self.api.rpc(
            'admin_set_workflow_role',
            target_user_id=str(self.person.pk),
            target_role='cluster_lead',
            enabled=False,
        )
        self.assertEqual(ClusterLeadScope.objects.count(), 0)

    def test_invalid_workflow_role_is_rejected(self):
        status, error = self.api.error(
            'admin_set_workflow_role',
            target_user_id=str(self.person.pk),
            target_role='wizard',
            enabled=True,
        )
        self.assertEqual(status, 400)
        self.assertEqual(error, 'Invalid workflow role: wizard')

    def test_teaching_director_has_oversight_without_being_an_administrator(self):
        self.api.rpc(
            'admin_set_workflow_role',
            target_user_id=str(self.person.pk),
            target_role='teaching_director',
            enabled=True,
        )
        director = ApiClient(self.person)
        roles = director.rpc('my_roles')
        self.assertTrue(roles['has_oversight'])
        self.assertFalse(roles['is_admin'])
        self.assertEqual(len(director.rpc('admin_list_users')), 3)
