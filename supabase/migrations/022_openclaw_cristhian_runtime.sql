-- OpenClaw is the WhatsApp agent/transport. DigiBusca remains the scoped CRM,
-- consent, history, and prospecting-policy store.

alter table public.whatsapp_automation_profiles
  drop constraint if exists whatsapp_automation_profiles_response_mode_check;
alter table public.whatsapp_automation_profiles
  add constraint whatsapp_automation_profiles_response_mode_check
  check (response_mode in ('handoff_only', 'gemini', 'openbot', 'digibot_agent', 'openclaw'));

alter table public.whatsapp_automation_runs
  add column if not exists openclaw_run_id text;
alter table public.whatsapp_automation_runs
  add column if not exists openclaw_session_key text;
alter table public.whatsapp_automation_runs
  add column if not exists openclaw_send_reserved_at timestamptz;
alter table public.whatsapp_prospecting_queue
  add column if not exists outbound_send_authorized_at timestamptz;
alter table public.saved_leads
  add column if not exists whatsapp_outbound_authorization_status text not null default 'not_authorized',
  add column if not exists whatsapp_outbound_authorization_source text,
  add column if not exists whatsapp_outbound_authorization_at timestamptz;

alter table public.saved_leads
  drop constraint if exists saved_leads_whatsapp_outbound_authorization_status_check;
alter table public.saved_leads
  add constraint saved_leads_whatsapp_outbound_authorization_status_check
  check (whatsapp_outbound_authorization_status in ('not_authorized', 'authorized_by_owner'));

alter table public.whatsapp_automation_runs
  drop constraint if exists whatsapp_automation_runs_response_provider_check;
alter table public.whatsapp_automation_runs
  add constraint whatsapp_automation_runs_response_provider_check
  check (response_provider is null or response_provider in ('gemini', 'openbot', 'digibot_agent', 'openclaw'));

create index if not exists whatsapp_automation_runs_openclaw_run_idx
  on public.whatsapp_automation_runs(user_id, phone_number_id, openclaw_run_id)
  where response_provider = 'openclaw' and openclaw_run_id is not null;
create index if not exists whatsapp_automation_runs_openclaw_session_idx
  on public.whatsapp_automation_runs(user_id, phone_number_id, openclaw_session_key, created_at desc)
  where response_provider = 'openclaw' and openclaw_session_key is not null;

-- Keep the account owner's established prospecting authorization distinct
-- from recipient consent. The legacy search marker was not recipient opt-in.
update public.saved_leads
set whatsapp_outbound_authorization_status = 'authorized_by_owner',
    whatsapp_outbound_authorization_source = 'Autorização do titular para prospecção de leads retornados pela busca DigiBusca/Google Maps',
    whatsapp_outbound_authorization_at = coalesce(whatsapp_consent_at, now()),
    whatsapp_consent_status = 'unknown',
    whatsapp_consent_source = null,
    whatsapp_consent_at = null,
    updated_at = now()
where whatsapp_consent_status = 'opted_in'
  and whatsapp_consent_source = 'Busca DigiBusca/Google configurada pelo titular para retornar leads autorizados ao contato por WhatsApp';

