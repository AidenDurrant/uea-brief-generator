create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  module_code text not null,
  academic_year text not null,
  assessment_type text not null,
  ai_policy text not null,
  group_work_permitted boolean not null default false,
  status text not null default 'draft',
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists assessments_owner_id_idx
  on public.assessments (owner_id);
create index if not exists assessments_status_idx
  on public.assessments (status);
create index if not exists assessments_academic_year_idx
  on public.assessments (academic_year);
create index if not exists assessments_assessment_type_idx
  on public.assessments (assessment_type);
create index if not exists assessments_updated_at_idx
  on public.assessments (updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists assessments_set_updated_at on public.assessments;
create trigger assessments_set_updated_at
before update on public.assessments
for each row
execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

alter table public.assessments enable row level security;
alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;

revoke all on table public.assessments from anon;
grant select, insert, update, delete on table public.assessments to authenticated;

revoke all on table public.profiles from anon;
grant select, insert, update on table public.profiles to authenticated;
revoke delete on table public.profiles from authenticated;

revoke all on table public.admin_users from anon;
revoke insert, update, delete on table public.admin_users from authenticated;
grant select on table public.admin_users to authenticated;

drop policy if exists "Users can read own assessments" on public.assessments;
create policy "Users can read own assessments"
on public.assessments
for select
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "Users can create own assessments" on public.assessments;
create policy "Users can create own assessments"
on public.assessments
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can update own assessments" on public.assessments;
create policy "Users can update own assessments"
on public.assessments
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can delete own assessments" on public.assessments;
create policy "Users can delete own assessments"
on public.assessments
for delete
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "Admins can read all assessments" on public.assessments;
create policy "Admins can read all assessments"
on public.assessments
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "Users can create own profile" on public.profiles;
create policy "Users can create own profile"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read own admin membership" on public.admin_users;
create policy "Users can read own admin membership"
on public.admin_users
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.admin_assessment_statistics()
returns table (
  total_assessments bigint,
  unique_owners bigint,
  group_work_assessments bigint,
  assessments_by_status jsonb,
  assessments_by_type jsonb,
  assessments_by_academic_year jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.admin_users
    where admin_users.user_id = auth.uid()
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  select
    count(*)::bigint,
    count(distinct assessments.owner_id)::bigint,
    count(*) filter (where assessments.group_work_permitted)::bigint,
    coalesce(
      (
        select jsonb_object_agg(status_counts.status, status_counts.assessment_count)
        from (
          select a.status, count(*)::bigint as assessment_count
          from public.assessments as a
          group by a.status
        ) as status_counts
      ),
      '{}'::jsonb
    ),
    coalesce(
      (
        select jsonb_object_agg(type_counts.assessment_type, type_counts.assessment_count)
        from (
          select a.assessment_type, count(*)::bigint as assessment_count
          from public.assessments as a
          group by a.assessment_type
        ) as type_counts
      ),
      '{}'::jsonb
    ),
    coalesce(
      (
        select jsonb_object_agg(year_counts.academic_year, year_counts.assessment_count)
        from (
          select a.academic_year, count(*)::bigint as assessment_count
          from public.assessments as a
          group by a.academic_year
        ) as year_counts
      ),
      '{}'::jsonb
    )
  from public.assessments as assessments;
end;
$function$;

revoke all on function public.admin_assessment_statistics() from public;
revoke all on function public.admin_assessment_statistics() from anon;
grant execute on function public.admin_assessment_statistics() to authenticated;
