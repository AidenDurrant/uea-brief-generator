import os
import tempfile

from django.core.exceptions import ValidationError
import django.db.models
from django.http import HttpResponseBadRequest, HttpResponseNotFound, HttpResponseForbidden, FileResponse
import django.forms
from django.shortcuts import redirect, render, HttpResponse
import  django.urls
from django.views.decorators.csrf import requires_csrf_token,ensure_csrf_cookie

from .views import supervisor_required, admin_required
from .models import MarkingAssignment,MarkingGrading, MarkingGradingEntry, MarkingRubric, MarkingSection, MarkingSectionResponse, MarkingStudent, MarkingCombinedGrading, MarkingCombinedResult, MarkingCombinedComponent
from .models import Supervisor
from .reports import generate_report2

class AddStudentForm(django.forms.Form):
    gn = django.forms.CharField(max_length=128, help_text='Given name', label='Given name')
    fn = django.forms.CharField(max_length=128, help_text='Family name', label='Family name')
    sid = django.forms.CharField(max_length=32, help_text='Student Number', label='Student Number')
    supervisor = django.forms.CharField(max_length=128, help_text='Supvisor', label='Supervisor', required=False)

@supervisor_required
def add_student(request):
    context = request.context

    if request.method=='GET':
        form = AddStudentForm()    
        context['form'] = form
        return render(request, 'add_student.html', context)
    elif request.method=='POST':
        form = AddStudentForm(request.POST)
        if not form.is_valid():
            context['form'] = form
            return render(request, 'add_student.html', context)
        gn = form.cleaned_data['gn']
        fn = form.cleaned_data['fn']
        sid = form.cleaned_data['sid']
        supervisor = form.cleaned_data['supervisor']
        new_stu = MarkingStudent.objects.create(
            gn=gn,
            fn=fn,
            stu_num=sid,
            supervisor=supervisor)
        return redirect('marking_student', stu_id = new_stu.id)

@supervisor_required
def download_detailed_report_pdf(request, result_id):
    try:
        result = MarkingCombinedResult.objects.get(pk=result_id)
    except MarkingCombinedResult.DoesNotExist:
        context = {}
        context['msg'] = f'No combined grading object with that ID'
        return render(request, 'generic_error.html', context)

    # Get options from the MarkingCombinedGrading instance
    combined = result.combined
    include_marks = combined.detailed_inc_marks
    include_desc = combined.detailed_inc_desc

    student = result.student
    fn = f'{student.fn}_{student.gn}-{student.stu_num}.pdf'
    dest_path = os.path.join(tempfile.gettempdir(), fn)
    try:
        generate_report2(result_id, dest_path, detailed=True, include_marks=include_marks, include_desc=include_desc)
    except ValueError as e:
        context = {}
        context['msg'] = f'Error generating report: {str(e)}'
        return render(request, 'generic_error.html', context)
    
    return FileResponse(open(dest_path, "rb"), as_attachment=True, filename=fn)

@supervisor_required
def download_final_pdf(request, result_id):
    try:
        result = MarkingCombinedResult.objects.get(pk=result_id)
    except MarkingCombinedResult.DoesNotExist:
        context = {}
        context['msg'] = f'No combined grading object with that ID'
        return render(request, 'generic_error.html', context)

    student = result.student
    fn = f'{student.fn}_{student.gn}-{student.stu_num}.pdf'
    dest_path = os.path.join(tempfile.gettempdir(), fn)
    try:
        generate_report2(result_id, dest_path, detailed=False, include_marks=False, include_desc=False)
    except ValueError as e:
        context = {}
        context['msg'] = f'Error generating report: {str(e)}'
        return render(request, 'generic_error.html', context)
    
    return FileResponse(open(dest_path, "rb"), as_attachment=True, filename=fn)

