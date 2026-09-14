# UEA Assessment Brief Builder

An assessment-brief builder hosted inside the UEA marking site. The editor is a
Next.js static export; Django owns the database, the accounts and the approval
workflow. A supervisor who is signed in to the marking site follows a link
straight into the builder — there is no second login.

## Architecture

- **Frontend:** Next.js static export (`frontend/`), served by Django under `/briefs/`
- **Backend:** the Django `briefs` app — models, workflow services and a JSON API at `/api/v1/briefs/`
- **Authentication:** the marking site's own `Supervisor` session. `/briefs/` sits behind its login gate
- **Authorization:** Django service functions (`marking/briefs/services.py`), which replaced the Postgres RLS policies and RPCs
- **Database:** whatever the marking site uses — SQLite locally, PostgreSQL in production
- **Display names:** `Supervisor.dn`; there is no separate profile record
- **Local drafts:** browser `localStorage`

Pages:

| URL | Page |
|---|---|
| `/briefs/` | User dashboard |
| `/briefs/builder` | Assessment brief builder |
| `/briefs/admin` | Administration dashboard |
| `/briefs/reviews` | Reviewer queue |
| `/briefs/review?assessment=ID&stage=STAGE` | Read-only review workspace |

Only use synthetic assessment data until the university has approved the
hosting, retention, and data-protection arrangements.

## Repository layout

```
marking/                The marking site checkout, unchanged in shape
  manage.py
  marking/              Django project package (settings, urls, wsgi)
  web/                  The marking site
  briefs/               NEW -- the brief generator, a sibling of web/
    bundle/             The built frontend, committed so releases need no Node
frontend/               NEW -- React source for the builder
supabase/               The original Supabase schema, kept for reference only
```

The marking site keeps its original layout: `briefs/` is simply a new Django app
next to `web/`. Nothing moved, so deployment paths, the WSGI entry point and the
SQLite location are all unchanged.

`supabase/migrations/` is the specification the Django port was written against.
It is no longer deployed; the Supabase version survives only as a separate demo.

## 1. Install and run

```bash
pip install -r requirements.txt   # in whatever environment you use
source dev-setup.bash             # development environment variables
python marking/manage.py migrate
python marking/manage.py runserver
```

`dev-setup.bash` must be sourced in any shell that runs `manage.py`: without it
`DEBUG` is off and settings refuse to load for want of `WEBSITE_STATIC`.

Then build and install the frontend bundle:

```bash
cd frontend && npm install && npm run build:install
```

`sync_brief_bundle` copies `frontend/out/` into `marking/briefs/bundle/`, which is
gitignored — re-run it after every frontend build. Django serves the whole tree,
including the hashed `_next/` chunks, so that every URL sits under one
login-gated root and the app's relative links and images keep working.

Open <http://127.0.0.1:8000/briefs/>. While `WEBSITE_DEBUG` is on you can sign in
with `/debug/login?supervisor=USERNAME`.

## 2. Day-to-day development

There are two loops, and which one to use depends on what you are changing.

### Django only

Nothing special — `python marking/manage.py runserver` reloads on save. The bundle in
`marking/briefs/bundle/` is only rebuilt when the React source changes.

### React, with hot reload

Run Django and the Next dev server side by side:

```bash
python marking/manage.py runserver          # terminal 1, port 8000
cd frontend && npm run dev          # terminal 2, port 3000
```

Then use **<http://localhost:3000/briefs/>** — not port 8000. `npm run dev` sets
`BRIEFS_DEV_PROXY=1`, which swaps the static export for a dev server that
proxies `/api/`, `/login`, `/logout` and `/debug/` through to Django on port
8000. Because the login goes through the same origin, the marking-site session
cookie reaches the dev server and the app behaves as it does in production,
with hot reload on top.

Point it at a different backend with `BRIEFS_DJANGO_ORIGIN`.

Two caveats. Anything outside `/briefs/` (the marking site itself) is not
proxied — open port 8000 for that. And the dev server does not exercise
`marking/briefs/views.py`, so test URL handling and caching against a real build before
believing it.

### React, against the real thing

