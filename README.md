# UEA Assessment Brief Builder

A static-exported Next.js prototype for creating assessment briefs, authenticating users with GitHub through Supabase Auth, storing assessments in Supabase Postgres, and providing an RLS-protected administrator dashboard.

## Architecture

- **Frontend:** Next.js static export on GitHub Pages
- **Authentication:** GitHub OAuth through Supabase Auth
- **Database/API:** Supabase Postgres and generated REST API
- **Authorization:** PostgreSQL Row-Level Security
- **Local drafts:** Browser `localStorage`
- **Saved assessments:** Supabase `assessments` table
- **User identification:** Supabase `profiles` table with a user-provided display name
- **User dashboard and login homepage:** `/`
- **Assessment brief builder:** `/builder`
- **Legacy dashboard redirect:** `/dashboard`
- **Admin dashboard:** `/admin`
- **Reviewer queue homepage:** `/reviews`
- **Read-only review workspace:** `/review?assessment=ASSESSMENT_ID&category=REVIEW_CATEGORY`

Only use synthetic assessment data until the university has approved the hosting, retention, and data-protection arrangements.

## Authoring capabilities

- Cascading School → Programme → Module selectors backed by `app/module-catalog.json`
- GitHub-Flavoured Markdown, including native tables
- Inline mathematics with `$...$` and block mathematics with `$$...$$`, rendered by KaTeX
- UG grading matrices with a 40% pass threshold
- PGT grading matrices with a 50% pass threshold
- Optional module-specific weightings for co-taught assessments
- Image attachments embedded in saved brief content

KaTeX supports a broad, safe subset of LaTeX mathematics, but it is not a complete TeX distribution and does not load arbitrary LaTeX packages.

### Maintaining the module catalogue

`app/module-catalog.json` contains:

- a reusable `modules` object keyed by module code;
- a list of schools;
- programmes within each school; and
- the module codes available to each programme.

To add a module, define its code and title once in `modules`, then add that code to each relevant programme's `moduleCodes` array. To add another school or programme, copy the existing JSON structure. The builder automatically updates the Programme and Module dropdowns from this file. Existing saved briefs with values that are not in the catalogue remain visible as labelled saved values rather than being discarded.

## 1. Install and run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>.

## 2. Create the Supabase project

Create a free Supabase project. Copy the values from **Project Settings → API** into `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

The anonymous key is intended for browser use. Never expose the service-role key.

## 3. Apply the v1.0 database schema

After resetting or creating the Supabase project, run the single schema file in
**Supabase → SQL Editor**:

```text
supabase/migrations/001_initial_schema.sql
```

This schema is the clean v1.0 baseline and is intended for an empty database. It
contains the complete table, RLS, role, review workflow, audit, statistics and
RPC setup; no earlier migration files are required.

The schema creates:

- `assessments`
- `profiles`
- `admin_users`
- indexes and automatic `updated_at` triggers
- assessment owner CRUD policies
- profile policies
- administrator read access
- protected administrator statistics and user-management RPCs
- shared reviewer-role pools, Cluster Lead scopes and review audit events
- versioned approval, withdrawal and final-export RPCs

Authenticated users may read display names so assessment ownership is understandable. Users may create and update only their own profile. They cannot directly change Administrator or workflow-role membership; protected RPCs require either Administrator or Teaching Director oversight access.

The initial schema deliberately creates no privileged user. Complete the first
GitHub login and the one-time Administrator bootstrap in section 6 before
configuring reviewer roles or submitting assessments for approval.

## 4. Configure GitHub OAuth

### Create a GitHub OAuth App

1. Open **GitHub → Settings → Developer settings → OAuth Apps**.
2. Select **New OAuth App**.
3. Use a name such as `UEA Assessment Brief Prototype`.
4. Use the deployed GitHub Pages address as the homepage URL.
5. Use this Supabase callback URL as the authorization callback URL:

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

6. Create a client secret.

### Configure Supabase

Open **Supabase → Authentication → Providers → GitHub** and enable the provider using the GitHub OAuth client ID and client secret.

The GitHub secret belongs only in Supabase. Do not add it to frontend environment variables or GitHub Pages.

In **Supabase → Authentication → URL Configuration**, configure:

```text
Site URL:
http://localhost:3000

