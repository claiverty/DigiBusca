-- Keep both outbound automations paused while the new identity-review and
-- OpenClaw-only delivery path is validated in production.
update public.whatsapp_prospecting_settings
set enabled = false, next_new_lead_at = null, updated_at = now()
where enabled is distinct from false or next_new_lead_at is not null;

update public.whatsapp_automation_profiles
set automation_enabled = false, updated_at = now()
where automation_enabled is distinct from false;

alter table public.whatsapp_prospecting_queue
  add column if not exists contact_verified_at timestamptz,
  add column if not exists contact_verified_by uuid references auth.users(id) on delete set null,
  add column if not exists contact_verification_reference text,
  add column if not exists contact_identity_verified boolean not null default false,
  add column if not exists delivery_status text not null default 'unconfirmed';

alter table public.whatsapp_prospecting_queue
  drop constraint if exists whatsapp_prospecting_queue_delivery_status_check;
alter table public.whatsapp_prospecting_queue
  add constraint whatsapp_prospecting_queue_delivery_status_check
  check (delivery_status in ('unconfirmed', 'sent', 'failed'));

-- A conversation is linked to a CRM lead only after a reviewed, identity-verified
-- prospecting contact has actually been sent.
alter table public.whatsapp_conversations
  add column if not exists linked_lead_id text;
alter table public.whatsapp_conversations
  add column if not exists automation_handoff_note text;
create index if not exists whatsapp_conversations_linked_lead_idx
  on public.whatsapp_conversations(user_id, linked_lead_id)
  where linked_lead_id is not null;

alter table public.lead_interactions
  add column if not exists whatsapp_message_id text;
create unique index if not exists lead_interactions_whatsapp_message_unique_idx
  on public.lead_interactions(user_id, whatsapp_message_id)
  where whatsapp_message_id is not null;

alter table public.whatsapp_prospecting_queue
  drop constraint if exists whatsapp_prospecting_queue_status_check;
alter table public.whatsapp_prospecting_queue
  add constraint whatsapp_prospecting_queue_status_check
  check (status in ('review_required', 'queued', 'sending', 'sent', 'failed', 'unknown', 'cancelled'));

-- Hold every previously queued contact until the owner records independent
-- identity evidence linking the WhatsApp user or profile to the saved business.
update public.whatsapp_prospecting_queue
set status = 'review_required', contact_verified_at = null, contact_verified_by = null,
    contact_verification_reference = null, contact_identity_verified = false, updated_at = now()
where status = 'queued'
  and (contact_verified_at is null or nullif(trim(contact_verification_reference), '') is null or contact_identity_verified = false);

-- No prospecting send may fall back to Evolution. Leave already transmitted rows
-- untouched, but cancel pending rows that were tied to an Evolution connection.
update public.whatsapp_prospecting_queue q
set status = 'cancelled', error_code = 'evolution_prospecting_disabled', updated_at = now()
from public.whatsapp_phone_number_connections c
where c.phone_number_id = q.phone_number_id and c.user_id = q.user_id
  and c.platform_type = 'EVOLUTION_API' and q.status in ('queued', 'review_required');

-- A previous Evolution worker may have reached the provider before stopping.
-- Keep those outcomes uncertain so the new OpenClaw worker never retries them.
update public.whatsapp_prospecting_queue q
set status = 'unknown', error_code = 'evolution_disabled_outcome_unknown', updated_at = now()
from public.whatsapp_phone_number_connections c
where c.phone_number_id = q.phone_number_id and c.user_id = q.user_id
  and c.platform_type = 'EVOLUTION_API' and q.status = 'sending';

-- This queue is reserved for businesses without a website in their Google profile.
update public.whatsapp_prospecting_queue q
set status = 'cancelled', error_code = 'lead_has_website', updated_at = now()
from public.saved_leads l
where l.user_id = q.user_id and l.lead_id = q.lead_id
  and q.status in ('review_required', 'queued')
  and (
    l.lead_data->>'opportunity' is distinct from 'Sem site'
    or nullif(trim(l.lead_data->>'website'), '') is not null
  );

update public.whatsapp_prospecting_queue q
set status = 'unknown', error_code = 'lead_no_longer_eligible_outcome_unknown', updated_at = now()
from public.saved_leads l
where l.user_id = q.user_id and l.lead_id = q.lead_id
  and q.status = 'sending'
  and (
    l.status <> 'Novo'
    or l.lead_data->>'opportunity' is distinct from 'Sem site'
    or nullif(trim(l.lead_data->>'website'), '') is not null
  );

drop index if exists public.whatsapp_prospecting_one_first_contact_idx;
create unique index whatsapp_prospecting_one_first_contact_idx
  on public.whatsapp_prospecting_queue(user_id, lead_id)
  where status in ('review_required', 'queued', 'sending', 'sent', 'unknown');

