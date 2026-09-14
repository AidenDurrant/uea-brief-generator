from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator

import datetime
from functools import total_ordering

# Create your models here.
@total_ordering
class Supervisor(models.Model):
    username = models.CharField(max_length=32)
    password = models.CharField(max_length=256, blank=True, null=True)
    dn = models.CharField(max_length=128)
    bio = models.TextField(max_length=4096, blank=True, null=True)
    admin = models.BooleanField(default=False)

    class Meta:
        constraints = [
            # web.auth and web.middleware both look accounts up by username on
            # every request, so a duplicate would raise MultipleObjectsReturned
            # and 500 every page for that user.
            models.UniqueConstraint(fields=['username'], name='supervisor_username_unique'),
        ]

    def __str__(self):
        return self.dn
    
    def __lt__(self, other):
        return self.id<other.id

class SiteSettings(models.Model):
    TYPE_NONE = 0
    TYPE_STRING = 1
    TYPE_INT = 2
    TYPE_DATE = 3
    TYPE_BOOL = 4

    DATE_FORMAT = '%Y-%m-%d %H:%M:%S %z'

    key = models.CharField(max_length=128, unique=True)
    value = models.CharField(max_length=256)
    value_type = models.IntegerField(default=0)
    changed = models.DateTimeField(auto_now=True, db_index=True)

    @staticmethod
    def get_values(since=None):
        result = {}

        if since==None:
            entries = SiteSettings.objects.all()
        else:
            entries = SiteSettings.objects.filter(changed__gte=since)

        for entry in entries:
            value = entry.value
            if entry.value_type==SiteSettings.TYPE_STRING:
                pass
            elif entry.value_type==SiteSettings.TYPE_INT:
                value = int(value)
            elif entry.value_type==SiteSettings.TYPE_DATE:
                value = datetime.datetime.strptime(value, SiteSettings.DATE_FORMAT)
            elif entry.value_type==SiteSettings.TYPE_BOOL:
                if value.lower()=='true':
                    value = True
                else:
                    value = False
            else:
                raise ValueError(f'unsupported type found in database: {entry.value_type}')
            result[entry.key] = value

        return result

    @staticmethod
    def set(key, value):
        value_type = SiteSettings.TYPE_NONE

        if isinstance(value, str):
            value_type = SiteSettings.TYPE_STRING
        elif isinstance(value, bool):
            # isinstance on an int returns true if testing for bool, so check that first
            value_type = SiteSettings.TYPE_BOOL
            value = str(value)
        elif isinstance(value, int):
            value_type = SiteSettings.TYPE_INT
            value = str(value)
        elif isinstance(value, datetime.datetime):
            value_type = SiteSettings.TYPE_DATE
            value = value.strftime(SiteSettings.DATE_FORMAT)
        else:
            raise ValueError('value given is not a supported type')
        
        try:
            entry = SiteSettings.objects.get(key=key)    
        except SiteSettings.DoesNotExist:
            entry = SiteSettings(key=key)
        
        entry.value_type = value_type
        entry.value = value
        entry.save()

# The marking models

# Duplicating the students means we can remove the rest of the stuff we
# don't need to keep.
class MarkingStudent(models.Model):
    username = models.CharField(max_length=32, blank=True)
    gn = models.CharField(max_length=64)
    fn = models.CharField(max_length=64)
    stu_num = models.CharField(max_length=32)
    supervisor = models.CharField(max_length=1024, default='') # Should this be a foreign key?

    class Meta:
        indexes = [
            models.Index(fields=['fn','gn'])
        ]

    def __str__(self):
        return f'{self.gn} {self.fn} ({self.stu_num})'

class MarkingAssignment(models.Model):
    description = models.CharField(max_length=128)
     # This is used on the final marks PDF
    short_title = models.CharField(max_length=64)

    def new_rubric(self):
        create = False
        try:
            r = self.rubric.order_by('-version')
            if len(r)<1:
                create = True
        except MarkingRubric.DoesNotExist:
            create = True

        if create:
            new_r = MarkingRubric.objects.create(assignment=self, version=0)
            return new_r
        
        last_id = r[0].version
        new_r = MarkingRubric.objects.create(assignment=self, version=last_id+1)
        return new_r

    def latest_rubric(self):
        r = self.rubric.order_by('-version')
        if r==None or len(r)<1:
            new_r = MarkingRubric.objects.create(assignment=self, version=0)
            return new_r
        return r[0]
    
    def __str__(self):
        return self.description

