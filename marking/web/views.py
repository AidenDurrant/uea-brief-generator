import io
import smtplib
import functools
import re
from typing import Any
import urllib.parse

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.core.mail import send_mail
from django.core.paginator import Paginator
from django.core.validators import MinValueValidator, MaxValueValidator
from django.urls import reverse

import django.forms
from django.http import HttpResponseBadRequest, HttpResponseNotFound, HttpResponseForbidden, FileResponse
from django.shortcuts import redirect, render, HttpResponse
from django.core.paginator import EmptyPage
from django.views.decorators.csrf import ensure_csrf_cookie

from .models import Supervisor, MarkingStudent, MarkingAssignment
from .middleware import InjectContext
from .auth import login as auth_login
from .passwords import validate_password_reset, generate_password

# Debug views
def debug_login(request):
    student = request.GET.get('student',None)
    supervisor = request.GET.get('supervisor', None)
    username = ''

    if student!=None:
        try:
            user = MarkingStudent.objects.get(username=student)
            request.session[InjectContext.SESSION_STUDENT] = student
            username = student
        except MarkingStudent.DoesNotExist:
            return HttpResponseBadRequest()
    elif supervisor!=None:
        try:
            user = Supervisor.objects.get(username=supervisor)
            request.session[InjectContext.SESSION_SUPERVISOR] = supervisor
            username = supervisor
        except Supervisor.DoesNotExist:
            return HttpResponseBadRequest()

    return HttpResponse(f'Logged in "{username}"')
    
def debug_logout(request):
    if InjectContext.SESSION_STUDENT in request.session:
        del(request.session[InjectContext.SESSION_STUDENT])
    if InjectContext.SESSION_SUPERVISOR in request.session:
        del(request.session[InjectContext.SESSION_SUPERVISOR])
    return HttpResponse(f'Logged out')

def debug_exception_test(request):
    raise Exception('some stupid error')

def student_required(view_func):
    @functools.wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if hasattr(request,'student') and request.student!=None:
            return view_func(request, *args, **kwargs)
        return redirect('login')
        
    return wrapper

def supervisor_required(view_func):
    @functools.wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if hasattr(request,'supervisor') and request.supervisor!=None:
            return view_func(request, *args, **kwargs)
        elif hasattr(request,'student') and request.student!=None:
            return render(request, 'generic_error.html', {'msg':'Sorry but this page is only for supervisors'}, status=401)
        return redirect('login')
        
    return wrapper

def admin_required(view_func):
    @functools.wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if hasattr(request,'supervisor') and request.supervisor!=None:
            return view_func(request, *args, **kwargs)
        elif hasattr(request,'student') and request.student!=None:
            return render(request, 'generic_error.html', {'msg':'Sorry but this page is only for admins'}, status=401)
        if not request.supervisor.admin:
            return render(request, 'generic_error.html', {'msg':'Sorry but this page is only for admins'}, status=401)
        
        return redirect('login')
        
    return wrapper

# Main views

class Report(object):
    def __init__(self, mapping, data):
        # Data is a list of dicts, that is usually passed to the template for rendering.
        self.data = data
        # Mapping gives the order and column name that should be used in the report
        # Each entry is a tuple (property,title)
        self.mapping = mapping

    def to_html(self, request, title, links):
        '''Converts a Report object into a HttpResponse.
        '''

        context = request.context
        context['report_title'] = title
        context['cols'] = list(map(lambda x:x[1], self.mapping))

        props = list(map(lambda x:x[0], self.mapping))
        rows = []
        for entry in self.data:
            row = []
            for p in props:
                val = entry[p]
                link = None
                if p in links:
                    link = reverse(links[p], args=[val])
                row.append( (link, val) )
            rows.append(row)

        context['rows'] = rows

        return render(request, 'generic_report.html', context)

    def to_xlsx(self):
        '''Converts a Report object into a xlsx file.
        '''

        from tempfile import NamedTemporaryFile
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active

        # Find the column titles and write them out
        title_row = []
        props = []
        for prop,title in self.mapping:
            title_row.append(title)
            props.append(prop)

        ws.append(title_row)

        # Build each row
        for item in self.data:
            row = []
            for prop in props:
                row.append( item.get(prop,'') )

            ws.append(row)
        

        with io.BytesIO() as buf:
            wb.save(buf)
            buf.seek(0)
            data = buf.read()

        return HttpResponse(data, headers={
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": 'attachment; filename="export.xlsx"',
            },
        )


class SiteSettingsForm(django.forms.Form):
    stu_hide_proj = django.forms.BooleanField(label='Hide projects from students',
                                              help_text='This prevents students from viewing projects on the site', required=False)
    stu_read_only = django.forms.BooleanField(label='Lock student requests',
                                              help_text='This stops students from making or deleting requests', required=False)
    super_proj_lock = django.forms.BooleanField(label='Lock projects',
                                              help_text='This stops supervisors from creating/editing/deleting projects', required=False)
    super_resp_lock = django.forms.BooleanField(label='Lock responses',
                                              help_text='This stops supervisors from accepting/rejecting student requests', required=False)