@supervisor_required
def marking_export_combined(request, combined_id):
    context = request.context

    try:
        combined = MarkingCombinedGrading.objects.get(pk=combined_id)
    except MarkingCombinedGrading.DoesNotExist:
        return HttpResponseNotFound('cant find that combined grading object')

    # Work out the list of parts
    parts = MarkingCombinedComponent.objects.filter(combined=combined).order_by('order')

    # Do we get all students here, or just the ones that have been marked?
    # For now it's probably safer to just get everyone, that way we can find missing entries.
    report = []
    headings = [
        'Family name',
        'Given name',
        'Student number',
    ]
    for part in parts:
        headings.append(part.assignment.description)
    report.append(headings)

    for student in MarkingStudent.objects.all().order_by('fn','gn'):
        row = [student.gn, student.fn, student.stu_num]

        try:
            result = MarkingCombinedResult.objects.get(combined=combined, student=student)
            for part in parts:
                mark = result.marks.get(str(part.assignment.id), None)
                if mark==None:
                    row.append('MISSING')
                else:
                    row.append(mark)
        except MarkingCombinedResult.DoesNotExist:
            for part in parts:
                row.append('MISSING')

        report.append( row )
    context['report'] = report
    
    return render(request, 'marking_export_combined.html', context)

class CommentsForm(django.forms.Form):
    comments = django.forms.CharField(widget=django.forms.Textarea, required=True)

@supervisor_required
def marking_combined_result(request, stu_id, result_id):
    context = request.context

    try:
        student = MarkingStudent.objects.get(pk=stu_id)
    except MarkingSearchForm.DoesNotExist:
        return HttpResponseNotFound('student not found')
    
    try:
        combined_result = MarkingCombinedResult.objects.get(pk=result_id)
    except MarkingCombinedResult.DoesNotExist:
        return HttpResponseNotFound('combined not found')

    if not(request.supervisor.admin or combined_result.access_check(request.supervisor)):
        return HttpResponseForbidden('You can only view final grade sheets you are marking')

    context['student'] = student
    context['combined_result'] = combined_result
    
    class CEntry:
        def __init__(self, assignment, gradings, mark):
            self.assignment = assignment
            self.gradings = gradings
            self.mark = mark

    combined_main = combined_result.combined

    if combined_result.marks != None:
        part_values = combined_result.marks
    else:
        part_values = {}

    confirmed_statement = False

    if request.method=='POST':
        # Look for the fields for each part
        for part in combined_main.parts.all():
            ass_id = part.assignment.id
            name = f'part_{ass_id}'
            if name in request.POST:
                try:
                    v = request.POST[name]
                    part_values[str(ass_id)] = float(v)
                except ValueError:
                    context['msg'] = 'The form is invalid as a mark value can not be converted to a float'
                    return render(request, 'generic_error.html', context)
                
        if 'verify_question' in request.POST:
            confirmed_statement = True

        if combined_main.verify_question != None:
            if not confirmed_statement:
                context['msg'] = 'You have not agreed to and ticked the required confirmation statement. Please press back and complete this'
                return render(request, 'generic_error.html', context)

        form = CommentsForm(request.POST)
        if not form.is_valid():
            context['msg'] = 'The form is invalid, as the comment too short'
            return render(request, 'generic_error.html', context)
            # return HttpResponseBadRequest('form is invalid, comment too short')
        comments = form.cleaned_data['comments']
        combined_result.comments = comments
        combined_result.marks = part_values
        combined_result.save()
        return redirect('marking_student', stu_id=student.id)
    else:
        form = CommentsForm(data={'comments':combined_result.comments})
    
    # Make the list of markers, ordered with the primary first
    # marker_ids = {}
    # markers = []
    # for part in combined_main.parts.all():
    #     ass = part.assignment
    #     for grading in MarkingGrading.objects.filter(assignment=ass, student=student).order_by('-primary'):
    #         marker_ids[ (grading.primary,grading.marker.id) ] = grading.marker
    # print(marker_ids)
    # marker_ids = list(marker_ids.items()) # [((primary,marker.id),marker), ...]
    # marker_ids.sort()
    # marker_ids.reverse()
    # markers = list(map(lambda x:x[1], marker_ids))
    # marker_ids = list(map(lambda x:x[0][1], marker_ids))

    marker_score = {}
    for part in combined_main.parts.all():
        ass = part.assignment
        for grading in MarkingGrading.objects.filter(assignment=ass, student=student).order_by('-primary'):
            current_score,_ = marker_score.get(grading.marker.id, (0,None))
            if grading.primary:
                current_score += 1
            marker_score[grading.marker.id] = (current_score, grading.marker)
    # Add in the grader id to resolve ties in a stable way
    markers = list(map(lambda x:x[1], marker_score.items()))
    markers = list(map(lambda x:(x[0],x[1].id,x[1]), markers))
    markers.sort()
    markers.reverse()
    markers = list(map(lambda x:x[-1], markers))
    
    parts = []
    for part in combined_main.parts.all():
        ass = part.assignment
        # Now build the grades we have in the order indicated by marker
        gradings = []
        for marker in markers:
            try:
                grad = MarkingGrading.objects.get(assignment=ass, student=student, marker=marker)
                gradings.append(grad)
            except MarkingGrading.DoesNotExist:
                gradings.append(None)

        mark = part_values.get(str(ass.id), 0) # JSON only lets you use strings as keys
        parts.append( CEntry(ass, gradings, mark) )

    context['parts'] = parts
    context['markers'] = markers
    context['comments'] = combined_result.comments
    context['form'] = form

    return render(request, 'marking_combined_result.html', context)

