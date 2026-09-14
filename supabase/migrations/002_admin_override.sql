-- =============================================================================
-- Administrator override of the checker / cluster lead approvals
--
-- Approval normally runs setter -> checker -> cluster lead, and both stages must
-- be approved at the assessment's current version before the owner can export a
-- final, unwatermarked PDF. When a reviewer is unavailable — or when no cluster
-- lead is scoped to the brief's programme and level, so it cannot even be
-- submitted — the owner is stuck with a DRAFT watermark forever.
--
-- This migration lets an administrator or teaching director force-approve both
-- stages of one assessment. Rather than a parallel bypass path, the override
-- writes through the existing approval records, so every downstream gate
-- (assessment_can_export_final, workflow_stage_is_actionable, the dashboards)
-- keeps working unmodified. The new overridden_by column records provenance,
-- and invalidate_assessment_reviews clears it so editing the brief voids the
-- override like any other approval.
--
-- Purely additive: 001_initial_schema.sql is not edited.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Provenance column
-- -----------------------------------------------------------------------------

-- Null means a genuine review decision; non-null names the administrator who
-- bypassed the stage. The existing row-level read policy covers it unchanged.
alter table public.assessment_review_assignments
  add column overridden_by uuid references auth.users (id);

-- -----------------------------------------------------------------------------
-- New audit action
-- -----------------------------------------------------------------------------

alter table public.assessment_review_events
  drop constraint assessment_review_events_action_check;

alter table public.assessment_review_events
  add constraint assessment_review_events_action_check check (
    action in (
      'assigned',
      'submitted',
      'approved',
      'withdrawn',
      'invalidated',
      'overridden'
    )
  );

-- -----------------------------------------------------------------------------
-- Void the override when the brief changes
-- -----------------------------------------------------------------------------

-- Identical to 001 except that overridden_by is cleared alongside the decision:
-- a new version has never been signed off, by a reviewer or by an administrator.
create or replace function private.invalidate_assessment_reviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Decisions are void, but the setter's checker nomination survives so the
  -- brief can be resubmitted without re-picking.
  update public.assessment_review_assignments as ara
  set reviewer_id = case
        when ara.stage = 'checker' then new.checker_id
        else null
      end,
      assigned_by = case
        when ara.stage = 'checker' then new.owner_id
        else null
      end,
      state = 'pending',
      reviewed_version = null,
      comment = null,
      reviewed_at = null,
      overridden_by = null
  where ara.assessment_id = new.id;

  insert into public.assessment_review_events (
    assessment_id,
    assessment_version,
    actor_id,
    action,
    comment
  ) values (
    new.id,
    new.version,
    auth.uid(),
    'invalidated',
    'Assessment brief changed; version ' || old.version::text
      || ' reviews were invalidated by version ' || new.version::text
  );

  return new;
end;
$function$;

-- -----------------------------------------------------------------------------
-- The override RPC
-- -----------------------------------------------------------------------------