A full rebuild takes about seven seconds, which is usually fast enough:

```bash
cd frontend && npm run build:install
```

That builds the export and syncs it into Django. It runs from `frontend/`, which
is usually a different terminal to the one running the server, so it sources
`dev-setup.bash` itself when the environment is not already set. After it,
<http://127.0.0.1:8000/briefs/> serves exactly what production will. Use this to
check anything touching URLs, assets, caching or the printed PDF.

### Sample data and test accounts

`./reset.bash` rebuilds the database from the fixtures in `web/fixtures/`. Those
include four supervisors covering each part of the approval workflow, plus the
two that `testdata.yaml` already provided. Every one of them has the password
`password`:

| Username | Name | Use for |
|---|---|---|
| `setter` | Dr Sam Setter | Writing and submitting a brief |
| `checker` | Dr Chris Checker | The first approval stage |
| `clead` | Prof Casey Lead | The second approval stage |
| `tdirector` | Prof Toni Director | Oversight without being an administrator |
| `rjal` | Dr. Rudy J. Lapeer | Administrator |
| `jc` | Dr Jeannette Chin | A second plain supervisor |

Sign in at `/login` like a real user, or skip the form with
`/debug/login?supervisor=USERNAME` while `WEBSITE_DEBUG` is on.

Brief-generator roles are not in the fixtures, because they live in the `briefs`
app rather than `web`. Grant them after loading:

```bash
python marking/manage.py grant_brief_role rjal admin
python marking/manage.py grant_brief_role tdirector teaching_director
python marking/manage.py grant_brief_role clead cluster_lead
```

`clead` also needs a scope before anything can be submitted for approval — add
one on `/briefs/admin` matching the programme and level of the brief you are
testing.

### Creating accounts

```bash
python marking/manage.py create_supervisor USERNAME --name "Dr Your Name"
```

It prompts for the password twice, so it stays out of your shell history; pass
`--password` instead when scripting. To change one later:

```bash
python marking/manage.py set_supervisor_password USERNAME
```

`--clear` removes the local password so the account falls back to Active
Directory, which is how production accounts normally authenticate.

There is also a route through the Django admin site at `/admin/` (the fixture
superuser is `admin` / `password`): **Supervisors → Add**, then select the row
and run the **Reset password** action, which returns a URL that lets the user
choose their own password. Two things to know about it. The URL is always built
with an `https://` scheme, so locally you have to change it to `http://` by
hand. And do not type a password into the admin's `password` field directly —
that column stores a scrypt parameter block, not a plaintext password, and a
plaintext value there breaks signing in.

## 3. Bootstrap the first administrator

Role changes go through endpoints that themselves require oversight, so the
first administrator is granted from the command line:

```bash
python marking/manage.py grant_brief_role USERNAME admin
```

`grant_brief_role` also handles `cluster_lead` and `teaching_director`, and takes
`--revoke`. After the first administrator exists, everything else is managed from
`/briefs/admin`.

Brief-generator roles are deliberately separate from the marking site's own
`Supervisor.admin` flag: being a marking administrator does not grant oversight
of assessment briefs.

## Roles

| Role | Grants |
|---|---|
| *(none)* | Create, edit and submit your own briefs |
| `cluster_lead` | Sign off briefs matching your programme/level scopes |
| `teaching_director` | Full oversight: read everything, manage roles, override approvals |
| `admin` | The same oversight powers, recorded under a distinct role |

Cluster Lead scopes are managed in the **Cluster lead scopes** panel on
`/briefs/admin`. Programme names are matched case- and whitespace-insensitively,
so `Computing Science` and `computing science` are one scope, not two.

## Assessment approval workflow

Approval runs in a fixed order:

```text
Setter (creator) -> Checker (nominated by the setter) -> Cluster Lead
```

