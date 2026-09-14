"""Set or clear an existing supervisor's password.

Clearing it (--clear) returns the account to Active Directory authentication,
which is what a production account normally uses.
"""

from getpass import getpass

from django.core.management.base import BaseCommand, CommandError

from web.models import Supervisor
from web.passwords import generate_password


class Command(BaseCommand):
    help = "Set, change or clear a supervisor's password."

    def add_arguments(self, parser):
        parser.add_argument('username')
        parser.add_argument(
            '--password',
            default=None,
            help='Password. Prompted for when omitted, which keeps it out of '
                 'your shell history.',
        )
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Remove the local password so the account authenticates '
                 'against Active Directory instead.',
        )

    def handle(self, *args, **options):
        username = options['username'].strip().lower()
        try:
            supervisor = Supervisor.objects.get(username=username)
        except Supervisor.DoesNotExist:
            raise CommandError(f'No supervisor named {username!r}')

        if options['clear']:
            supervisor.password = None
            supervisor.save(update_fields=['password'])
            self.stdout.write(
                self.style.SUCCESS(
                    f'Cleared the local password for {supervisor.dn}; it will '
                    'now authenticate against Active Directory.'
                )
            )
            return

        password = options['password']
        if password is None:
            password = getpass('New password: ')
            if password != getpass('New password (again): '):
                raise CommandError('The passwords did not match')
        if not password:
            raise CommandError(
                'An empty password would lock the account out; use --clear to '
                'fall back to Active Directory'
            )

        supervisor.password = generate_password(password)
        supervisor.save(update_fields=['password'])
        self.stdout.write(
            self.style.SUCCESS(f'Updated the password for {supervisor.dn}')
        )