create function public.admin_override_assessment_approval(
  target_assessment_id uuid,
  override_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  assessment_current_version integer;
  normalized_reason text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not private.workflow_has_oversight_access() then
    raise exception 'Administrator or Teaching Director access required'
      using errcode = '42501';
  end if;

  -- The reason lands in the permanent audit log, so it is not optional.
  normalized_reason := nullif(trim(override_reason), '');
  if normalized_reason is null or char_length(normalized_reason) < 2 then
    raise exception 'An override reason of at least 2 characters is required'
      using errcode = '22023';
  end if;

  -- Locked before the assignment write, mirroring record_assessment_review, so
  -- a concurrent save cannot bump the version underneath the approval.
  select a.version
  into assessment_current_version
  from public.assessments as a
  where a.id = target_assessment_id
  for update;

  if not found then
    raise exception 'Assessment not found: %', target_assessment_id
      using errcode = '22023';
  end if;

  -- Seeds the rows when the brief was never submitted, and force-approves any
  -- stage not already genuinely approved at this version. The where on the
  -- conflict clause preserves a real checker sign-off instead of overwriting it,
  -- and keeps the audit log to the stages actually bypassed.
  with overridden_stages as (
    insert into public.assessment_review_assignments as ara (
      assessment_id,
      stage,
      reviewer_id,
      assigned_by,
      state,
      reviewed_version,
      comment,
      reviewed_at,
      overridden_by
    )
    select
      target_assessment_id,
      required_stages.stage,
      auth.uid(),
      auth.uid(),
      'approved',
      assessment_current_version,
      normalized_reason,
      now(),
      auth.uid()
    from (
      values ('checker'::text), ('cluster_lead'::text)
    ) as required_stages(stage)
    on conflict (assessment_id, stage) do update
      set reviewer_id = auth.uid(),
          assigned_by = auth.uid(),
          state = 'approved',
          reviewed_version = assessment_current_version,
          comment = normalized_reason,
          reviewed_at = now(),
          overridden_by = auth.uid()
      where ara.state <> 'approved'
         or ara.reviewed_version is distinct from assessment_current_version
    returning ara.stage
  )
  insert into public.assessment_review_events (
    assessment_id,
    assessment_version,
    stage,
    reviewer_id,
    actor_id,
    action,
    comment
  )
  select
    target_assessment_id,
    assessment_current_version,
    overridden_stages.stage,
    auth.uid(),
    auth.uid(),
    'overridden',
    normalized_reason
  from overridden_stages;

  if not found then
    raise exception 'This assessment is already fully approved for the current version'
      using errcode = '22023';
  end if;

  -- private.prepare_assessment_version_update blocks direct writes to
  -- status/submitted_at/approved_at without this GUC. Nothing in the brief
  -- changes, so no version bump and no review invalidation follow.
  perform pg_catalog.set_config('app.workflow_transition', 'allowed', true);

  update public.assessments as a
  set status = 'approved',
      -- An overridden draft was never submitted, so give it a submission time.
      submitted_at = coalesce(a.submitted_at, now()),
      approved_at = now()
  where a.id = target_assessment_id;
end;
$function$;

-- -----------------------------------------------------------------------------
-- Expose the override marker to the reader RPCs
--
-- A returns-table signature cannot be changed by create or replace, so both are
-- dropped and recreated. Dropping also drops their grants, hence the re-issued
-- revoke/grant pairs at the foot of this file.
-- -----------------------------------------------------------------------------

drop function public.assessment_review_status(uuid);

create function public.assessment_review_status(
  target_assessment_id uuid
)
returns table (
  stage text,
  reviewer_id uuid,
  reviewer_name text,
  state text,
  reviewed_version integer,
  comment text,
  reviewed_at timestamptz,
  awaiting_previous_stage boolean,
  overridden_by uuid,
  overridden_by_name text
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or not private.workflow_can_access_assessment(target_assessment_id) then
    raise exception 'Assessment review access required' using errcode = '42501';
  end if;

  return query
  select
    ara.stage,
    ara.reviewer_id,
    reviewer_profile.display_name as reviewer_name,
    ara.state,
    ara.reviewed_version,
    ara.comment,
    ara.reviewed_at,
    not private.workflow_stage_is_actionable(ara.assessment_id, ara.stage)
      as awaiting_previous_stage,
    ara.overridden_by,
    override_profile.display_name as overridden_by_name
  from public.assessment_review_assignments as ara
  left join public.profiles as reviewer_profile
    on reviewer_profile.user_id = ara.reviewer_id
  left join public.profiles as override_profile
    on override_profile.user_id = ara.overridden_by
  where ara.assessment_id = target_assessment_id
  order by case ara.stage
    when 'checker' then 1
    when 'cluster_lead' then 2
  end;
end;
$function$;

drop function public.admin_review_assignments();

create function public.admin_review_assignments()
returns table (
  assessment_id uuid,
  stage text,
  reviewer_id uuid,
  reviewer_name text,
  state text,
  reviewed_version integer,
  comment text,
  reviewed_at timestamptz,
  overridden_by uuid,
  overridden_by_name text
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.workflow_has_oversight_access() then
    raise exception 'Administrator or Teaching Director access required'
      using errcode = '42501';
  end if;

  return query
  select
    ara.assessment_id,
    ara.stage,
    ara.reviewer_id,
    reviewer_profile.display_name as reviewer_name,
    ara.state,
    ara.reviewed_version,
    ara.comment,
    ara.reviewed_at,
    ara.overridden_by,
    override_profile.display_name as overridden_by_name
  from public.assessment_review_assignments as ara
  left join public.profiles as reviewer_profile
    on reviewer_profile.user_id = ara.reviewer_id
  left join public.profiles as override_profile
    on override_profile.user_id = ara.overridden_by
  order by ara.assessment_id,
    case ara.stage
      when 'checker' then 1
      when 'cluster_lead' then 2
    end;
end;
$function$;

-- -----------------------------------------------------------------------------
-- RPC execution grants
-- -----------------------------------------------------------------------------

revoke all on function public.admin_override_assessment_approval(uuid, text)
  from public, anon;
grant execute on function public.admin_override_assessment_approval(uuid, text)
  to authenticated;

-- Re-issued: dropping the two reader RPCs above dropped their grants with them.
revoke all on function public.admin_review_assignments() from public, anon;
grant execute on function public.admin_review_assignments() to authenticated;
revoke all on function public.assessment_review_status(uuid) from public, anon;
grant execute on function public.assessment_review_status(uuid) to authenticated;