def dashboard(request):
    context = request.context
    return render(request, 'dashboard_supervisor.html', context)

@supervisor_required
def docs(request):
    context = request.context
    context['is_admin'] = request.supervisor.admin
    return render(request, 'docs.html', context)

class ImportFromCsvForm(django.forms.Form):
    data = django.forms.CharField(max_length=1*1024*1024, widget=django.forms.Textarea)

RUBRIC_TOML_TOP_LEVEL_REQ = ['marksheet','title']
RUBRIC_TOML_SECTION_REQ = ['grades','name','percentage']
def validate_rubric(rubric):
    # Needs to have a top level rubric entry, with marksheet and title
    if 'rubric' not in rubric:
        raise ValueError('missing rubric element')
    r = rubric['rubric']
    for attr in RUBRIC_TOML_TOP_LEVEL_REQ:
        if attr not in r:
            raise ValueError(f'missing {attr} in rubric element')
    
    # Check each of the sections
    if 'section' not in rubric:
        raise ValueError('missing section element')
    
    # Check each section has grades, name, and percentage
    sections = rubric['section']
    total_percentage = 0
    for section_id,section in zip(range(len(sections)), sections):
        v = section['percentage']
        if not isinstance(v, int):
            raise ValueError(f"section {section_id} has an invalid percentage '{section['percentage']}' should be an integer")
        if v<0 or v>100:
            raise ValueError(f"section {section_id} has an invalid percentage '{section['percentage']}' should be between 0-100")
        total_percentage += v
    
        for attr in RUBRIC_TOML_SECTION_REQ:
            if attr not in section:
                raise ValueError(f'section {section_id} is missing {attr}')
    
    if total_percentage!=100:
        raise ValueError(f'total percentages of all sections does not equal 100: {total_percentage}')

@login_required
def import_assignment_from_toml(request):
    import tomllib
    if request.method=='GET':
        return render(request, 'import_students_csv.html', {'form':ImportFromCsvForm()})
    if request.method!='POST':
        return HttpResponseBadRequest()
    
    form = ImportFromCsvForm(request.POST)
    if not form.is_valid():
        pass

    data = form.cleaned_data['data']
    loaded = tomllib.loads(data)

    try:
        validate_rubric(loaded)
    except Exception as e:
        return HttpResponse(f'failed to validate rubric: {str(e)}')
    
    # Now convert it into database objects
    r = loaded['rubric']
    desc = r['title']
    short_title = r['marksheet']
    new_assignment = MarkingAssignment.objects.create(description=desc, short_title=short_title)
    rubric = new_assignment.new_rubric()

    for section in loaded['section']:
        name = section['name']
        percentage = section['percentage']
        grades = section['grades']

        section = rubric.add_section()
        section.description = name
        section.weight = percentage
        section.save()

        for grade in grades:
            resp = section.add_response()
            resp.description = grade['name']
            resp.score = grade['score']
            resp.save()
    
    return HttpResponse('rubric ok')

@login_required
def import_students_csv(request):
    if request.method=='GET':
        return render(request, 'import_students_csv.html', {'form':ImportFromCsvForm()})
    if request.method!='POST':
        return HttpResponseBadRequest()
    
    form = ImportFromCsvForm(request.POST)
    if not form.is_valid():
        pass

    import csv

    data = form.cleaned_data['data']
    lines = data.split('\n')
    fieldnames = lines[0].strip().split(',')
    count = 0
    skipped = 0
    for entry in csv.DictReader(lines[1:], fieldnames=fieldnames):
        # print(entry)
        stu_num = entry['stu_num']
        try:
            stu = MarkingStudent.objects.get(stu_num=stu_num)
            skipped += 1
        except MarkingStudent.DoesNotExist:
            stu = MarkingStudent.objects.create(
                username=entry['username'],
                gn=entry['gn'],
                fn=entry['fn'],
                stu_num=entry['stu_num'],
                supervisor=f'{entry["dn"]} - {entry["title"]}'
            )
            count += 1

    return HttpResponse(f'ok, imported: {count}, skipped: {skipped}')
    
@login_required
def import_supervisors_from_csv(request):
    if request.method=='GET':
        return render(request, 'import_supervisors_csv.html', {'form':ImportFromCsvForm()})
    if request.method!='POST':
        return HttpResponseBadRequest()
    
    form = ImportFromCsvForm(request.POST)
    if not form.is_valid():
        pass

    import csv

    data = form.cleaned_data['data']
    lines = data.split('\n')
    fieldnames = lines[0].strip().split(',')
    count = 0
    skipped = 0
    for entry in csv.DictReader(lines[1:], fieldnames=fieldnames):
        # print(entry)
        username = entry['username']
        try:
            stu = Supervisor.objects.get(username=username)
            skipped += 1
        except Supervisor.DoesNotExist:
            stu = Supervisor.objects.create(
                username=entry['username'],
                dn=entry['dn'],
                bio=entry['bio']
            )
            count += 1

    return HttpResponse(f'ok, imported: {count}, skipped: {skipped}')


