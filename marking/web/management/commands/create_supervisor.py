"""Create a supervisor account from the command line.

The existing routes both go through the Django admin site: the CSV import, which
creates accounts with no password, and the "Reset password" action, which hands
back a URL to visit. Neither is convenient for setting up a local account, and
typing a password straight into the admin's `password` field does not work --
that column holds a scrypt parameter block, not a plaintext password, and a
plaintext value there makes the login view fail.
"""

from getpass import getpass

from django.core.management.base import BaseCommand, CommandError

from web.models import Supervisor
from web.passwords import generate_password


class Command(BaseCommand):
    help = 'Create a supervisor account with a password.'

    def add_arguments(self, parser):
        parser.add_argument('username', help='The username used to sign in.')
        parser.add_argument(
            '--name',
            required=True,
            help='Display name, e.g. "Dr Sam Setter".',
        )
        parser.add_argument(
            '--password',
            default=None,
            help='Password. Prompted for when omitted, which keeps it out of '
                 'your shell history.',
        )
        parser.add_argument(
            '--admin',
            action='store_true',
            help="Set the marking site's admin flag. This does not grant "
                 'access to the brief generator -- use grant_brief_role.',
        )

    def handle(self, *args, **options):
        username = options['username'].strip().lower()
        if not username:
            raise CommandError('A username is required')

        if Supervisor.objects.filter(username=username).exists():
            raise CommandError(
                f'{username!r} already exists. Use set_supervisor_password to '
                'change its password.'
            )

        password = options['password']
        if password is None:
            password = getpass('Password: ')
            if password != getpass('Password (again): '):
                raise CommandError('The passwords did not match')
        if not password:
            raise CommandError('An empty password would lock the account out')

        supervisor = Supervisor.objects.create(
            username=username,
            dn=options['name'],
            password=generate_password(password),
            admin=options['admin'],
        )

        self.stdout.write(
            self.style.SUCCESS(
                f'Created {supervisor.dn} ({supervisor.username}), id {supervisor.pk}'
            )
        )
