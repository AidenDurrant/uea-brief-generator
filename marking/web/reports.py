import base64
import csv
import datetime
import os
import random
import re
import tempfile
import secrets
import shutil
import subprocess

from django.conf import settings

from web.models import MarkingCombinedResult, MarkingGrading
from web.models import MarkingCombinedResult, MarkingGrading, MarkingStudent, MarkingGradingEntry

REPLACE_RE = re.compile(r'''{{([A-Za-z0-9\-\_]+)}}''', re.I)
SPLIT_RE = re.compile(r'(?:\r\n)|\n|\S+', re.I)

def latex_safe(value):
    return value.replace('\\',r'\textbackslash').replace('&',r'\&').replace('%',r'\%').replace('$',r'\$').replace('_',r'\_').replace('^',r'\^').replace('{',r'\{').replace('}',r'\}').replace('#',r'\#')

# This is all for the mark sheet

def randbytes(length):
    b=[]
    for i in range(length):
        b.append(random.randrange(0,255))
    return bytes(b)

def render_latex(data, template, filename, detailed_comments=None):
    def rep_func(s):
        return data.get(s.group(1), 'MISSING-VALUE')
    latex = REPLACE_RE.sub(rep_func, template)

    # Make temp dir
    tmp_dir = os.path.join(settings.WEBSITE_TEMP_DIR, secrets.token_hex(16))
    os.makedirs(tmp_dir)
    
    # Write files
    _,fn = os.path.split(filename)
    fn_no_ext,ext = os.path.splitext(fn)
    tex_f = os.path.join(tmp_dir, f'{fn_no_ext}.latex')
    print(tex_f)
    with open(tex_f,'w', encoding='utf-8') as lf:
        lf.write(latex)

    # Build
    subprocess.call(['pdflatex','-interaction=batchmode', tex_f], cwd=tmp_dir)

    # Move output back
    pdf_f = os.path.join(tmp_dir, fn)
    # This is not needed for Linux, just for testing on Windows
    if os.path.exists(filename):
        os.remove(filename)
    os.rename(pdf_f, filename)

    # Remove the temporary directory
    shutil.rmtree(tmp_dir)

