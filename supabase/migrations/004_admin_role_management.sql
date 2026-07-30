create or replace function public.admin_demote_user(target_user_id uuid)
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

  if target_user_id = auth.uid() then
    raise exception 'You cannot demote your own administrator account'
      using errcode = '22023';
  end if;

  -- Serialize demotions so two concurrent requests cannot remove every admin.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.admin_users_role_management')
  );

  if not exists (
    select 1
    from public.admin_users
    where admin_users.user_id = target_user_id
  ) then
    return;
  end if;

  if (select count(*) from public.admin_users) <= 1 then
    raise exception 'The final administrator cannot be demoted'
      using errcode = '22023';
  end if;

  delete from public.admin_users
  where admin_users.user_id = target_user_id;
end;
$function$;

revoke all on function public.admin_demote_user(uuid) from public;
revoke all on function public.admin_demote_user(uuid) from anon;
grant execute on function public.admin_demote_user(uuid) to authenticated;
