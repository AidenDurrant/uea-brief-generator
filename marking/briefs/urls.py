"""URLs for the brief generator.

`api_patterns` is included under /api/v1/ by web/urls.py; `app_patterns` is
included at the site root so the SPA lives at /briefs/.
"""

from django.urls import path, re_path

from . import api
from . import views

api_patterns = [
    path('session/', api.session, name='briefs_api_session'),

    # Workflow -- one endpoint per Supabase RPC, same name, same arguments.
    path('review_queue/', api.review_queue, name='briefs_api_review_queue'),
    path('assessment_review_status/', api.assessment_review_status,
         name='briefs_api_assessment_review_status'),
    path('submit_assessment_for_review/', api.submit_assessment_for_review,
         name='briefs_api_submit_assessment_for_review'),
    path('record_assessment_review/', api.record_assessment_review,
         name='briefs_api_record_assessment_review'),
    path('assessment_can_export_final/', api.assessment_can_export_final,
         name='briefs_api_assessment_can_export_final'),
    path('admin_override_assessment_approval/',
         api.admin_override_assessment_approval,
         name='briefs_api_admin_override_assessment_approval'),

    # Administration.
    path('admin_list_users/', api.admin_list_users,
         name='briefs_api_admin_list_users'),
    path('admin_promote_user/', api.admin_promote_user,
         name='briefs_api_admin_promote_user'),
    path('admin_demote_user/', api.admin_demote_user,
         name='briefs_api_admin_demote_user'),
    path('admin_review_workflow_users/', api.admin_review_workflow_users,
         name='briefs_api_admin_review_workflow_users'),
    path('admin_set_workflow_role/', api.admin_set_workflow_role,
         name='briefs_api_admin_set_workflow_role'),
    path('admin_review_assignments/', api.admin_review_assignments,
         name='briefs_api_admin_review_assignments'),
    path('admin_cluster_lead_scopes/', api.admin_cluster_lead_scopes,
         name='briefs_api_admin_cluster_lead_scopes'),
    path('admin_set_cluster_lead_scope/', api.admin_set_cluster_lead_scope,
         name='briefs_api_admin_set_cluster_lead_scope'),

    # Replacing the raw PostgREST table queries.
    path('my_assessments/', api.my_assessments, name='briefs_api_my_assessments'),
    path('all_assessments/', api.all_assessments, name='briefs_api_all_assessments'),
    path('save_assessment/', api.save_assessment, name='briefs_api_save_assessment'),
    path('delete_assessment/', api.delete_assessment,
         name='briefs_api_delete_assessment'),
    path('checker_candidates/', api.checker_candidates,
         name='briefs_api_checker_candidates'),
    path('my_roles/', api.my_roles, name='briefs_api_my_roles'),
    path('my_review_assignments/', api.my_review_assignments,
         name='briefs_api_my_review_assignments'),
    path('review_events/', api.review_events, name='briefs_api_review_events'),
]

app_patterns = [
    path('briefs', views.briefs_root, name='briefs_root'),
    path('briefs/', views.briefs_index, name='briefs_app'),
    re_path(r'^briefs/(?P<path>.+)$', views.briefs_asset, name='briefs_asset'),
]