1. An MO/Instructor (the setter) saves an assessment as a draft.
2. The setter nominates a **Checker** from the registered supervisors in the builder's review workflow bar. Any supervisor except the setter can be nominated.
3. The setter uses **Submit for approval**, which is separate from saving. Submission requires a nominated checker and at least one eligible non-owner Cluster Lead scoped to the assessment's programme and level.
4. The checker opens the read-only `/briefs/review` workspace to approve or request changes. Approval comments are optional; withdrawal/change comments are mandatory.
5. Only once the checker has approved the current version does the Cluster Lead stage open. Until then the brief appears in scoped Cluster Leads' queue marked *Waiting on checker*, and the approval controls are unavailable — the gate is enforced server-side, not just in the UI.
6. When both stages have approved the same assessment version, status becomes `approved` and the assessment is finalised.
7. Draft and incomplete-review exports carry a watermark. The setter receives a clean final export only after a server-side approval check.
8. Any saved brief edit after submission increments the version, invalidates both approvals, restores draft status and requires resubmission. The checker nomination survives so the brief can be resubmitted without re-picking.

The setter can change the nominated checker only while the assessment is a draft.
An assessment owner can never review their own assessment, and cannot nominate
themselves as checker. The nominated checker cannot also sign off as cluster
lead. Administrator and Teaching Director are separate, traceable roles with the
same oversight powers; neither adds a mandatory approval step.

### Administrator override

When a reviewer is unavailable — or when no cluster lead is scoped to a brief's
programme and level, so it cannot even be submitted — an administrator or
teaching director can force-approve both stages from `/briefs/admin`. The
override writes through the normal approval records rather than bypassing them,
so every downstream gate keeps working, and it names the administrator on the
printed approval block. A reason of at least two characters is required and is
kept in the audit log. Editing the brief voids an override like any other
approval.

## Authoring capabilities

- Cascading School → Programme → Module selectors backed by `frontend/app/module-catalog.json`
- GitHub-Flavoured Markdown, including native tables
- Inline mathematics with `$...$` and block mathematics with `$$...$$`, rendered by KaTeX
- UG grading matrices with a 40% pass threshold
- PGT grading matrices with a 50% pass threshold
- Optional module-specific weightings, marking schemes and grading matrices for co-taught assessments
- Image attachments embedded in saved brief content

KaTeX supports a broad, safe subset of LaTeX mathematics, but it is not a
complete TeX distribution and does not load arbitrary LaTeX packages.

### Maintaining the module catalogue

`frontend/app/module-catalog.json` contains:

- a reusable `modules` object keyed by module code;
- a list of schools;
- programmes within each school; and
- the module codes available to each programme.

To add a module, define its code and title once in `modules`, then add that code
to each relevant programme's `moduleCodes` array. To add another school or
programme, copy the existing JSON structure. The builder automatically updates
the Programme and Module dropdowns from this file. Existing saved briefs with
values that are not in the catalogue remain visible as labelled saved values
rather than being discarded.

## Persistence behaviour

- Unsaved edits are retained as a local browser draft.
- **Save New** creates an assessment; **Update** saves the selected one.
- The builder sidebar lists only the signed-in supervisor's assessments.
- Saving remains separate from submission for approval.
- Review decisions and invalidated versions are retained in the workflow audit log, which has no foreign keys so its rows outlive the assessments and accounts they name.
- Uploaded images are currently stored inside the assessment JSON as data URLs. Move these to private object storage before production.

## Validation

```bash
python marking/manage.py test briefs     # workflow, authorisation, CSRF and versioning
cd frontend && npm run build     # also runs the TypeScript check
```

## Deploying into an existing marking site

The brief generator is additive — a new `briefs` app plus a handful of small
edits to `web/` — but it is not a drop-in, and a few things will bite if they
are not handled deliberately.

### Releasing

A release is a pull, a migration and a restart:

```bash
git pull
python marking/manage.py migrate
# restart the application server
```

The built frontend is committed at `marking/briefs/bundle/`, so the server needs
no Node and no build step. Rebuild it whenever the React source changes, with
`npm run build:install` in `frontend/`, and commit the result.

One thing to check before the first release, because it is the only step that
can fail: see the unique-username migration below.

### What has to be carried across

Everything else is new files under `briefs/` and `frontend/`.