Additional redirect URLs:
http://localhost:3000/
http://localhost:3000/admin
http://localhost:3000/builder
http://localhost:3000/dashboard
http://localhost:3000/reviews
http://localhost:3000/review
https://YOUR_USERNAME.github.io/uea-brief-generator/
https://YOUR_USERNAME.github.io/uea-brief-generator/admin
https://YOUR_USERNAME.github.io/uea-brief-generator/builder
https://YOUR_USERNAME.github.io/uea-brief-generator/dashboard
https://YOUR_USERNAME.github.io/uea-brief-generator/reviews
https://YOUR_USERNAME.github.io/uea-brief-generator/review
```

For the deployed prototype, the production GitHub Pages URL can be used as the Site URL after local testing.

## 5. First login and display names

After the first GitHub login, the application requires the user to choose a display name. The display name is stored in `profiles` and shown to administrators instead of relying on opaque authentication UUIDs.

The GitHub account remains the authentication identity. Changing the display name does not alter the user's GitHub account.

## 6. Bootstrap the first administrator

This one-time trusted step is mandatory on a fresh database. First sign in
through the application so Supabase creates the Auth user and profile. Find the
user UUID in **Authentication → Users**, then run this from the Supabase SQL
Editor:

```sql
insert into public.admin_users (user_id)
values ('USER_UUID_HERE')
on conflict (user_id) do nothing;
```

Administrators can then open:

```text
/admin
```

Do not add a public “first user becomes admin” flow; bootstrapping through the trusted SQL Editor avoids a race-to-admin vulnerability. After this first assignment, Administrators and Teaching Directors can manage access through the protected dashboard controls.

Regular users see and modify only their own assessments. Administrators and Teaching Directors can read all assessment data, filter saved-variable statistics, review filtered deadlines in the calendar, see owners' chosen display names, and manage registered users and workflow roles.

## Assessment approval workflow

1. An MO/Instructor saves an assessment as a draft.
2. Administrators and Teaching Directors manage shared reviewer pools. Cluster Leads review the Academic category for assessments matching their programme and level scopes. AI Suitability Reviewers and Employability Skills Reviewers have separate specialist queues.
3. The owner uses **Submit for approval**, which is separate from saving. Submission requires at least one eligible non-owner reviewer in each required role pool.
4. Every eligible role-holder can see the relevant work in `/reviews`; no individual reviewer is assigned to an assessment. They open the read-only `/review` workspace to approve or request changes. Approval comments are optional; withdrawal/change comments are mandatory.
5. All three categories must approve the same assessment version before status becomes `approved`.
6. Draft and incomplete-review exports contain a watermark. The owner receives a clean final export only after an atomic server-side approval check.
7. Any saved brief edit after submission increments the version, invalidates all approvals, restores draft status and requires resubmission.

One user may hold multiple reviewer roles, but an assessment owner can never review their own assessment. Administrator and Teaching Director are separate, traceable roles with the same oversight powers; neither adds a mandatory approval step. The admin dashboard retains the review-event audit trail. Programme and level scope mappings are stored in `cluster_lead_scopes`; assessments without this metadata cannot enter the academic review queue.

## 7. Configure GitHub Pages build values

In **GitHub repository → Settings → Secrets and variables → Actions**, add:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

The existing `.github/workflows/deploy.yml` passes these values into the static build. Ensure **Settings → Pages → Source** is set to **GitHub Actions**, then push to `main`.

## 8. Persistence behavior

- Unsaved edits are retained as a local browser draft.
- **Save New** inserts an assessment into Supabase.
- **Update** updates the selected assessment.
- The builder sidebar lists only the signed-in user's assessments.
- Saving remains separate from submission for approval.
- Review decisions and invalidated versions are retained in the workflow audit log.
- Administrators access filtered statistics, assessment records, deadline calendars, and user role controls through `/admin`.
- Uploaded images are currently stored inside the assessment JSON as data URLs. Move these to private object storage before production.

## Validation

```bash
npm run build
```

The static export generates `/`, `/builder`, `/dashboard`, `/admin`, `/reviews` and `/review` for GitHub Pages.

## Security boundaries

- Do not disable RLS.
- Do not expose the service-role key.
- Do not put the GitHub OAuth secret in the frontend or repository.
- Bootstrap the first administrator through trusted Supabase SQL; subsequent role changes use protected admin-only RPCs in the dashboard.
- Administrators cannot demote themselves or remove the final administrator through the dashboard.
- Use synthetic data during the trial.
- Obtain institutional approval before storing live assessment information.
