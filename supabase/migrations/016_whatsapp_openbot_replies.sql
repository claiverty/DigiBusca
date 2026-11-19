alter table public.whatsapp_automation_profiles
  add column if not exists openbot_agent_id text not null default '';

alter table public.whatsapp_automation_profiles
  drop constraint if exists whatsapp_automation_profiles_response_mode_check;

alter table public.whatsapp_automation_profiles
  add constraint whatsapp_automation_profiles_response_mode_check
  check (response_mode in ('handoff_only', 'gemini', 'openbot'));

alter table public.whatsapp_automation_profiles
  drop constraint if exists whatsapp_automation_profiles_openbot_agent_id_check;

alter table public.whatsapp_automation_profiles
  add constraint whatsapp_automation_profiles_openbot_agent_id_check
  check (length(openbot_agent_id) <= 128);

alter table public.whatsapp_automation_profiles
  drop constraint if exists whatsapp_automation_profiles_openbot_enabled_check;

alter table public.whatsapp_automation_profiles
  add constraint whatsapp_automation_profiles_openbot_enabled_check
  check (not automation_enabled or response_mode <> 'openbot' or length(trim(openbot_agent_id)) > 0);

alter table public.whatsapp_automation_runs
  add column if not exists response_provider text,
  add column if not exists openbot_agent_id text,
  add column if not exists openbot_client_message_id text,
  add column if not exists openbot_prompt text,
  add column if not exists openbot_request_started_at timestamptz,
  add column if not exists openbot_delivery_id text,
  add column if not exists generated_response jsonb,
  add column if not exists generated_reply_body text,
  add column if not exists sending_started_at timestamptz,
  add column if not exists profile_updated_at timestamptz,
  add column if not exists openbot_context_prepared_at timestamptz,
  add column if not exists openbot_context_cleared_at timestamptz,
  add column if not exists openbot_processing_claim_id uuid,
  add column if not exists openbot_processing_claimed_until timestamptz;

alter table public.whatsapp_automation_runs
  drop constraint if exists whatsapp_automation_runs_response_provider_check;

alter table public.whatsapp_automation_runs
  add constraint whatsapp_automation_runs_response_provider_check
  check (response_provider is null or response_provider in ('gemini', 'openbot'));

create unique index if not exists whatsapp_automation_runs_openbot_client_message_idx
  on public.whatsapp_automation_runs(openbot_agent_id, openbot_client_message_id)
  where openbot_agent_id is not null and openbot_client_message_id is not null;

create index if not exists whatsapp_automation_runs_openbot_pending_idx
  on public.whatsapp_automation_runs(created_at)
  where status = 'processing' and response_provider = 'openbot';

create table if not exists public.whatsapp_openbot_agent_locks (
  agent_id text primary key,
  active_run_id uuid not null references public.whatsapp_automation_runs(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_openbot_agent_locks enable row level security;
revoke all on table public.whatsapp_openbot_agent_locks from public, anon, authenticated;
grant all on table public.whatsapp_openbot_agent_locks to service_role;

create or replace function public.claim_whatsapp_openbot_agent_lock(p_agent_id text, p_run_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with claimed as (
    insert into public.whatsapp_openbot_agent_locks (agent_id, active_run_id, updated_at)
    values (p_agent_id, p_run_id, now())
    on conflict (agent_id) do update
      set active_run_id = excluded.active_run_id,
          updated_at = now()
      where public.whatsapp_openbot_agent_locks.active_run_id = excluded.active_run_id
         or exists (
           select 1
           from public.whatsapp_automation_runs previous_run
           where previous_run.id = public.whatsapp_openbot_agent_locks.active_run_id
             and previous_run.status <> 'processing'
         )
    returning 1
  )
  select exists (select 1 from claimed);
$$;

create or replace function public.release_whatsapp_openbot_agent_lock(p_agent_id text, p_run_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with released as (
    delete from public.whatsapp_openbot_agent_locks
    where agent_id = p_agent_id and active_run_id = p_run_id
    returning 1
  )
  select exists (select 1 from released);
$$;

create or replace function public.claim_whatsapp_openbot_run(p_run_id uuid, p_claim_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update public.whatsapp_automation_runs
    set openbot_processing_claim_id = p_claim_id,
        openbot_processing_claimed_until = now() + interval '30 seconds'
    where id = p_run_id
      and status = 'processing'
      and response_provider = 'openbot'
      and (
        openbot_processing_claim_id is null
        or openbot_processing_claimed_until < now()
        or openbot_processing_claim_id = p_claim_id
      )
    returning 1
  )
  select exists (select 1 from claimed);
$$;

create or replace function public.release_whatsapp_openbot_run(p_run_id uuid, p_claim_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with released as (
    update public.whatsapp_automation_runs
    set openbot_processing_claim_id = null,
        openbot_processing_claimed_until = null
    where id = p_run_id and openbot_processing_claim_id = p_claim_id
    returning 1
  )
  select exists (select 1 from released);
$$;

revoke all on function public.claim_whatsapp_openbot_agent_lock(text, uuid) from public, anon, authenticated;
revoke all on function public.release_whatsapp_openbot_agent_lock(text, uuid) from public, anon, authenticated;
revoke all on function public.claim_whatsapp_openbot_run(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_whatsapp_openbot_run(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_openbot_agent_lock(text, uuid) to service_role;
grant execute on function public.release_whatsapp_openbot_agent_lock(text, uuid) to service_role;
grant execute on function public.claim_whatsapp_openbot_run(uuid, uuid) to service_role;
grant execute on function public.release_whatsapp_openbot_run(uuid, uuid) to service_role;