class MarkingEntryForm(django.forms.Form):
    comment = django.forms.CharField(widget=django.forms.Textarea, required=False, empty_value='')
    slider_score = django.forms.IntegerField(required=False)

@supervisor_required
def marking_entry_api(request, stu_id, grading_id, section_id, response_id):
    if request.method!='POST':
        return HttpResponseBadRequest()
    
    # Copying code is bad, but this needs to get done
    try:
        student = MarkingStudent.objects.get(pk=stu_id)
    except MarkingSearchForm.DoesNotExist:
        return HttpResponseNotFound('student not found')
    
    try:
        grading = MarkingGrading.objects.get(pk=grading_id)
    except MarkingSearchForm.DoesNotExist:
        return HttpResponseNotFound('grading not found')
    
    try:
        section = MarkingSection.objects.get(pk=section_id)
    except MarkingSection.DoesNotExist:
        return HttpResponseNotFound('section not found')
    
    try:
        entry = MarkingGradingEntry.objects.get(grading=grading, section=section)
    except MarkingGradingEntry.DoesNotExist:
        entry = None

    if request.supervisor.admin:
        # Just allow editing
        pass
    elif request.supervisor != grading.marker:
        return HttpResponseForbidden('You can only edit mark sheets you own')
    
    try:
        response = MarkingSectionResponse.objects.get(pk=response_id)
    except MarkingSectionResponse.DoesNotExist:
        return HttpResponseForbidden('invalid reponse')
    
    # Check for a score in the request parameters
    if 'score' in request.GET:
        try:
            score = int(request.GET['score'])
        except ValueError:
            return HttpResponseBadRequest('score parameter should be an integer')
    else:
        score = response.score

    try:
        if entry==None:
            entry = MarkingGradingEntry.objects.create(grading=grading, section=section, response=response, score=score, comment='')
        else:
            entry.response = response
            entry.score = score
            entry.save()
    except ValidationError:
        # This is probably due to the unique_together constraint, so there's been a race between two saves.
        # The most likely case is a async API call due to the click, and then a POST from the form.
        # Just reapply with the data in ours
        try:
            entry = MarkingGradingEntry.objects.get(grading=grading, section=section)
            entry.response = response
            entry.score = score
            entry.save()
        except MarkingGradingEntry.DoesNotExist:
            pass # XXXTODO: Warn that something weird is going on

    grading.update_completed()

    return HttpResponse('{"resp":"ok}')

