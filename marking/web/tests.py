from django.test import Client, TestCase

import datetime
import re
import time
import bs4

# Create your tests here.
from web.models import Student, Supervisor, Project, ProjectRequest, SiteSettings, SiteSettings
import web.models
from web.settings_cache import SettingsCache

class SettingsTests(TestCase):
    def test1(self):
        STUDENT_READONLY = 'st_ro'
        SUPERVISOR_READONLY = 'su_ro'
        SITE_TITLE_KEY = 's_title'
        SITE_TITLE_V = 'my site'
        STUDENT_MAX_PENDING_KEY = 'st_max_pending'
        STUDENT_MAX_PENDING_V = 2
        SITE_UPDATE_KEY = 's_update'
        SITE_UPDATE_V = datetime.datetime(2023, 6, 1, 9, 34, 2, tzinfo=datetime.timezone.utc)

        SiteSettings.set(STUDENT_READONLY, True)
        SiteSettings.set(SUPERVISOR_READONLY, False)
        SiteSettings.set(SITE_TITLE_KEY, SITE_TITLE_V)
        SiteSettings.set(STUDENT_MAX_PENDING_KEY, STUDENT_MAX_PENDING_V)
        SiteSettings.set(SITE_UPDATE_KEY, SITE_UPDATE_V)

        t = datetime.datetime.now(datetime.timezone.utc)
        time.sleep(0.5)

        settings = SiteSettings.get_values()

        self.assertDictContainsSubset( {
            STUDENT_READONLY: True,
            SUPERVISOR_READONLY: False,
            SITE_TITLE_KEY: SITE_TITLE_V,
            STUDENT_MAX_PENDING_KEY: STUDENT_MAX_PENDING_V,
            SITE_UPDATE_KEY: SITE_UPDATE_V,
        }, settings )

        SiteSettings.set(SUPERVISOR_READONLY, True)

        settings = SiteSettings.get_values()
        self.assertDictContainsSubset( {
            STUDENT_READONLY: True,
            SUPERVISOR_READONLY: True,
            SITE_TITLE_KEY: SITE_TITLE_V,
            STUDENT_MAX_PENDING_KEY: STUDENT_MAX_PENDING_V,
            SITE_UPDATE_KEY: SITE_UPDATE_V,
        }, settings )

        changed = SiteSettings.get_values(since=t)
        self.assertDictContainsSubset( {SUPERVISOR_READONLY: True}, changed )

    def test2(self):
        cache = SettingsCache()

        SITE_TITLE_KEY = 's_title'
        SITE_TITLE_V = 'my site'
        SITE_TITLE_V2 = 'my site2'

        cache.set(SITE_TITLE_KEY, SITE_TITLE_V)

        self.assertEqual(cache[SITE_TITLE_KEY], SITE_TITLE_V)

        # Change the value directly, outside the cache
        SiteSettings.set(SITE_TITLE_KEY, SITE_TITLE_V2)
        cache.change_refresh_time(2)
        
        # Check the cached value hasn't changed
        self.assertEqual(cache[SITE_TITLE_KEY], SITE_TITLE_V)

        time.sleep(2)

        # Check the new value has been pulled from the store into the cache
        self.assertEqual(cache[SITE_TITLE_KEY], SITE_TITLE_V2)

class MarkingTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.assignment1 = web.models.MarkingAssignment.objects.create(description='ass1')
        cls.student = web.models.MarkingStudent.objects.create(
            gn='student1',
            fn='student1',
            stu_num='1234'
        )
        cls.super1 = web.models.Supervisor.objects.create(
            username='super1',
            dn = 'supervisor1',
        )

    def test_marking_01(self):
        # .refresh_from_db()

        # Check auto rubric creation works
        rub = self.assignment1.latest_rubric()
        self.assertIsNotNone(rub)

        # Check latest_rubric returns the most recent if one exists
        rub2 = self.assignment1.latest_rubric()
        self.assertEquals(rub, rub2)

        # Add some sections
        sec1 = rub.add_section()
        sec1.description = 'sec1'
        sec1.weight = 20
        sec1.save()
        sec2 = rub.add_section()
        sec2.description = 'sec2'
        sec2.weight = 20
        sec2.save()
        sec3 = rub.add_section()
        sec3.description = 'sec3'
        sec3.weight = 60
        sec3.save()

        # Check sec2 is ordered after 1
        self.assertNotEqual(sec1,sec2)
        self.assertGreater(sec2.ordering, sec1.ordering)

        # Check sec3 is ordered after 2
        self.assertNotEqual(sec2,sec3)
        self.assertGreater(sec3.ordering, sec2.ordering)

        # print('\n---')
        # print(sec2)
        # print(sec3)
        # print('--')
        sec3.move_before(sec2)
        self.assertLess(sec3.ordering, sec2.ordering)
        # print(sec2)
        # print(sec3)
        # print('--')
        rub.reorder()
        # print( rub.sections.order_by('ordering') )

        resp1 = sec1.add_response()
        resp2 = sec1.add_response()
        sec1.refresh_from_db()

        with self.assertRaisesMessage(ValueError, 'The same score has been used in multiple responses'):
            sec1.validate()
        
        resp1.refresh_from_db()
        resp1.score = 50
        resp1.save()

        with self.assertRaises(ValueError):
            sec1.validate()

        resp2.refresh_from_db()
        resp2.score = 100
        resp2.save()

        sec1.validate()

        # This should fail, as sec2, sec3, have no values
        with self.assertRaises(ValueError):
            rub.validate()
        
        s2r1 = sec2.add_response()
        s2r1.description = 'ok'
        s2r1.score = 50
        s2r1.save()

        s2r2 = sec2.add_response()
        s2r2.description = 'great'
        s2r2.score = 100
        s2r2.save()

        s3r1 = sec3.add_response()
        s3r1.description = 'ok'
        s3r1.score = 50
        s3r1.save()

        s3r2 = sec3.add_response()
        s3r2.description = 'great'
        s3r2.score = 100
        s3r2.save()

        rub.validate()

        # Grading
        grading = web.models.MarkingGrading.objects.create(
            assignment = self.assignment1,
            rubric = self.assignment1.latest_rubric(),
            marker = self.super1,
            student = self.student,
        )
        print(grading)

        with self.assertRaises(ValueError):
            grading.validate()