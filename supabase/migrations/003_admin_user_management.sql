create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  display_name text,
  is_admin boolean
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
    profiles.user_id,
    profiles.display_name,
    admin_users.user_id is not null as is_admin
  from public.profiles as profiles
  left join public.admin_users as admin_users
    on admin_users.user_id = profiles.user_id
  order by lower(profiles.display_name), profiles.user_id;
end;
$function$;

create or replace function public.admin_promote_user(target_user_id uuid)
returns void
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

  if not exists (
    select 1
    from public.profiles
    where profiles.user_id = target_user_id
  ) then
    raise exception 'Cannot promote user without an existing profile: %', target_user_id
      using errcode = '22023';
  end if;

  insert into public.admin_users (user_id)
  values (target_user_id)
  on conflict (user_id) do nothing;
end;
$function$;

revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_list_users() from anon;
grant execute on function public.admin_list_users() to authenticated;

revoke all on function public.admin_promote_user(uuid) from public;
revoke all on function public.admin_promote_user(uuid) from anon;
grant execute on function public.admin_promote_user(uuid) to authenticated;
