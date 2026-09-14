import ldap3
from ldap3 import Server, Connection, ALL, NTLM, core, SUBTREE

from django.conf import settings
import django.db

from .models import MarkingStudent,Supervisor
from .middleware import InjectContext
from .passwords import check_password

def login(request, username, password):
    username = username.lower()
    if '@' in username:
        i = username.index('@')
        username = username[:i]
    elif '\\' in username:
        i = username.index('\\')
        username = username[i+1:]

    # Check for a supervisor account
    try:
        supervisor = Supervisor.objects.get(username=username)
        return login_supervisor(request, supervisor, password)
    except Supervisor.DoesNotExist:
        return False

def login_supervisor(request, account, password):
    if account.password!=None:
        valid = check_password(account.password, password)
    else:
        valid,_ = authenticate_user(account.username, password)

    if valid:
        request.session[InjectContext.SESSION_SUPERVISOR] = account.username
        return True
    return False


def authenticate_user(username, password):
    if settings.DISABLE_AD:
        return False, {}
    
    # dig SRV _ldap._tcp.dc._msdcs.uea.ac.uk
    servers = ['UEADCNR09.UEA.AC.UK', 'UEADCNR10.UEA.AC.UK', 'UEADCNR11.UEA.AC.UK', 'UEADCNR12.UEA.AC.UK']
    for server in servers:
        un = 'UEA\\%s'%(username)
        conn = Connection(server, user=un, password=password, authentication=NTLM)
        try:
            conn.start_tls()
        except Exception as e:
            # Try the next server
            print(e)
            continue

        if conn.bind():
            conn.search(
                search_base='dc=uea,dc=ac,dc=uk',
                search_filter='(&(objectClass=user)(uid=%s))'%(username),
                search_scope=SUBTREE,
                attributes=["employeeNumber", "info", "mail", "sn", "givenName"])
            if len(conn.response) > 0:
                info = conn.response[0]['raw_attributes']
                return True, info
            else:
                raise Exception('Failed to search for user details after bind')
        else:
            return False, {}

    raise Exception('Failed to connect to any server for authentication')