create or replace function public.enforce_whatsapp_prospecting_contact_review()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'sending'
    and (new.contact_verified_at is null or nullif(trim(new.contact_verification_reference), '') is null or new.contact_identity_verified is not true) then
    new.status := 'review_required';
    new.error_code := 'contact_review_required';
    return new;
  end if;
  if new.status = 'sending' and not exists (
    select 1 from public.whatsapp_phone_number_connections c
    where c.phone_number_id = new.phone_number_id and c.user_id = new.user_id and c.platform_type = 'OPENCLAW_WEB'
  ) then
    new.status := 'cancelled';
    new.error_code := 'transport_changed';
    return new;
  end if;
  if new.status = 'sending' and not exists (
    select 1 from public.saved_leads l
    where l.user_id = new.user_id and l.lead_id = new.lead_id and l.status = 'Novo'
      and l.lead_data->>'opportunity' = 'Sem site'
      and nullif(trim(l.lead_data->>'website'), '') is null
  ) then
    new.status := 'cancelled';
    new.error_code := 'lead_no_longer_eligible';
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_prospecting_contact_review_required on public.whatsapp_prospecting_queue;
create trigger whatsapp_prospecting_contact_review_required
before insert or update of status, contact_verified_at, contact_verification_reference, contact_identity_verified on public.whatsapp_prospecting_queue
for each row execute function public.enforce_whatsapp_prospecting_contact_review();

-- The trigger can move a stale row back to review_required or cancel it. Do not
-- consume a daily slot when that happens during the atomic claim.
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
  v_window_end timestamptz;
  v_remaining_count integer;
  v_remaining_seconds double precision;
  v_interval_seconds double precision;
begin
  select * into v_item
  from public.whatsapp_prospecting_queue
  where id = p_queue_id
  for update skip locked;

  if not found or v_item.status <> 'queued' or v_item.scheduled_at > p_now then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_item.user_id::text, 0));

  if exists (
    select 1
    from public.whatsapp_prospecting_queue prior
    where prior.user_id = v_item.user_id
      and prior.recipient_phone = v_item.recipient_phone
      and prior.id <> v_item.id
      and prior.status in ('sending', 'sent', 'unknown')
  ) then
    update public.whatsapp_prospecting_queue
    set status = 'cancelled', error_code = 'duplicate_phone_prevented', updated_at = p_now
    where id = v_item.id and status = 'queued';
    return;
  end if;

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
  if extract(isodow from v_local_day) not between 1 and 5
    or v_local_time < time '09:00'
    or v_local_time >= time '14:00' then
    return;
  end if;

  if v_next_new_lead_at is not null and v_next_new_lead_at > p_now then
    return;
  end if;

  v_day_start := v_local_day::timestamp at time zone v_timezone;
  v_day_end := (v_local_day + 1)::timestamp at time zone v_timezone;
  select count(*) into v_daily_count
  from public.whatsapp_prospecting_queue
  where user_id = v_item.user_id
    and claimed_at >= v_day_start
    and claimed_at < v_day_end
    and status in ('sending', 'sent', 'unknown');

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
  if v_item.status <> 'sending' then
    return next v_item;
    return;
  end if;

  v_remaining_count := v_daily_limit - v_daily_count - 1;
  v_window_end := (v_local_day + time '14:00') at time zone v_timezone;
  v_remaining_seconds := extract(epoch from (v_window_end - p_now));

  if v_remaining_count > 0 and v_remaining_seconds > 0 then
    v_interval_seconds := greatest(
      600::double precision,
      floor((v_remaining_seconds / v_remaining_count) * (0.95 + random() * 0.05))
    );

    if v_interval_seconds < v_remaining_seconds then
      update public.whatsapp_prospecting_settings
      set next_new_lead_at = p_now + (v_interval_seconds * interval '1 second'),
          updated_at = p_now
      where user_id = v_item.user_id;
    else
      update public.whatsapp_prospecting_settings
      set next_new_lead_at = v_window_end,
          updated_at = p_now
      where user_id = v_item.user_id;
    end if;
  else
    update public.whatsapp_prospecting_settings
    set next_new_lead_at = v_window_end,
        updated_at = p_now
    where user_id = v_item.user_id;
  end if;

  return next v_item;
end;
$$;

revoke all on function public.claim_whatsapp_prospecting_queue_item(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_prospecting_queue_item(uuid, timestamptz) to service_role;

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
      on c.phone_number_id = q.phone_number_id and c.user_id = q.user_id and c.platform_type = 'OPENCLAW_WEB'
    where q.status = 'queued' and q.contact_verified_at is not null
      and nullif(trim(q.contact_verification_reference), '') is not null
      and q.contact_identity_verified is true and q.scheduled_at <= p_now
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
  if p_platform_type <> 'OPENCLAW_WEB' then
    raise exception 'Prospecting sends require the OpenClaw WhatsApp Web transport.';
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
    where q.status = 'queued'
      and q.contact_verified_at is not null
      and nullif(trim(q.contact_verification_reference), '') is not null
      and q.contact_identity_verified is true
      and q.scheduled_at <= p_now
      and c.platform_type = p_platform_type
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
