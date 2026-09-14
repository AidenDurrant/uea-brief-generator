from django.contrib import admin
from django.urls import path, include

from . import apis
from . import views
from . import marking

from briefs.urls import api_patterns as briefs_api_patterns
from briefs.urls import app_patterns as briefs_app_patterns

api_patterns = [
    # path('auth', apis.auth, name='api_v1_auth'),
    path('briefs/', include(briefs_api_patterns)),
]

urlpatterns = [
    path('admin/import_students_from_csv', views.import_students_csv, name='import_students_from_csv'),
    path('admin/import_supervisors_from_csv', views.import_supervisors_from_csv, name='import_supervisors_from_csv'),
    path('admin/import_assignment_from_toml', views.import_assignment_from_toml, name='import_assignment_from_toml'),
	path('admin/', admin.site.urls),
    path('api/v1/', include(api_patterns)),
    # path('members/', include('members_area.urls')),
    path('login', views.login, name='login'),
    path('logout', views.logout, name='logout'),
    path('manage/docs',views.docs, name='docs'),
    path('reset_password', views.password_reset, name='password_reset'),
    # Marking
    path('marking/', marking.marking_start, name='marking_start'),
    path('marking/add_student', marking.add_student, name='add_student'),
    path('marking/<int:stu_id>/', marking.marking_student, name='marking_student'),
    path('marking/<int:stu_id>/new', marking.marking_new, name='marking_new'),
    path('marking/<int:stu_id>/new_combined', marking.marking_new_combined, name='marking_new_combined'),
    path('marking/<int:stu_id>/combined/<int:result_id>', marking.marking_combined_result, name='marking_combined_result'),
    path('marking/<int:stu_id>/<int:grading_id>', marking.marking_sections, name='marking_sections'),
    path('marking/<int:stu_id>/<int:grading_id>/<int:section_id>', marking.marking_entry, name='marking_entry'),
    path('marking/<int:stu_id>/<int:grading_id>/<int:section_id>/api/<int:response_id>', marking.marking_entry_api, name='marking_entry_api'),
    path('marking/rubric/<int:rubric_id>/show', marking.marking_show_rubric, name='marking_show_rubric'),
    path('marking/export/combined/<int:combined_id>', marking.marking_export_combined, name='marking_export_combined'),
    path('marking/progress', marking.marking_progress, name='marking_progress'),
    path('marking/final_pdf/<int:result_id>', marking.download_final_pdf, name='download_final_pdf'),
    path('marking/report_pdf/<int:result_id>', marking.download_detailed_report_pdf, name='download_detailed_report_pdf'),

    # Assessment briefs: a static Next.js export served under /briefs/.
    *briefs_app_patterns,

    # Catch-all
	path('', views.dashboard, name='dashboard'),
]

from django.conf import settings
if settings.DEBUG:
    urlpatterns.extend([
        path('debug/login', views.debug_login, name='debug_login'),
        path('debug/logout', views.debug_logout, name='debug_logout'),
        path('debug/exception', views.debug_exception_test, name='debug_exception'),
    ])