def generate_report2(combined_id, dest_fn, detailed=False, include_marks=False, include_desc=False):
    import pathlib
    src_dir = pathlib.Path(__file__).parent.absolute()
    temp_dir = tempfile.gettempdir()
    
    temp_prefix = base64.b32encode(randbytes(6))[:8].decode('utf-8')

    # Load the template from the output dir
    with open( os.path.join(src_dir, 'template-marksheet.latex'), 'r', encoding='utf-8') as f:
        template = f.read()

    try:
        result = MarkingCombinedResult.objects.get(pk=combined_id)
    except MarkingCombinedResult.DoesNotExist:
        raise ValueError('unknown grad object')

    student = result.student
    if result.marks==None:
        raise ValueError(f'No marks for {student.fn} {student.gn} {student.stu_num}, skipping')
    
    marks = result.marks
    combined_main = result.combined
    part_values = result.marks

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

    class CEntry:
        def __init__(self, assignment, gradings, mark):
            self.assignment = assignment
            self.gradings = gradings
            self.mark = mark
        
        def __str__(self):
            g = list(map(str, self.gradings))
            return f'ASS: {self.assignment} - MARK: {self.mark} - GRADS: {g}'

    parts = []
    for part in combined_main.parts.all().order_by('order'):
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

    first_marker_name = markers[0].dn
    if len(markers)>1:
        second_marker_name = markers[1].dn
    else:
        second_marker_name = 'None'

    now = datetime.datetime.now()

    params = {
        'REPORT_TITLE': '', #XXXTODO: Get this from the report object
        'NAME':f'{student.gn} {student.fn}',
        'STU_ID':student.stu_num,
        'FIRST_MARKER':first_marker_name,
        'SECOND_MARKER':second_marker_name,
        'DATE': now.strftime('%d/%m/%Y') ,
        'HEADER_1':combined_main.pdf_header_1,
        'HEADER_2':combined_main.pdf_header_2,
        'FIRST_TITLE':parts[0].assignment.short_title,
        'FIRST_P2':'FP2',
        'FIRST_P3':'FP3',
        'AGR_P2':'AP2',
        'SECOND_P2':'SP2',
        'SECOND_P3':'SP3',
        'AGR_P3':'AP3',
    }

    if len(parts)>1:
        params['SECOND_TITLE'] = parts[1].assignment.short_title
    else:
        params['SECOND_TITLE'] = None

    # for e in parts:
    #     print(e)
    # print(marks)

    params['FIRST_MARKER'] = first_marker_name
    if parts[0].gradings[0] == None:
        params['FIRST_P2'] = '-'
    else:
        params['FIRST_P2'] = str(parts[0].gradings[0].total())

    # print(parts[1].assignment.id)

    # params['AGR_P2'] = str(marks[0])
    params['AGR_P2'] = str( marks[ str(parts[0].assignment.id) ] )

    if len(parts)<2:
        params['FIRST_P3'] = '-'
        params['AGR_P3'] = '-'
    else:
        if parts[1].gradings[0] == None:
            params['FIRST_P3'] = '-'
        else:
            params['FIRST_P3'] = str(parts[1].gradings[0].total())
        # params['AGR_P3'] = str(marks[1])
        params['AGR_P3'] = str( marks[ str(parts[1].assignment.id) ] )

    if len(markers)>1:
        params['SECOND_MARKER'] = second_marker_name
        if parts[0].gradings[1] == None:
            params['SECOND_P2'] = '-'
        else:
            params['SECOND_P2'] = str(parts[0].gradings[1].total())
        if len(parts)<2 or parts[1].gradings[1] == None:
            params['SECOND_P3'] = '-'
        else:
            params['SECOND_P3'] = str(parts[1].gradings[1].total())
    else:
        params['SECOND_MARKER'] = '-'
        params['SECOND_P2'] = '-'
        params['SECOND_P3'] = '-'

    '''
    \begin{center}
    \begin{tabular}{| p{4.5cm} | p{3.5cm} | p{3.5cm} | p{3.5cm} |}
        \hline
         & Marker one & Marker two & Agreed Mark/100 \\ \hline
        {{FIRST_TITLE}} & {{FIRST_P2}} & {{SECOND_P2}} & {{AGR_P2}} \\
        /100 &  &  &  \\ \hline
        {{SECOND_TITLE}} & {{FIRST_P3}} & {{SECOND_P3}} & {{AGR_P3}} \\
        /100 &  &  &  \\ \hline
    \end{tabular}
    \end{center}
    '''

    # Build a marks table on the fly
    marks_table = []
    # Columns are based on the number of markers
    marks_row = [' & ']
    marks_row = marks_row + [' & '.join( map(lambda x:x.dn, markers) )] + [' & ', r'Agreed Mark/100 \\ \hline']
    marks_table.append( ''.join(marks_row) )
    # Empty row
    empty_row = ''.join(['/100 & '] + list(map(lambda x:' & ', markers)) + [r'\\ \hline'])

    for part in parts:
        marks_row = [part.assignment.short_title, ' & ']
        for g in part.gradings:
            marks_row.append( str(g.total()) )
            marks_row.append( ' & ' )
        marks_row.append( str(marks[ str(part.assignment.id)]) )
        marks_row.append( r' \\' )
        marks_table.append(''.join(marks_row))
        marks_table.append( empty_row )

    params['MARKS_TABLE'] = '\n'.join(marks_table)


    # split_text_debug = False
    params['COMMENTS'] = result.comments
    # used_lines = split_text(result.comments, 110, 'PORT_C_', params, 35, 175, debug=split_text_debug)

    output_pdf_name = dest_fn

    if detailed:
        params['DETAILED_COMMENTS'] = student_report2('', student, result.combined, include_marks=include_marks,include_desc=include_desc)
    else:
        params['DETAILED_COMMENTS'] = ''

    render_latex( params, template, output_pdf_name)

    return dest_fn

def gen_report( info, template ):
    def rep_func(s):
        return info.get(s.group(1), 'MISSING-VALUE')

    output = REPLACE_RE.sub(rep_func, template)
    return output

def split_text(text, line_length, prefix, target, page_limit, count, debug=False):
    if debug:
        print(text)
    text = text.replace('&','&amp;')
    words = SPLIT_RE.finditer(text)
    
    def add_line(words, id):
        line = ' '.join(words)
        key = f'{prefix}{id}'
        target[key] = line

    current_line = []
    current_line_len = 0
    id = 1
    for word in words:
        word = word.group(0)
        if debug:
            print(f'"{word}"')

        if word=='\r\n' or word=='\n':
            add_line(current_line, id)
            current_line = []
            current_line_len = 0
            id += 1
            continue

        if current_line_len + len(word) + 1 > line_length:
            add_line(current_line, id)
            current_line = [ word ]
            current_line_len = len(word) + 1
            id += 1
        else:
            current_line.append( word )
            current_line_len += len(word) + 1
    
    if current_line_len > 0:
        add_line(current_line, id)
        id += 1

    used_lines = id

    # Add in the empty lines
    while id<=count:
        target[ f'{prefix}{id}'] = ''
        id += 1

    return used_lines

# This is for the detailed report