-- Same monthly cap and reservation lock as the user-facing function, callable
-- only by the backend service role for the fixed OpenClaw owner account.
create or replace function public.reserve_google_api_usage_for_user(
  p_user_id uuid,
  p_request_type text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  sao_paulo_now timestamp := now() at time zone 'America/Sao_Paulo';
  current_month_start date := date_trunc('month', sao_paulo_now)::date;
  current_usage bigint;
  monthly_limit constant bigint := 1000;
begin
  if p_user_id is null then
    raise exception 'A fixed DigiBusca owner is required to reserve Google API usage.';
  end if;
  if p_request_type not in ('text_search', 'place_details') then
    raise exception 'Invalid Google API request type.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('digibusca-google-api-monthly-limit', 0));

  select
    coalesce((
      select sum(request_count)::bigint
      from public.google_api_usage_daily
      where usage_date >= current_month_start
        and usage_date < (current_month_start + interval '1 month')::date
    ), 0)
    + coalesce((
      select sum(request_count)::bigint
      from public.google_api_usage_baselines
      where month_start = current_month_start
    ), 0)
  into current_usage;

  if current_usage >= monthly_limit then
    return 'blocked';
  end if;

  insert into public.google_api_usage_daily (user_id, usage_date, request_type, request_count)
  values (p_user_id, sao_paulo_now::date, p_request_type, 1)
  on conflict (user_id, usage_date, request_type)
  do update set
    request_count = public.google_api_usage_daily.request_count + 1,
    updated_at = now();

  if current_usage + 1 >= monthly_limit then
    return 'reserved_at_limit';
  end if;
  return 'reserved';
end;
$$;

revoke all on function public.reserve_google_api_usage_for_user(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_google_api_usage_for_user(uuid, text) to service_role;

-- Keep the existing Evolution worker scoped to Evolution rows. OpenClaw reads
-- its own candidates through the sibling function, then sends natively.
create or replace function public.list_whatsapp_prospecting_queue_candidates(
  p_now timestamptz default now(),
  p_limit integer default 25
) returns table(queue_id uuid)
language sql
security definer
set search_path = public
as $$
  with eligible_settings as (
    select s.user_id, s.timezone, s.next_new_lead_at, s.daily_new_lead_limit,
      (p_now at time zone s.timezone)::date as local_day
    from public.whatsapp_prospecting_settings s
    where s.enabled = true
      and (s.next_new_lead_at is null or s.next_new_lead_at <= p_now)
      and extract(isodow from (p_now at time zone s.timezone)::date) between 1 and 5
      and (p_now at time zone s.timezone)::time >= time '09:00'
      and (p_now at time zone s.timezone)::time < time '14:00'
      and (
        select count(*)
        from public.whatsapp_prospecting_queue counted
        where counted.user_id = s.user_id
          and counted.claimed_at >= ((p_now at time zone s.timezone)::date::timestamp at time zone s.timezone)
          and counted.claimed_at < (((p_now at time zone s.timezone)::date + 1)::timestamp at time zone s.timezone)
          and counted.status in ('sending', 'sent', 'unknown')
      ) < s.daily_new_lead_limit
  ), ranked_queue as (
    select q.id, q.user_id, q.scheduled_at, q.created_at,
      row_number() over (partition by q.user_id order by q.scheduled_at, q.created_at) as user_position
    from public.whatsapp_prospecting_queue q
    join eligible_settings s on s.user_id = q.user_id
    join public.whatsapp_phone_number_connections c
      on c.phone_number_id = q.phone_number_id and c.user_id = q.user_id
    where q.status = 'queued' and q.scheduled_at <= p_now and c.platform_type = 'EVOLUTION_API'
  )
  select ranked_queue.id
  from ranked_queue
  where ranked_queue.user_position = 1
  order by ranked_queue.scheduled_at, ranked_queue.created_at
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

create or replace function public.list_whatsapp_prospecting_queue_candidates_for_platform(
  p_now timestamptz default now(),
  p_limit integer default 25,
  p_platform_type text default 'OPENCLAW_WEB'
) returns table(queue_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_platform_type not in ('EVOLUTION_API', 'OPENCLAW_WEB') then
    raise exception 'Unsupported WhatsApp transport.';
  end if;

  return query
  with eligible_settings as (
    select s.user_id, s.timezone, s.next_new_lead_at, s.daily_new_lead_limit,
      (p_now at time zone s.timezone)::date as local_day
    from public.whatsapp_prospecting_settings s
    where s.enabled = true
      and (s.next_new_lead_at is null or s.next_new_lead_at <= p_now)
      and extract(isodow from (p_now at time zone s.timezone)::date) between 1 and 5
      and (p_now at time zone s.timezone)::time >= time '09:00'
      and (p_now at time zone s.timezone)::time < time '14:00'
      and (
        select count(*)
        from public.whatsapp_prospecting_queue counted
        where counted.user_id = s.user_id
          and counted.claimed_at >= ((p_now at time zone s.timezone)::date::timestamp at time zone s.timezone)
          and counted.claimed_at < (((p_now at time zone s.timezone)::date + 1)::timestamp at time zone s.timezone)
          and counted.status in ('sending', 'sent', 'unknown')
      ) < s.daily_new_lead_limit
  ), ranked_queue as (
    select q.id, q.user_id, q.scheduled_at, q.created_at,
      row_number() over (partition by q.user_id order by q.scheduled_at, q.created_at) as user_position
    from public.whatsapp_prospecting_queue q
    join eligible_settings s on s.user_id = q.user_id
    join public.whatsapp_phone_number_connections c
      on c.phone_number_id = q.phone_number_id and c.user_id = q.user_id
    where q.status = 'queued' and q.scheduled_at <= p_now and c.platform_type = p_platform_type
  )
  select ranked_queue.id
  from ranked_queue
  where ranked_queue.user_position = 1
  order by ranked_queue.scheduled_at, ranked_queue.created_at
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
end;
$$;

revoke all on function public.list_whatsapp_prospecting_queue_candidates(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.list_whatsapp_prospecting_queue_candidates_for_platform(timestamptz, integer, text) from public, anon, authenticated;
grant execute on function public.list_whatsapp_prospecting_queue_candidates(timestamptz, integer) to service_role;
grant execute on function public.list_whatsapp_prospecting_queue_candidates_for_platform(timestamptz, integer, text) to service_role;
