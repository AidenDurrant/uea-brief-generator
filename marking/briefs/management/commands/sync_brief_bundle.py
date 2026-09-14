"""Copy the exported Next.js bundle into the Django app.

`npm run build` in frontend/ writes ~3 MB to frontend/out/, almost all of it
content-hashed chunks. Committing that would mean megabytes of churn per build,
so the bundle is gitignored and synced in by this command instead.
"""

import shutil
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from briefs.views import BUNDLE_ROOT


class Command(BaseCommand):
    help = 'Copy frontend/out/ into briefs/static/briefs/ so Django can serve it.'

    @staticmethod
    def find_export():
        """Walk up from this file looking for frontend/out.

        Found rather than hard-coded so the command keeps working whatever depth
        the Django project sits at inside the repository.
        """
        for parent in Path(__file__).resolve().parents:
            candidate = parent / 'frontend' / 'out'
            if (candidate / 'index.html').is_file():
                return candidate
        return None

    def add_arguments(self, parser):
        parser.add_argument(
            '--source',
            default=None,
            help='Export directory to copy from (default: frontend/out).',
        )

    def handle(self, *args, **options):
        if options['source']:
            source = Path(options['source']).resolve()
        else:
            source = self.find_export()

        if source is None or not (source / 'index.html').is_file():
            raise CommandError(
                'No export found. Run `npm run build` in frontend/ first, or '
                'pass --source.'
            )

        if BUNDLE_ROOT.exists():
            shutil.rmtree(BUNDLE_ROOT)
        BUNDLE_ROOT.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source, BUNDLE_ROOT)

        files = sum(1 for item in BUNDLE_ROOT.rglob('*') if item.is_file())
        self.stdout.write(
            self.style.SUCCESS(f'Copied {files} files from {source} to {BUNDLE_ROOT}')
        )
