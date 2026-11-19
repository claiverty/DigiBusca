alter table public.whatsapp_automation_profiles
  add column if not exists agent_provider text not null default 'google',
  add column if not exists agent_model text not null default 'gemini-3.8-flash';

alter table public.whatsapp_automation_profiles
  drop constraint if exists whatsapp_automation_profiles_response_mode_check;
alter table public.whatsapp_automation_profiles
  add constraint whatsapp_automation_profiles_response_mode_check
  check (response_mode in ('handoff_only', 'gemini', 'openbot', 'digibot_agent'));

alter table public.whatsapp_automation_profiles
  drop constraint if exists whatsapp_automation_profiles_agent_provider_check;
alter table public.whatsapp_automation_profiles
  add constraint whatsapp_automation_profiles_agent_provider_check
  check (agent_provider in ('google', 'anthropic', 'openai-compatible'));

alter table public.whatsapp_automation_profiles
  drop constraint if exists whatsapp_automation_profiles_agent_model_check;
alter table public.whatsapp_automation_profiles
  add constraint whatsapp_automation_profiles_agent_model_check
  check (length(agent_model) between 1 and 128 and agent_model ~ '^[A-Za-z0-9_.:/-]+$');

alter table public.whatsapp_automation_runs
  drop constraint if exists whatsapp_automation_runs_response_provider_check;
alter table public.whatsapp_automation_runs
  add constraint whatsapp_automation_runs_response_provider_check
  check (response_provider is null or response_provider in ('gemini', 'openbot', 'digibot_agent'));

create table if not exists public.whatsapp_agent_qualifications (
  conversation_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fields jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  foreign key (conversation_id, user_id)
    references public.whatsapp_conversations(id, user_id) on delete cascade,
  check (jsonb_typeof(fields) = 'object'),
  check (length(fields::text) <= 4096)
);
create index if not exists whatsapp_agent_qualifications_expiry_idx
  on public.whatsapp_agent_qualifications(expires_at);

alter table public.whatsapp_agent_qualifications enable row level security;
revoke all on table public.whatsapp_agent_qualifications from public, anon, authenticated;
revoke all on table public.whatsapp_agent_qualifications from service_role;
grant select on table public.whatsapp_agent_qualifications to authenticated;
grant select, delete on table public.whatsapp_agent_qualifications to service_role;

drop policy if exists whatsapp_agent_qualifications_owner_read on public.whatsapp_agent_qualifications;
create policy whatsapp_agent_qualifications_owner_read
  on public.whatsapp_agent_qualifications
  for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.merge_whatsapp_agent_qualification(
  p_user_id uuid,
  p_conversation_id uuid,
  p_fields jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  merged_fields jsonb;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb or length(p_fields::text) > 2048 then
    raise exception 'invalid qualification fields';
  end if;
  if exists (
    select 1 from jsonb_each(p_fields) as entry(key, value)
    where entry.key not in ('projectType', 'objective', 'priority', 'timeline', 'serviceInterest')
       or jsonb_typeof(entry.value) <> 'string'
       or length(trim(entry.value #>> '{}')) = 0
       or length(entry.value #>> '{}') > 180
  ) then
    raise exception 'invalid qualification field value';
  end if;

  delete from public.whatsapp_agent_qualifications where expires_at <= now();

  insert into public.whatsapp_agent_qualifications (conversation_id, user_id, fields, updated_at, expires_at)
  values (p_conversation_id, p_user_id, p_fields, now(), now() + interval '90 days')
  on conflict (conversation_id) do update
    set fields = public.whatsapp_agent_qualifications.fields || excluded.fields,
        updated_at = now(),
        expires_at = now() + interval '90 days'
    where public.whatsapp_agent_qualifications.user_id = excluded.user_id
  returning fields into merged_fields;

  if merged_fields is null then
    raise exception 'qualification conversation ownership mismatch';
  end if;

  return merged_fields;
end;
$$;

revoke all on function public.merge_whatsapp_agent_qualification(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.merge_whatsapp_agent_qualification(uuid, uuid, jsonb) to service_role;

create or replace function public.purge_expired_whatsapp_agent_qualifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.whatsapp_agent_qualifications where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_whatsapp_agent_qualifications() from public, anon, authenticated;
grant execute on function public.purge_expired_whatsapp_agent_qualifications() to service_role;