@requires_csrf_token
@ensure_csrf_cookie
@supervisor_required
def marking_entry(request, stu_id, grading_id, section_id):
    context = request.context

    try:
        student = MarkingStudent.objects.get(pk=stu_id)
    except MarkingSearchForm.DoesNotExist:
        return HttpResponseNotFound('student not found')
    
    try:
        grading = MarkingGrading.objects.get(pk=grading_id)
    except MarkingSearchForm.DoesNotExist:
        return HttpResponseNotFound('grading not found')
    
    try:
        section = MarkingSection.objects.get(pk=section_id)
    except MarkingSection.DoesNotExist:
        return HttpResponseNotFound('section not found')
    
    try:
        entry = MarkingGradingEntry.objects.get(grading=grading, section=section)
    except MarkingGradingEntry.DoesNotExist:
        entry = None

    context['student'] = student
    context['grading'] = grading
    context['section'] = section
    context['entry'] = entry
    context['api_url'] = django.urls.reverse('marking_entry',
                                             kwargs={'stu_id':student.id,
                                             'grading_id':grading.id,
                                             'section_id':section.id})
    if entry==None:
        context['comment'] = ''
        context['slider_score'] = 0
    else:
        context['comment'] = entry.comment
        context['slider_score'] = entry.score
    
    if request.method=='GET':
        class ResponseInfo:
            def __init__(self, response):
                self.info = response
                self.selected = (entry != None) and ( entry.response.id == response.id )
        
        context['responses'] = list(map(lambda x:ResponseInfo(x), section.responses.order_by('score')))

        return render(request, 'marking_entry.html', context)
    
    if request.method=='POST':
        if request.supervisor.admin:
            # Just allow editing
            pass
        elif request.supervisor != grading.marker:
            return HttpResponseForbidden('You can only edit mark sheets you own')
        
        try:
            response_id = int(request.POST['response'])
        except:
            return HttpResponseBadRequest('invalid response')
        
        try:
            response = MarkingSectionResponse.objects.get(pk=response_id)
        except MarkingSectionResponse.DoesNotExist:
            return HttpResponseForbidden('invalid reponse')

        form = MarkingEntryForm(request.POST)
        if not form.is_valid():
            return HttpResponseBadRequest(f'invalid form : {form.errors}')
        
        comment = form.cleaned_data['comment']
        try:
            score = int(form.cleaned_data['slider_score'])
        except ValueError:
            return HttpResponseBadRequest('score should be an integer')

        try:
            if entry==None:
                entry = MarkingGradingEntry.objects.create(grading=grading, section=section, response=response, score=score, comment=comment)
            else:
                entry.response = response
                entry.score = score
                entry.comment = comment
                entry.save()
        except ValidationError:
            # This is probably due to the unique_together constraint, so there's been a race between two saves.
            # The most likely case is a async API call due to the click, and then a POST from the form.
            # Just reapply with the data in ours
            try:
                entry = MarkingGradingEntry.objects.get(grading=grading, section=section)
                entry.response = response
                entry.score = score
                entry.comment = comment
                entry.save()
            except MarkingGradingEntry.DoesNotExist:
                pass # XXXTODO: Warn that something weird is going on

        grading.update_completed()

        return redirect('marking_sections', stu_id=student.id, grading_id=grading.id)
    
    return HttpResponseBadRequest('invalid method')

class MarkingSearchForm(django.forms.Form):
    query = django.forms.CharField(label='Search query')

@supervisor_required
def marking_start(request):
    context = request.context

    if request.method == 'POST':
        form = MarkingSearchForm(request.POST)
        if not form.is_valid():
            return HttpResponseBadRequest('Invalid form: {form.errors}')
        query = form.cleaned_data['query']
        context['results'] = MarkingStudent.objects.filter(
            django.db.models.Q(gn__icontains=query) |
            django.db.models.Q(fn__icontains=query) |
            django.db.models.Q(stu_num=query)
        ).order_by('gn','fn')
        return render(request, 'marking_students.html', context)
    
    context['form'] = MarkingSearchForm()

    # Get a list of all the students they have stuff with so they can get back to it easily
    gradings = MarkingGrading.objects.filter(marker=request.supervisor)
    students = {}
    for grading in gradings:
        student = grading.student
        key = (student.fn,student.gn)
        students[key] = student
    students = list(students.items())
    students.sort()
    students = list(map(lambda x:x[1], students))
    context['students'] = students

    return render(request,'marking_start.html', context)

class MarkingAsOther(django.forms.Form):
    supervisor = django.forms.ModelChoiceField(queryset=Supervisor.objects.all().order_by('dn'))
    assignment = django.forms.ModelChoiceField(queryset=MarkingAssignment.objects.all().order_by('description'))
    admin_create = django.forms.BooleanField(initial=True, required=True, widget=django.forms.HiddenInput)

