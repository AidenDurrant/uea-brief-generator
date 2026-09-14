import csv
import os
import re

from django.core.management.base import BaseCommand, CommandError

from web.models import MarkingCombinedResult, MarkingCombinedComponent, MarkingGrading, MarkingCombinedGrading
import web.reports

REPLACE_RE = re.compile(r'''{{([A-Za-z0-9\-\_]+)}}''', re.I)
SPLIT_RE = re.compile(r'(?:\r\n)|\n|\S+', re.I)

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

class Command(BaseCommand):
    help = 'Generate PDF reports for each student in the marking system'

    def add_arguments(self, parser):
        # parser.add_argument('--detailed', action='store_true', help='Output detailed reports')
        parser.add_argument('combined', action='store', type=str, help='ID of the combined grading to us')
        parser.add_argument('dir', action='store', type=str, help='Directory to put generated reports int')
        parser.add_argument('--inc_desc', action='store_true', help='Include description of result for each section response')
        parser.add_argument('--inc_marks', action='store_true', help='Include full marks detail for each section')

    def handle(self, *args, **options):
        dest_dir = options['dir']

        output_file = open( os.path.join(dest_dir,'results.csv'), 'w', newline='')
        csv_writer = csv.writer(output_file, dialect='excel')

        # Get the column names/number mapping
        try:
            combined_obj = MarkingCombinedGrading.objects.get(pk=options['combined'])
        except MarkingCombinedGrading.DoesNotExist:
            print('failed to find combined grading object')

        components = MarkingCombinedComponent.objects.filter(combined=combined_obj).order_by('order')

        header = [
            'Family name',
            'Given name',
            'Student ID',
        ]
        for c in components:
            header.append(c.assignment.description)
        
        csv_writer.writerow( header )

        inc_desc = options['inc_desc']
        inc_marks = options['inc_marks']

        results = MarkingCombinedResult.objects.filter(combined=combined_obj)
        for result in results:
            student = result.student

            row = [
                student.fn,
                student.gn,
                student.stu_num
            ]

            if result.marks==None:
                print(f'No marks for {student.fn} {student.gn} {student.stu_num}, skipping')
                continue
            marks = list(result.marks.items())
            marks.sort()
            # print(marks)
            marks = list( map(lambda x:x[1], marks) )

            row = row + marks
            csv_writer.writerow( row )

            stu_dir = os.path.join(dest_dir, f'{student.fn}_{student.gn}-{student.stu_num}')
            if not os.path.exists(stu_dir):
                os.makedirs(stu_dir)

            # detailed = options['detailed']
            # web.reports.generate_report2(result.id, output_pdf_name, detailed=detailed)
            try:
                output_pdf_name = os.path.join(stu_dir, f'{student.fn}_{student.gn}-{student.stu_num}.pdf')
                web.reports.generate_report2(result.id, output_pdf_name, detailed=False)
                output_pdf_name = os.path.join(stu_dir, f'{student.fn}_{student.gn}-{student.stu_num}-detailed.pdf')
                web.reports.generate_report2(result.id, output_pdf_name, detailed=True, include_desc=inc_desc, include_marks=inc_marks)
            except Exception as e:
                print(f'ERROR: {student.stu_num}: {e}')

        output_file.close()
