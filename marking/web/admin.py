import urllib, urllib.parse

from django.conf import settings
from django.contrib import admin
from django.http import  HttpResponseRedirect

# Register your models here.
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import MarkingStudent, Supervisor
from .models import MarkingAssignment,MarkingGrading,MarkingCombinedResult,MarkingCombinedGrading,MarkingCombinedComponent,MarkingRubric,MarkingSection,MarkingSectionResponse
from .passwords import generate_password_reset

class MarkingStudentAdmin(admin.ModelAdmin):
    ordering = ('fn','gn')
    list_display = ('gn', 'fn', 'username')
    search_fields = ['gn','fn']

    actions = ['import_from_csv']

    @admin.action(description='Import students from CSV')
    def import_from_csv(self, request, queryset):
        return HttpResponseRedirect('/admin/import_students_from_csv')

admin.site.register(MarkingStudent, MarkingStudentAdmin)

class SupervisorAdmin(admin.ModelAdmin):
    ordering = ('dn',)

    actions = ['import_from_csv','reset_password']

    @admin.action(description='Import supervisors from CSV')
    def import_from_csv(self, request, queryset):
        return HttpResponseRedirect('/admin/import_supervisors_from_csv')
    
    @admin.action(description='Reset password')
    def reset_password(self, request, queryset):
        if len(queryset)>1:
            return HttpResponse( 'only select a single user for reset')
        
        student = queryset[0]

        from django.shortcuts import HttpResponse

        r_id, r_token, r_json = generate_password_reset()
        student.password = r_json

        bits = urllib.parse.urlparse(settings.WEBSITE_URL)
        parts = urllib.parse.ParseResult(scheme='https',netloc=bits.netloc, path='/reset_password',params='',query=urllib.parse.urlencode({'u':student.username, 'id':r_id, 't':r_token}),fragment='')
        reset_url = urllib.parse.urlunparse(parts)

        student.password = r_json
        student.save()

        return HttpResponse( f'Reset URL: {reset_url}', headers={
            "Content-Type": "text/plain",
        })

admin.site.register(Supervisor, SupervisorAdmin)

class MarkingAssignmentAdmin(admin.ModelAdmin):
    actions = ['import_from_toml']
    
    @admin.action(description='Import assignment from TOML')
    def import_from_toml(self, request, queryset):
        return HttpResponseRedirect('/admin/import_assignment_from_toml')

admin.site.register(MarkingAssignment, MarkingAssignmentAdmin)

class MarkingRubricAdmin(admin.ModelAdmin):
    list_filter = ('assignment',)
    pass
admin.site.register(MarkingRubric, MarkingRubricAdmin)

class MarkingSectionAdmin(admin.ModelAdmin):
    list_filter = ('rubric',)
    pass
admin.site.register(MarkingSection, MarkingSectionAdmin)

class MarkingSectionResponseAdmin(admin.ModelAdmin):
    list_filter = ('section__rubric',)
    pass
admin.site.register(MarkingSectionResponse, MarkingSectionResponseAdmin)

@admin.display(
        description="Student Number",
        ordering="student__stu_num"
    )
def proj_request_student_number(proj_request):
    return proj_request.student.stu_num

@admin.display(
        description="Supervisor",
        ordering="supervisor__dn"
    )
def proj_request_supervisor(proj_request):
    return proj_request.supervisor


def marking_grading_assignment(grading):
    return grading.assignment.description

def marking_grading_marker(grading):
    return grading.marker.dn

class MarkingGradingAdmin(admin.ModelAdmin):
    search_fields = ['marker__dn']
    ordering = ('student__fn','assignment__id','-primary')
    list_display = ('student',marking_grading_assignment,marking_grading_marker, 'primary', 'completed')
    list_filter = ('completed',)

admin.site.register(MarkingGrading, MarkingGradingAdmin)

class MarkingCombinedResultAdmin(admin.ModelAdmin):
    ordering = ('student__fn',)
    list_display = ('student','completed')
    # list_filter = ('draft',)

admin.site.register(MarkingCombinedResult, MarkingCombinedResultAdmin)

class MarkingCombinedGradingAdmin(admin.ModelAdmin):
    pass

admin.site.register(MarkingCombinedGrading, MarkingCombinedGradingAdmin)

class MarkingCombinedComponentAdmin(admin.ModelAdmin):
    ordering = ('combined','assignment','order')

admin.site.register(MarkingCombinedComponent, MarkingCombinedComponentAdmin)