@supervisor_required
def marking_new(request, stu_id):
    context = request.context

    try:
        student = MarkingStudent.objects.get(pk=stu_id)
    except MarkingSearchForm.DoesNotExist:
        return HttpResponseNotFound('student not found')
    
    context['student'] = student

    if request.method=='GET':
        context['assignments'] = MarkingAssignment.objects.all().order_by('description')
        context['marker'] = request.supervisor
        context['otherForm'] = MarkingAsOther()
        return render(request, 'marking_new.html', context)
    
    try:
        assignment_id = int(request.POST['assignment'])
    except:
        return HttpResponseBadRequest('invalid request')
    
    try:
        assignment = MarkingAssignment.objects.get(pk=assignment_id)
    except MarkingAssignment.DoesNotExist:
        return HttpResponseNotFound('invalid assignment id given')
    
    # Check if one exists already
    try:
        g = MarkingGrading.objects.filter(assignment=assignment, marker=request.supervisor, student=student)
        if g!=None and len(g)>0:
            g = g[0]
            # Skip the creation and redirect to the existing one
            return redirect('marking_sections', stu_id=student.id,grading_id=g.id)
    except MarkingGrading.DoesNotExist:
        pass
    
    if 'admin_create' in request.POST and request.supervisor.admin:
        as_other = MarkingAsOther(request.POST)
        if not as_other.is_valid():
            return HttpResponseBadRequest('Admin create option invalid form')
        
        rubric = assignment.latest_rubric()
        grading = MarkingGrading.objects.create(
            assignment=assignment,
            rubric=rubric,
            marker=as_other.cleaned_data['supervisor'],
            student=student,
        )

        return redirect('marking_sections', stu_id=student.id, grading_id=grading.id)

    rubric = assignment.latest_rubric()
    grading = MarkingGrading.objects.create(
        assignment=assignment,
        rubric=rubric,
        marker=request.supervisor,
        student=student,
    )
    
    return redirect('marking_sections', stu_id=student.id, grading_id=grading.id)

@supervisor_required
def marking_new_combined(request, stu_id):
    context = request.context

    try:
        student = MarkingStudent.objects.get(pk=stu_id)
    except MarkingSearchForm.DoesNotExist:
        return HttpResponseNotFound('student not found')
    
    context['student'] = student

    if request.method=='GET':
        context['combined'] = MarkingCombinedGrading.objects.all().order_by('name')

        return render(request, 'marking_new_combined.html', context)
    
    try:
        entry_id = int(request.POST['entry'])
    except ValueError:
        return HttpResponseNotFound('failed to find combined entry ID')
    
    try:
        combined = MarkingCombinedGrading.objects.get(pk=entry_id)
    except MarkingCombinedGrading.DoesNotExist:
        return HttpResponseNotFound('failed to find combined object')

    # Check for duplicate
    try:
        e = MarkingCombinedResult.objects.filter(combined=combined, student=student)
        if e!=None and len(e)>0:
            e = e[0]
            return redirect('marking_combined_result', stu_id=student.id, result_id=e.id)
    except MarkingCombinedResult.DoesNotExist:
        pass

    entry = MarkingCombinedResult.objects.create(
        combined=combined,
        student=student,
    )
    
    return redirect('marking_combined_result', stu_id=student.id, result_id=entry.id)

class CombinedSelectForm(django.forms.Form):
    combined = django.forms.ModelChoiceField(MarkingCombinedGrading.objects.all())