class MarkingRubric(models.Model):
    ORDERING_START = 100
    SECTION_GAP = 10

    assignment = models.ForeignKey('MarkingAssignment', on_delete=models.CASCADE, related_name='rubric')
    version = models.IntegerField(validators=[MinValueValidator(0), MaxValueValidator(9999)], db_index=True)

    def add_section(self):
        sections = self.sections.order_by('-ordering')

        if sections==None or len(sections)<1:
            new_ordering = MarkingRubric.ORDERING_START
        else:
            new_ordering = sections[0].ordering + MarkingRubric.SECTION_GAP

        sec = MarkingSection.objects.create(
            rubric = self,
            description = 'New section',
            ordering = new_ordering,
            weight = 1,
        )
        return sec
    
    def __str__(self):
        return f'{self.assignment} v{self.version}'

    def reorder(self):
        index = MarkingRubric.ORDERING_START
        for section in self.sections.order_by('ordering'):
            section.ordering = index
            section.save()
            index += MarkingRubric.SECTION_GAP

    def validate(self):
        # Validate each section, then the whole things
        total_weight = 0

        for section in self.sections.all():
            total_weight += section.weight
            try:
                section.validate()
            except ValueError as ve:
                msg = ve.args[0]
                raise ValueError(f'Section "{section.description}" has an error: {msg}')

        if total_weight != 100:
            raise ValueError(f'Total weights of all sections does not equal 100: {total_weight}')

class MarkingSection(models.Model):
    rubric = models.ForeignKey('MarkingRubric', on_delete=models.CASCADE, db_index=True, related_name='sections')
    description = models.CharField(max_length=1024)
    ordering = models.IntegerField()
    weight = models.IntegerField(validators=[MinValueValidator(1), MaxValueValidator(100)])

    class Meta:
        ordering = ["ordering"]
        indexes = [
            models.Index(fields=['rubric','ordering'])
        ]

    def add_response(self):
        resp = MarkingSectionResponse.objects.create(
            section = self,
            description = 'New Response',
            score = 0,
        )
        return resp

    def move_before(self, target):
        # Get the full list
        sections = self.rubric.sections.order_by('ordering')
        new_order = None

        for i in range(len(sections)):
            if sections[i].id == target.id:
                # Before the first
                if i==0:
                    new_order = target.ordering - MarkingRubric.SECTION_GAP
                else:
                    gap = (sections[i-1].ordering - sections[i].ordering) / 2
                    new_order = sections[i].ordering + gap

                self.ordering = new_order
                self.save()
                break

    def __str__(self):
        return f'[{self.ordering}] {self.weight}% {self.description}'
    
    def validate(self):
        values = {}
        max_score = 0
        # Check there's no duplicates
        for resp in self.responses.all():
            new = values.get(resp.score, 0)
            values[resp.score] = new + 1
            if resp.score > max_score:
                max_score = resp.score
            # print(resp)

        values = values.values()
        if len(values)>0 and max(values)>1:
            raise ValueError('The same score has been used in multiple responses')
        
        # Check there's one 100%
        if max_score != 100:
            raise ValueError(f'Section "{self.description}" has no reponse of 100%')

class MarkingSectionResponse(models.Model):
    section = models.ForeignKey('MarkingSection', on_delete=models.CASCADE, db_index=True, related_name='responses')
    description = models.CharField(max_length=1024)
    score = models.IntegerField(validators=[MinValueValidator(0), MaxValueValidator(100)])

    class Meta:
        ordering = ["score"]
        indexes = [
            models.Index(fields=['section','score'])
        ]

    def __str__(self):
        return f'{self.section.description} > [{self.score}] {self.description}'

