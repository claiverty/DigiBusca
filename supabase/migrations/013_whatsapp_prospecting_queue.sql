alter table public.whatsapp_messages
  add column if not exists source text not null default 'history';

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_source_check;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_source_check check (source in ('live', 'history'));

create table if not exists public.whatsapp_prospecting_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  daily_new_lead_limit smallint not null default 20 check (daily_new_lead_limit between 17 and 25),
  timezone text not null default 'America/Sao_Paulo',
  next_new_lead_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_prospecting_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_number_id text not null,
  lead_id text not null,
  recipient_phone text not null,
  message text not null check (length(trim(message)) between 1 and 1024),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'unknown', 'cancelled')),
  scheduled_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (phone_number_id, user_id)
    references public.whatsapp_phone_number_connections(phone_number_id, user_id)
    on delete cascade,
  foreign key (user_id, lead_id)
    references public.saved_leads(user_id, lead_id)
    on delete cascade
);

create unique index if not exists whatsapp_prospecting_one_first_contact_idx
  on public.whatsapp_prospecting_queue(user_id, lead_id)
  where status in ('queued', 'sending', 'sent', 'unknown');

create index if not exists whatsapp_prospecting_queue_due_idx
  on public.whatsapp_prospecting_queue(scheduled_at, created_at)
  where status = 'queued';

create index if not exists whatsapp_prospecting_queue_user_activity_idx
  on public.whatsapp_prospecting_queue(user_id, created_at desc);

alter table public.whatsapp_prospecting_settings enable row level security;
alter table public.whatsapp_prospecting_queue enable row level security;
revoke all on table public.whatsapp_prospecting_settings from public, anon, authenticated;
revoke all on table public.whatsapp_prospecting_queue from public, anon, authenticated;
grant all on table public.whatsapp_prospecting_settings to service_role;
grant all on table public.whatsapp_prospecting_queue to service_role;
grant select, update on table public.saved_leads to service_role;
grant insert on table public.lead_interactions to service_role;

create or replace function public.claim_whatsapp_prospecting_queue_item(
  p_queue_id uuid,
  p_now timestamptz default now()
)
returns setof public.whatsapp_prospecting_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.whatsapp_prospecting_queue%rowtype;
  v_daily_limit smallint;
  v_timezone text;
  v_next_new_lead_at timestamptz;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_daily_count integer;
  v_local_time time;
  v_local_day date;
begin
  select * into v_item
  from public.whatsapp_prospecting_queue
  where id = p_queue_id
  for update skip locked;

  if not found or v_item.status <> 'queued' or v_item.scheduled_at > p_now then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_item.user_id::text, 0));

  select daily_new_lead_limit, timezone, next_new_lead_at
  into v_daily_limit, v_timezone, v_next_new_lead_at
  from public.whatsapp_prospecting_settings
  where user_id = v_item.user_id and enabled = true
  for update;

  if not found then
    return;
  end if;

  v_local_time := p_now at time zone v_timezone;
  v_local_day := (p_now at time zone v_timezone)::date;
  if extract(isodow from v_local_day) not between 1 and 5 or v_local_time < time '09:00' or v_local_time >= time '18:00' then
    return;
  end if;

  if v_next_new_lead_at is not null and v_next_new_lead_at > p_now then
    return;
  end if;

  v_day_start := v_local_day::timestamp at time zone v_timezone;
  v_day_end := (v_local_day + 1)::timestamp at time zone v_timezone;
  select count(*) into v_daily_count
  from public.whatsapp_prospecting_queue
  where user_id = v_item.user_id and claimed_at >= v_day_start and claimed_at < v_day_end;

  if v_daily_count >= v_daily_limit then
    return;
  end if;

  update public.whatsapp_prospecting_queue
  set status = 'sending', claimed_at = p_now, updated_at = p_now
  where id = v_item.id and status = 'queued'
  returning * into v_item;

  if not found then
    return;
  end if;

  update public.whatsapp_prospecting_settings
  set next_new_lead_at = p_now + interval '18 minutes' + random() * interval '5 minutes',
      updated_at = p_now
  where user_id = v_item.user_id;

  return next v_item;
end;
$$;

revoke all on function public.claim_whatsapp_prospecting_queue_item(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_prospecting_queue_item(uuid, timestamptz) to service_role;

create or replace function public.list_whatsapp_prospecting_queue_candidates(
  p_now timestamptz default now(),
  p_limit integer default 25
)
returns table(queue_id uuid)
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
      and (p_now at time zone s.timezone)::time < time '18:00'
      and (
        select count(*)
        from public.whatsapp_prospecting_queue counted
        where counted.user_id = s.user_id
          and counted.claimed_at >= ((p_now at time zone s.timezone)::date::timestamp at time zone s.timezone)
          and counted.claimed_at < (((p_now at time zone s.timezone)::date + 1)::timestamp at time zone s.timezone)
      ) < s.daily_new_lead_limit
  ), ranked_queue as (
    select q.id, q.user_id, q.scheduled_at, q.created_at,
      row_number() over (partition by q.user_id order by q.scheduled_at, q.created_at) as user_position
    from public.whatsapp_prospecting_queue q
    join eligible_settings s on s.user_id = q.user_id
    where q.status = 'queued' and q.scheduled_at <= p_now
  )
  select ranked_queue.id
  from ranked_queue
  where ranked_queue.user_position = 1
  order by ranked_queue.scheduled_at, ranked_queue.created_at
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

revoke all on function public.list_whatsapp_prospecting_queue_candidates(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.list_whatsapp_prospecting_queue_candidates(timestamptz, integer) to service_role;