@admin_required
def marking_progress(request):
    context = request.context

    combined_obj = None
    if 'combined' in request.GET:
        try:
            combined_obj = MarkingCombinedGrading.objects.get(pk=request.GET['combined'])
        except MarkingCombinedGrading.DoesNotExist:
            return HttpResponseBadRequest('no such combined grading')

    results = []
    class ReportEntry:
        def __init__(self, student, combined, grade_count, reason):
            self.student = student
            self.combined = combined
            self.grade_count = grade_count
            self.reason = reason
            self.state = ''
            if combined==None:
                self.short_comments = ''
                self.completed = False
                self.state = 'danger'
            else:    
                self.short_comments = combined.comments[:60]
                self.completed = combined.completed()
                if not self.completed:
                    self.state = 'warning'
            

    for student in MarkingStudent.objects.order_by('fn','gn'):
        reason = ''

        # Look for individual gradings for the student
        grade_count = len(MarkingGrading.objects.filter(student=student))

        try:
            if combined_obj==None:
                combined = MarkingCombinedResult.objects.filter(student=student)
            else:
                combined = MarkingCombinedResult.objects.filter(student=student, combined=combined_obj)

            for comb in combined:
                if not comb.completed():
                    if comb.marks==None:
                        reason = 'No final marks entered'
                    else:
                        if min(comb.marks.values())==0:
                            reason = 'One mark is 0'
                        if sum(comb.marks.values())==0:
                            reason = 'No final marks entered'
                
                entry = ReportEntry(student, comb, grade_count, reason)
                results.append(entry)
                
        except MarkingCombinedResult.DoesNotExist:
            entry = ReportEntry(student, None, grade_count, reason)
            results.append(entry)

    context['results'] = results
    context['comb_select_form'] = CombinedSelectForm()

    return render(request, 'marking_progress.html', context)

class GradingForm(django.forms.Form):
    primary = django.forms.BooleanField(required=False)
    comments = django.forms.CharField(max_length=2048, required=False)

@supervisor_required
def marking_sections(request, stu_id, grading_id):
    context = request.context

    try:
        student = MarkingStudent.objects.get(pk=stu_id)
    except MarkingSearchForm.DoesNotExist:
        return HttpResponseNotFound('student not found')
    
    try:
        grading = MarkingGrading.objects.get(pk=grading_id)
    except MarkingSearchForm.DoesNotExist:
        return HttpResponseNotFound('grading not found')
    
    context['student'] = student
    context['grading'] = grading

    # Make virtual objects so we pull information from the grading entries
    class Section:
        def __init__(self, section_obj):
            self.info = section_obj
            # Find there's a entry
            try:
                entry = MarkingGradingEntry.objects.get(grading=grading, section=section_obj)
            except MarkingGradingEntry.DoesNotExist:
                entry = None

            self.entry = entry

            if entry==None:
                self.weighted = 0
            else:
                value = (section_obj.weight * entry.score) / 100
                self.weighted = value

    sections = grading.rubric.sections.order_by('ordering')
    sections = list(map(lambda x: Section(x), sections))
    context['sections'] = sections

    total = 0
    for entry in sections:
        total += entry.weighted
    context['total'] = total

    # Check for changes and save them
    if request.method=='POST':
        if request.supervisor.admin:
            # Just allow editing
            pass
        elif request.supervisor != grading.marker:
            return HttpResponseForbidden('You can only edit mark sheets you own')
        
        form = GradingForm(request.POST)
        if not form.is_valid():
            return HttpResponseBadRequest(f'invalid form : {form.errors}')
        grading.comments = form.cleaned_data['comments']
        grading.primary = form.cleaned_data['primary']
        grading.save()
    
    # Prevent viewing of other peoples mark sheets
    if grading.can_view(request.supervisor):
        # Allow viewing
        pass
    else:
        return HttpResponseForbidden('You can only view mark sheets you own')

    details = GradingForm(data={
        'primary':grading.primary,
        'comments':grading.comments
    })

    context['details'] = details

    return render(request, 'marking_sections.html', context)

@supervisor_required
def marking_show_rubric(request, rubric_id):
    context = request.context

    try:
        rubric = MarkingRubric.objects.get(pk=rubric_id)
    except MarkingSearchForm.DoesNotExist:
        return HttpResponseNotFound('rubric not found')
    
    context['rubric'] = rubric
    context['version'] = rubric.version + 1

    return render(request, 'marking_show_rubric.html', context)

@supervisor_required
def marking_student(request, stu_id):
    context = request.context

    try:
        student = MarkingStudent.objects.get(pk=stu_id)
    except MarkingSearchForm.DoesNotExist:
        return HttpResponseNotFound('student not found')

    gradings = MarkingGrading.objects.filter(student=student).order_by('assignment__description')
    combined = MarkingCombinedResult.objects.filter(student=student).order_by('combined__name')

    context['student'] = student
    context['gradings'] = gradings
    context['combined_entries'] = combined

    return render(request, 'marking_student.html', context)

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
