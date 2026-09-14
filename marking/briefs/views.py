"""Serve the exported Next.js bundle under /briefs/.

Everything -- HTML, the hashed _next/ chunks, the UEA logo -- goes out through
one view under one path, because the app's navigation and its <img> tags are all
relative. That also puts the whole thing behind the marking site's login gate:
InjectContext redirects anonymous visitors to /login and stores where they were
going, so a deep link into a review survives signing in.

The bundle is copied into briefs/bundle/ by `manage.py sync_brief_bundle`.
Deliberately *not* under briefs/static/: an app `static/` directory is picked up
by collectstatic, which would publish a second copy of the whole app at
/static/briefs/ -- served straight by the web server, outside the login gate
this view exists to sit behind.
"""

import mimetypes
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponsePermanentRedirect
from django.shortcuts import render
from django.urls import reverse

from web.views import supervisor_required

BUNDLE_ROOT = Path(__file__).resolve().parent / 'bundle'

# The chunk filenames are content-hashed, so a client fetches each one once.
IMMUTABLE_PREFIX = '_next/'
IMMUTABLE_MAX_AGE = 60 * 60 * 24 * 365


def _resolve(relative_path):
    """Map a URL path to a file inside the bundle, refusing anything outside it."""
    candidate = (BUNDLE_ROOT / relative_path).resolve()
    root = BUNDLE_ROOT.resolve()
    if candidate != root and root not in candidate.parents:
        raise Http404('Not found')
    return candidate


def _serve(candidate, immutable=False):
    if not candidate.is_file():
        raise Http404('Not found')

    content_type, _ = mimetypes.guess_type(candidate.name)
    response = FileResponse(
        candidate.open('rb'), content_type=content_type or 'application/octet-stream'
    )
    if immutable:
        response['Cache-Control'] = f'public, max-age={IMMUTABLE_MAX_AGE}, immutable'
    else:
        response['Cache-Control'] = 'no-cache'
    return response


def briefs_root(request):
    """`/briefs` -> `/briefs/`.

    Without the trailing slash the dashboard's relative `./builder` link would
    resolve to `/builder`, outside the app.
    """
    return HttpResponsePermanentRedirect(reverse('briefs_app'))


@supervisor_required
def briefs_index(request):
    if not bundle_is_present():
        context = dict(getattr(request, 'context', {}))
        context['msg'] = missing_bundle_hint()
        return render(request, 'generic_error.html', context, status=503)
    return _serve(_resolve('index.html'))


@supervisor_required
def briefs_asset(request, path):
    """Serve `<name>.html` for a page URL, or the file itself for an asset."""
    if not path or path.endswith('/'):
        raise Http404('Not found')

    if path.startswith(IMMUTABLE_PREFIX):
        return _serve(_resolve(path), immutable=True)

    page = _resolve(f'{path}.html')
    if page.is_file():
        return _serve(page)

    return _serve(_resolve(path))


def bundle_is_present():
    return (BUNDLE_ROOT / 'index.html').is_file()


def missing_bundle_hint():
    relative = BUNDLE_ROOT
    try:
        relative = BUNDLE_ROOT.relative_to(settings.BASE_DIR)
    except ValueError:
        pass
    return (
        f'The brief generator bundle is missing from {relative}. '
        'Run `npm run build` in frontend/, then `python manage.py sync_brief_bundle`.'
    )
