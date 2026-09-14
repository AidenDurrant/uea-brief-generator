from django.core.management.base import BaseCommand, CommandError

from web.models import MarkingCombinedGrading

class Command(BaseCommand):
    help = 'List available combined gradings in the system'

    def handle(self, *args, **options):
        results = MarkingCombinedGrading.objects.order_by('id')
        for entry in results:
            print(f'{entry.id:4d} : {entry.name}')