class LoginForm(django.forms.Form):
    username = django.forms.CharField(max_length=32)
    password = django.forms.CharField(widget=django.forms.PasswordInput, max_length=128)

def login(request):
    if request.method=='GET':
        if request.student!=None:
            return redirect('dashboard')
        if request.supervisor!=None:
            return redirect('dashboard')
        
        form = LoginForm() 
        context = request.context
        context['form'] = form
        return render(request, 'login.html', context)
    else:
        form = LoginForm(request.POST)
        if not form.is_valid():
            context = request.context
            context['form'] = LoginForm(initial={'username':form.cleaned_data['username']})
            return render(request, 'login.html', context)
        username = form.cleaned_data['username']
        password = form.cleaned_data['password']
        r = auth_login(request, username, password)
        if not r:
            return render(request, 'login_bad.html', {})
        
        if InjectContext.SESSION_TARGET in request.session:
            target = request.session[InjectContext.SESSION_TARGET]
            del(request.session[InjectContext.SESSION_TARGET])
            return redirect(target)

        return redirect('dashboard')
    
def logout(request):
    if InjectContext.SESSION_STUDENT in request.session:
        del(request.session[InjectContext.SESSION_STUDENT])
    if InjectContext.SESSION_SUPERVISOR in request.session:
        del(request.session[InjectContext.SESSION_SUPERVISOR])
    
    return redirect('login')


class PasswordResetTokenForm(django.forms.Form):
    u = django.forms.CharField(max_length=64)
    id = django.forms.CharField(max_length=128)
    t = django.forms.CharField(max_length=192)

class PasswordResetForm(django.forms.Form):
    u = django.forms.CharField(max_length=64, widget=django.forms.HiddenInput)
    id = django.forms.CharField(max_length=128, widget=django.forms.HiddenInput)
    t = django.forms.CharField(max_length=192, widget=django.forms.HiddenInput)
    new_pass_1 = django.forms.CharField(max_length=256, widget=django.forms.PasswordInput)
    new_pass_2 = django.forms.CharField(max_length=256, widget=django.forms.PasswordInput)

def password_reset(request):
    # Extract the query parameters    
    if request.method == 'GET':
        form = PasswordResetTokenForm(request.GET)
        if not form.is_valid():
            return HttpResponseBadRequest()
        
        username = form.cleaned_data['u']
        token_id = form.cleaned_data['id']
        token = form.cleaned_data['t']

        # Find the user
        user = None
        try:
            user = Supervisor.objects.get(username=username)
        except Supervisor.DoesNotExist:
            pass
        
        if user==None:
            return HttpResponseBadRequest()
        
        # Validate the token with the data in the password field
        reset_json = user.password
        valid_reset = validate_password_reset(reset_json, token)
        
        reset_form = PasswordResetForm(initial={'u':username,'id':token_id,'t':token})
        context = request.context
        context['form'] = reset_form
        return render(request, 'password_reset.html', context)
    elif request.method=='POST':
        form = PasswordResetForm(request.POST)
        if not form.is_valid():
            return HttpResponseBadRequest()
        
        username = form.cleaned_data['u']
        token_id = form.cleaned_data['id']
        token = form.cleaned_data['t']
        pass_1 = form.cleaned_data['new_pass_1']
        pass_2 = form.cleaned_data['new_pass_2']

        if pass_1 != pass_2:
            form.add_error('new_pass_1', 'Passwords do not match')
            form.cleaned_data['pass_1'] = ''
            form.cleaned_data['pass_2'] = ''
            context = request.context
            context['form'] = form
            return render(request, 'password_reset.html', context)

        # Find the user
        user = None
        try:
            user = Supervisor.objects.get(username=username)
        except Supervisor.DoesNotExist:
            pass
        
        if user==None:
            return HttpResponseBadRequest()
        
        # Validate the token with the data in the password field
        reset_json = user.password
        valid_reset = validate_password_reset(reset_json, token)

        if valid_reset:
            password_json = generate_password(pass_1)
            user.password = password_json
            user.save()

            # push another page in here

            return render(request, 'password_reset_complete.html', request.context)
        
        return HttpResponseBadRequest('Invalid password reset request')

    return HttpResponseBadRequest()

WHITESPACE_RE = re.compile(r'\s+')

def characters_used(s):
    chars = map(lambda x:len(x), WHITESPACE_RE.split(s))
    return sum(chars)

class SupervisorEdit(django.forms.Form):
    bio = django.forms.CharField(max_length=4096, widget=django.forms.Textarea)

@supervisor_required
def supervisor_profile_edit(request):
    supervisor = request.supervisor
    context = request.context

    if request.method=='POST':
        form = SupervisorEdit(request.POST)
        context['form'] = form
        if not form.is_valid():
            return render(request, 'supervisor_edit.html', context)
        supervisor.bio = form.cleaned_data['bio']
        supervisor.save()
        return redirect('supervisor_manage')
    else:
        form = SupervisorEdit(initial={'bio': supervisor.bio})
        context['form'] = form
        return render(request, 'supervisor_edit.html', context)