| File | Change |
|---|---|
| `marking/settings.py` | `'briefs'` in `INSTALLED_APPS`; `CSRF_FAILURE_VIEW`; `CSRF_TRUSTED_ORIGINS` (inside the `if DEBUG:` block only) |
| `web/urls.py` | `briefs` API under `api_patterns`, app URLs in `urlpatterns` |
| `web/models.py` | `UniqueConstraint` on `Supervisor.username` |
| `web/middleware.py` | `request.get_full_path()` instead of `request.path` for the post-login target |
| `web/templates/base.html` | Navbar links |
| `web/templates/dashboard_supervisor.html` | Dashboard card |

`web/management/commands/create_supervisor.py`, `set_supervisor_password.py` and
`web/fixtures/supervisors.yaml` are development conveniences and are optional.

### The unique-username migration can fail

`marking/web/migrations/0009_supervisor_supervisor_username_unique` adds a constraint to
a column that never had one. If production holds duplicate usernames it will
abort part-way through the deploy. Check first:

```bash
python marking/manage.py shell -c "
from django.db.models import Count
from web.models import Supervisor
print(list(Supervisor.objects.values('username').annotate(n=Count('id')).filter(n__gt=1)))
"
```

Resolve any duplicates before migrating. The constraint is worth having —
`web/auth.py` and `web/middleware.py` both call `Supervisor.objects.get(username=…)`
on every request, so a duplicate raises `MultipleObjectsReturned` and returns a
500 for that user on every page.

`0009` follows cleanly from the `0008` in the marking repo as it stands. If
upstream gains its own `0009` later, renumber and re-point this one at the real
latest migration, or Django will report conflicting leaf nodes. Confirm the
deployed database agrees with the code before releasing:

```bash
python marking/manage.py showmigrations web
```

### The bundle is committed, not built on the server

`marking/briefs/bundle/` holds the output of `npm run build` and is tracked in
git, which is what keeps a release down to a pull and a restart on a host with
no Node. The cost is that a frontend change rewrites about 2 MB of
content-hashed files, so those commits are large. If that becomes a problem the
alternative is to gitignore the directory and build in CI, at the price of a
build step in the release.

The bundle is deliberately **not** under `briefs/static/`. An app `static/`
directory is collected by `collectstatic`, which would publish a second copy of
the whole app at `/static/briefs/`, served directly by the web server and
therefore outside the login gate that `marking/briefs/views.py` exists to
enforce.

### Assets are served by Django

Every `_next/` chunk goes through WSGI: 15–19 requests for a cold page load,
then nothing, because the filenames are content-hashed and the responses carry
`Cache-Control: immutable`. That is fine for a departmental deployment but it
does occupy a worker per request on first load. If it becomes a problem, Next's
`assetPrefix` can move `_next/` to `/static/briefs/` and hand it to the web
server — at the cost of those assets no longer sitting behind the login gate.

### Behaviour changes to the marking site itself

Small, but they are changes to shared code rather than additions:

- **Post-login redirect** now preserves the query string. Deep links into a
  review need it; existing marking URLs are unaffected because none of them
  carried a query string through login.
- **`CSRF_FAILURE_VIEW`** is set globally. It returns JSON only for paths under
  `/api/`, and delegates to Django's default page for everything else.

### Rolling back

`briefs` owns its own tables and touches none of the marking site's, so backing
out means reverting the `web/`, `marking/` and template edits and running
`manage.py migrate briefs zero`. The `Supervisor.username` constraint is
independent and worth keeping either way.

## Security boundaries

- `version`, `status`, `submitted_at` and `approved_at` are written only by `marking/briefs/services.py`. They are absent from every API payload; a client that sends them is ignored.
- Every mutating endpoint re-checks object-level permission. `visible_assessments` and `can_access_assessment` are the two halves of the same rule and must stay in step.
- The API is POST-only and CSRF-protected. A statically-served page has no `csrftoken` cookie of its own, so the client fetches `GET /api/v1/briefs/session/` first and echoes the token back as `X-CSRFToken`.
- Bootstrap the first administrator with `grant_brief_role`; every later role change goes through the oversight-protected endpoints.
- Administrators cannot demote themselves or remove the final administrator.
- Use synthetic data during the trial, and obtain institutional approval before storing live assessment information.