def gen_grading_report(grading):
    report = []
    report.append(f'<h2>{grading.assignment.description}</h2>')
    report.append(f'<p><strong>Marker:</strong> {grading.marker.dn}</p>')

    if len(grading.comments)>0:
        report.append('<h3>Overall comments</h3>')
        report.append(f'<p>{grading.comments}</p>')

    # print('-'*50)
    # print(grading.assignment.description)
    # print(grading.marker.dn)

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

    for section in sections:
        report.append(f'<h3>{section.info.description}</h3>')
        report.append(f'<table>')
        report.append(f'<tr><td></td><td><strong>Score:</strong> {section.entry.score}%</td>')
        report.append(f'<td><strong>Weight:</strong> {section.info.weight}%</td>')
        report.append(f'<td><strong>Final Mark:</strong> {section.weighted}%</td></tr></table>')
        report.append(f'<p>{section.entry.response.description}</p>')
        # print(section.info.description)
        # print(section.entry.response.score)
        # print(section.info.weight)
        # print(section.weighted)
        if section.entry.comment:
            report.append(f'<p><strong>Detailed comment:</strong>{section.entry.comment}</p>')

    return ''.join(report)

# Detailed report PDF version

def student_report2(dest_fn, student, combined, include_marks=False, include_desc=False):
    # Find the assignments and extract the students gradings
    gradings = []
    for component in combined.parts.order_by('order'):
        assignment = component.assignment
        grading = MarkingGrading.objects.filter(student=student, assignment=assignment)
        if grading!=None and len(grading)>0:
            gradings += list(grading)

    # Get all the gradings
    #XXXTODO: Sort these nicely
    report = []
    gradings = map(lambda x:x, gradings)
    for grading in gradings:
        sub_report = gen_grading_report2(grading, include_marks=include_marks, include_desc=include_desc)
        report.append(sub_report)
    
    # header = f'''<html><body><h1>{combined.name}</h1>{student.gn} {student.fn} ({student.stu_num})<br>'''

    return ''.join(report)

def gen_grading_report2(grading, include_marks=False, include_desc=False):
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

    report = []

    report.append(r'\pagebreak')

    report.append(fr'''
    \begin{{center}}
    \begin{{tabular}}{{p{{15cm}}}}
        {{\Large {grading.assignment.description}}}\\
        \textbf{{Marker:}} {grading.marker.dn}\\
    \end{{tabular}}
\end{{center}}
''')

    report.append(rf'')
    report.append(rf'')

    # {grading.comments}

    for section in sections:
        report.append('')
        # report.append(r'\pagebreak')
        report.append(r'\begin{center}')
        report.append(r'\begin{tabular}{| p{2.5cm} | p{1.5cm} | p{2.5cm} | p{1.5cm} | p{2.5cm} | p{1.5cm} |}')
        report.append(r'\hline')
        report.append(fr'\multicolumn{{6}}{{|l|}}{{ \textbf{{Section:}} {latex_safe(section.info.description)}}} \\')
        report.append(r'\hline')

        # Include the response description if there is one.
        # This gives a rough idea of the marks, but not a final value.
        if include_desc and section.entry.response.description != None and len(section.entry.response.description)>0:
            report.append(fr'\multicolumn{{6}}{{|l|}}{{ {latex_safe(section.entry.response.description)} }} \\')
            report.append(r'\hline')

        if include_marks:
            report.append(fr'\textbf{{Score:}} & {section.entry.score}\% & \textbf{{Weight:}} & {section.info.weight}\% & \textbf{{Final Mark:}} & {section.weighted}\% \\')
            report.append(r'\hline')
            
        comment = latex_safe(section.entry.comment)
        report.append(fr'\multicolumn{{6}}{{|p{{14cm}}|}}{{ {comment} }} \\')
        report.append(r'\hline')
        report.append(r'\end{tabular}')
        report.append(r'\end{center}')

    return '\n'.join(report)

    # END

    # for section in sections:
    #     report.append(f'<h3>{section.info.description}</h3>')
    #     report.append(f'<table>')
    #     report.append(f'<tr><td></td><td><strong>Score:</strong> {section.entry.score}%</td>')
    #     report.append(f'<td><strong>Weight:</strong> {section.info.weight}%</td>')
    #     report.append(f'<td><strong>Final Mark:</strong> {section.weighted}%</td></tr></table>')
    #     report.append(f'<p>{section.entry.response.description}</p>')
    #     # print(section.info.description)
    #     # print(section.entry.response.score)
    #     # print(section.info.weight)
    #     # print(section.weighted)
    #     if section.entry.comment:
    #         report.append(f'<p><strong>Detailed comment:</strong>{section.entry.comment}</p>')

    # return ''.join(report)