class MarkingGrading(models.Model):
    assignment = models.ForeignKey('MarkingAssignment', on_delete=models.CASCADE)
    rubric = models.ForeignKey('MarkingRubric', on_delete=models.CASCADE)
    marker = models.ForeignKey('Supervisor', on_delete=models.CASCADE)
    student = models.ForeignKey('MarkingStudent', on_delete=models.CASCADE, db_index=True)
    primary = models.BooleanField(default=False)
    completed = models.BooleanField(default=False)
    comments = models.CharField(max_length=2048, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['rubric','marker','student']),
            models.Index(fields=['assignment','student'])
        ]

    def can_view(self, viewer):
        # Admin check
        if viewer.admin:
            return True
        
        # Direct check
        if self.marker==viewer:
            return True
        
        # Indirect check, e.g. there's a grading object for the same student, on the same assignment
        entries = MarkingGrading.objects.filter( assignment=self.assignment, rubric=self.rubric, student=self.student, marker=viewer )
        for e in entries:
            print(e)
        if len(entries) > 0:
            return True
        
        return False


    def total(self):
        total = 0
        # This contains all of the selections made for grades in each section.
        for entry in self.entries.all():
            weight = entry.section.weight
            score = entry.score
            mark = weight * score # Max of 100*100
            total += mark
        return total / 100

    def validate(self):
        # Check there's a grade entry for every section in the rubric
        rubric = self.rubric.sections.all()
        entries = self.entries.all()
        if len(rubric)!=len(entries):
            raise ValueError('Missing grade entries')
        return True
        
    def update_completed(self):
        try:
            if self.validate():
                self.completed = True
                self.save()
        except ValueError:
            # Not completed yet
            pass

    def __str__(self):
        return f'<ASS: {self.assignment}  MARK: {self.marker}  PRI: {self.primary}'

class MarkingGradingEntry(models.Model):
    grading = models.ForeignKey('MarkingGrading', on_delete=models.CASCADE, related_name='entries')
    section = models.ForeignKey('MarkingSection', on_delete=models.CASCADE)
    response = models.ForeignKey('MarkingSectionResponse', on_delete=models.CASCADE)
    score = models.IntegerField(validators=[MinValueValidator(0), MaxValueValidator(100)])
    comment = models.TextField(max_length=2048, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['grading','section']),
            models.Index(fields=['grading','section','response'])
        ]
        unique_together = [('grading','section')]

class MarkingCombinedGrading(models.Model):
    name = models.CharField(max_length=1024, db_index=True)
    pdf_header_1 = models.CharField(max_length=256)
    pdf_header_2 = models.CharField(max_length=256)
    verify_question = models.CharField(max_length=1024, blank=True, null=True, default=None)
    # Switches for controlling detailed report output
    detailed_inc_marks = models.BooleanField(default=False, help_text='Include detailed marks in report PDF')
    detailed_inc_desc = models.BooleanField(default=False, help_text='Include description of response in report PDF')

    def __str__(self):
        return self.name

class MarkingCombinedComponent(models.Model):
    combined = models.ForeignKey('MarkingCombinedGrading', on_delete=models.CASCADE, related_name='parts')
    assignment = models.ForeignKey('MarkingAssignment', on_delete=models.CASCADE, related_name='combined')
    order = models.IntegerField()

    class Meta:
        indexes = [
            models.Index(fields=['combined', 'order'])
        ]

    def __str__(self):
        return f'{self.combined.name} - {self.assignment.description}'

class MarkingCombinedResult(models.Model):
    combined = models.ForeignKey('MarkingCombinedGrading', on_delete=models.CASCADE, related_name=None)
    student = models.ForeignKey('MarkingStudent', on_delete=models.CASCADE, db_index=True)
    marks = models.JSONField(blank=True, null=True)
    comments = models.TextField(max_length=8192)

    def access_check(self, supervisor):
        combined_main = self.combined
        for part in combined_main.parts.all():
            ass = part.assignment
            for grading in MarkingGrading.objects.filter(assignment=ass, student=self.student).order_by('-primary'):
                if grading.marker == supervisor:
                    return True
        return False

    def completed(self):
        if self.marks==None:
            return False
        return min(self.marks.values()) > 0