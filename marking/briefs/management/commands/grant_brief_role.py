"""Grant or revoke a brief-generator role from the command line.

Bootstrapping: `admin_promote_user` needs oversight to call, so the very first
administrator cannot be created from the admin page. This does it.
"""

from django.core.management.base import BaseCommand, CommandError

from web.models import Supervisor

from briefs.models import ROLE_CHOICES, BriefRole

ROLES = [role for role, _ in ROLE_CHOICES]


class Command(BaseCommand):
    help = 'Grant (or, with --revoke, remove) a brief-generator role.'

    def add_arguments(self, parser):
        parser.add_argument('username', help='Supervisor username.')
        parser.add_argument('role', choices=ROLES)
        parser.add_argument(
            '--revoke', action='store_true', help='Remove the role instead.'
        )

    def handle(self, *args, **options):
        try:
            supervisor = Supervisor.objects.get(username=options['username'])
        except Supervisor.DoesNotExist:
            raise CommandError(f'No supervisor named {options["username"]!r}')

        role = options['role']
        if options['revoke']:
            removed, _ = BriefRole.objects.filter(
                supervisor=supervisor, role=role
            ).delete()
            message = (
                f'Removed {role} from {supervisor.dn}'
                if removed
                else f'{supervisor.dn} did not hold {role}'
            )
        else:
            _, created = BriefRole.objects.get_or_create(
                supervisor=supervisor, role=role
            )
            message = (
                f'Granted {role} to {supervisor.dn}'
                if created
                else f'{supervisor.dn} already holds {role}'
            )

        self.stdout.write(self.style.SUCCESS(message))
