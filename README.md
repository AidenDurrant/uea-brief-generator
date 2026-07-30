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
- **Admin dashboard:** `/admin/`

Only use synthetic assessment data until the university has approved the hosting, retention, and data-protection arrangements.

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

## 3. Apply the database migrations

For a new project, run the complete contents of this file in **Supabase → SQL Editor**:

```text
supabase/migrations/001_initial_schema.sql
```

If the original migration was applied before user profiles were introduced, also run:

```text
supabase/migrations/002_user_profiles.sql
```

The migrations create:

- `assessments`
- `profiles`
- `admin_users`
- indexes and automatic `updated_at` triggers
- assessment owner CRUD policies
- profile policies
- administrator read access
- protected administrator statistics RPC

Authenticated users may read display names so assessment ownership is understandable. Users may create and update only their own profile. They cannot add themselves to `admin_users`.

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
http://localhost:3000/admin/
https://YOUR_USERNAME.github.io/uea-brief-generator/
https://YOUR_USERNAME.github.io/uea-brief-generator/admin/
```

For the deployed prototype, the production GitHub Pages URL can be used as the Site URL after local testing.

## 5. First login and display names

After the first GitHub login, the application requires the user to choose a display name. The display name is stored in `profiles` and shown to administrators instead of relying on opaque authentication UUIDs.

The GitHub account remains the authentication identity. Changing the display name does not alter the user's GitHub account.

## 6. Create an administrator

First sign in through the application so Supabase creates the Auth user. Find the user UUID in **Authentication → Users**, then run:

```sql
insert into public.admin_users (user_id)
values ('USER_UUID_HERE')
on conflict (user_id) do nothing;
```

Administrators can then open:

```text
/admin/
```

Regular users see and modify only their own assessments. Administrators can read all assessment metadata and see owners' chosen display names.

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
- Administrators access all assessment data through `/admin/`.
- Uploaded images are currently stored inside the assessment JSON as data URLs. Move these to private object storage before production.

## Validation

```bash
npm run build
```

The static export generates both `/` and `/admin/` for GitHub Pages.

## Security boundaries

- Do not disable RLS.
- Do not expose the service-role key.
- Do not put the GitHub OAuth secret in the frontend or repository.
- Add administrators only through a trusted Supabase SQL/admin process.
- Use synthetic data during the trial.
- Obtain institutional approval before storing live assessment information.
