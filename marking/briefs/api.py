"""JSON endpoints for the brief generator, one per Supabase RPC it replaced.

Mounted under /api/v1/briefs/. That prefix is already exempt from the
InjectContext login gate (web/middleware.py checks `request.path[:5] == '/api/'`),
so an unauthenticated call returns a JSON 401 rather than an HTML redirect --
which is what the fetch() calls in the SPA need.

The middleware still populates `request.supervisor` on exempt paths whenever a
session cookie is present, so authentication here is just "is that set?".
"""

import functools
import json

from django.core.exceptions import PermissionDenied, ValidationError
from django.http import JsonResponse
from django.views.csrf import csrf_failure as default_csrf_failure
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
from django.middleware.csrf import get_token

from . import services

API_PREFIX = '/api/'


def _error(message, status):
    return JsonResponse({'error': message}, status=status)


def _message(exception):
    if isinstance(exception, ValidationError):
        return exception.messages[0] if exception.messages else 'Invalid request'
    return str(exception) or 'Permission denied'


def csrf_failure(request, reason='', template_name=None):
    """Answer a rejected API call in JSON instead of Django's HTML error page.

    CsrfViewMiddleware.process_view runs before the view, so the decorator below
    never gets the chance to return its own 401. It runs after InjectContext has
    populated `request.supervisor`, though, which is enough to tell "not signed
    in" (401) from "signed in but the token is missing or stale" (403).
    """
    if request.path.startswith(API_PREFIX):
        if getattr(request, 'supervisor', None) is None:
            return _error('Authentication required', 401)
        return _error(
            'CSRF verification failed. Reload the page and try again.', 403
        )
    return default_csrf_failure(request, reason)


def brief_api(oversight=False):
    """Wrap a service call as a JSON endpoint.

    The wrapped function is called as `view(request, supervisor, body)` and
    returns the value to place in `{"data": ...}`.

    Every endpoint is POST-only, including the read-only ones, so that Django's
    CSRF middleware covers all of them uniformly.
    """

    def decorator(view):
        @require_http_methods(['POST'])
        @functools.wraps(view)
        def wrapper(request, *args, **kwargs):
            supervisor = getattr(request, 'supervisor', None)
            if supervisor is None:
                return _error('Authentication required', 401)

            if oversight and not services.has_oversight(supervisor):
                return _error(services.OVERSIGHT_REQUIRED, 403)

            body = {}
            if request.body:
                try:
                    body = json.loads(request.body.decode('utf-8'))
                except (ValueError, UnicodeDecodeError):
                    return _error('Request body must be JSON', 400)
                if not isinstance(body, dict):
                    return _error('Request body must be a JSON object', 400)

            try:
                data = view(request, supervisor, body, *args, **kwargs)
            except PermissionDenied as exc:
                return _error(_message(exc), 403)
            except ValidationError as exc:
                return _error(_message(exc), 400)

            return JsonResponse({'data': data}, safe=False)

        return wrapper

    return decorator


# -----------------------------------------------------------------------------
# Session
# -----------------------------------------------------------------------------

@ensure_csrf_cookie
@require_http_methods(['GET'])
def session(request):
    """Who is signed in, plus the CSRF token for every mutating call after this.

    A statically-served page never gets a csrftoken cookie from a Django view,
    so the token is handed over in the body here and echoed back as X-CSRFToken.
    """
    supervisor = getattr(request, 'supervisor', None)
    if supervisor is None:
        return JsonResponse({'data': {'user': None, 'csrf_token': get_token(request)}})

    return JsonResponse(
        {
            'data': {
                'user': {
                    'id': str(supervisor.pk),
                    'email': None,
                    'user_metadata': {'full_name': supervisor.dn},
                },
                'csrf_token': get_token(request),
            }
        }
    )


# -----------------------------------------------------------------------------
# Workflow
# -----------------------------------------------------------------------------

@brief_api()
def review_queue(request, supervisor, body):
    return services.review_queue(supervisor)


@brief_api()
def assessment_review_status(request, supervisor, body):
    return services.assessment_review_status(
        supervisor, body.get('target_assessment_id')
    )


@brief_api()
def submit_assessment_for_review(request, supervisor, body):
    services.submit_for_review(supervisor, body.get('target_assessment_id'))
    return None


@brief_api()
def record_assessment_review(request, supervisor, body):
    services.record_review(
        supervisor,
        body.get('target_assessment_id'),
        body.get('target_stage'),
        body.get('decision'),
        body.get('review_comment'),
    )
    return None


@brief_api()
def assessment_can_export_final(request, supervisor, body):
    return services.can_export_final(supervisor, body.get('target_assessment_id'))


@brief_api(oversight=True)
def admin_override_assessment_approval(request, supervisor, body):
    services.admin_override(
        supervisor,
        body.get('target_assessment_id'),
        body.get('override_reason'),
    )
    return None


# -----------------------------------------------------------------------------
# Administration
# -----------------------------------------------------------------------------

@brief_api(oversight=True)
def admin_list_users(request, supervisor, body):
    return services.admin_list_users(supervisor)


@brief_api(oversight=True)
def admin_promote_user(request, supervisor, body):
    services.admin_promote_user(supervisor, body.get('target_user_id'))
    return None


@brief_api(oversight=True)
def admin_demote_user(request, supervisor, body):
    services.admin_demote_user(supervisor, body.get('target_user_id'))
    return None


@brief_api(oversight=True)
def admin_review_workflow_users(request, supervisor, body):
    return services.admin_review_workflow_users(supervisor)


@brief_api(oversight=True)
def admin_set_workflow_role(request, supervisor, body):
    services.admin_set_workflow_role(
        supervisor,
        body.get('target_user_id'),
        body.get('target_role'),
        body.get('enabled'),
    )
    return None


@brief_api(oversight=True)
def admin_review_assignments(request, supervisor, body):
    return services.admin_review_assignments(supervisor)


@brief_api(oversight=True)
def admin_cluster_lead_scopes(request, supervisor, body):
    return services.admin_cluster_lead_scopes(supervisor)


@brief_api(oversight=True)
def admin_set_cluster_lead_scope(request, supervisor, body):
    services.admin_set_cluster_lead_scope(
        supervisor,
        body.get('target_user_id'),
        body.get('target_programme'),
        body.get('target_module_level'),
        body.get('enabled'),
    )
    return None


# -----------------------------------------------------------------------------
# Reads that replaced the PostgREST table queries
# -----------------------------------------------------------------------------

@brief_api()
def my_assessments(request, supervisor, body):
    return services.my_assessments(supervisor)


@brief_api(oversight=True)
def all_assessments(request, supervisor, body):
    return services.all_assessments(supervisor)


@brief_api()
def save_assessment(request, supervisor, body):
    assessment = services.save_brief(
        supervisor, body.get('id'), body.get('record') or {}
    )
    return services.serialize_assessment(assessment)


@brief_api()
def delete_assessment(request, supervisor, body):
    services.delete_brief(supervisor, body.get('id'))
    return None


@brief_api()
def checker_candidates(request, supervisor, body):
    return services.checker_candidates(supervisor)


@brief_api()
def my_roles(request, supervisor, body):
    return services.my_roles(supervisor)


@brief_api()
def my_review_assignments(request, supervisor, body):
    return services.my_review_assignments(supervisor)


@brief_api(oversight=True)
def review_events(request, supervisor, body):
    return services.review_events(supervisor)
