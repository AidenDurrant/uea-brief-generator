
from django.shortcuts import redirect
from django.conf import settings

from .models import MarkingStudent,Supervisor

class InjectContext:
    SESSION_STUDENT = '_s_student'
    SESSION_SUPERVISOR = '_s_supervisor'
    SESSION_TARGET = '_s_target'

    def __init__(self, get_reponse):
        self.get_response = get_reponse

    def __call__(self, request):
        # Before view and later middleware

        # Only do stuff if there's a session active for the request.
        if self.SESSION_STUDENT in request.session:
            username = request.session[self.SESSION_STUDENT]
            try:
                student = MarkingStudent.objects.get(username=username)
            except MarkingStudent.DoesNotExist:
                student = None

            context = {
                'user':student,
                'supervisor':False,
                'logged_in':True,
            }
            request.context = context
            request.student = student
            request.supervisor = None
        elif self.SESSION_SUPERVISOR in request.session:
            username = request.session[self.SESSION_SUPERVISOR]
            try:
                supervisor = Supervisor.objects.get(username=username)
            except Supervisor.DoesNotExist:
                supervisor = None

            context = {
                'user':supervisor,
                'supervisor':True,
                'logged_in':True,
            }
            request.context = context
            request.student = None
            request.supervisor = supervisor
        elif settings.DEBUG and request.path.startswith('/debug/'):
            # Allow anything that starts with debug
            pass
        else:
            # Now everything lives being login, so if we get here store where they were going and push to login
            context = {'user':None,'supervisor':False,'logged_in':False}
            request.context = context
            request.student = None
            request.supervisor = None

            if request.path == '/login':
                return self.get_response(request)
            elif request.path[:7] == '/admin/':
                return self.get_response(request)
            elif request.path[:5] == '/api/':
                return self.get_response(request)
            elif request.path[:15] == '/reset_password':
                return self.get_response(request)
            else:
                if request.path!='/favicon.ico':
                    # The full path, not just request.path: deep links into the
                    # brief generator carry their state in the query string
                    # (/briefs/review?assessment=...&stage=checker), and dropping
                    # it would land them on an empty review page after login.
                    request.session[self.SESSION_TARGET] = request.get_full_path()
                return redirect('login')
                

        response = self.get_response(request)

        # After view

        return response