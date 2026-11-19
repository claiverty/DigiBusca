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

  -- Serialize dispatches for this account before checking whether this phone
  -- already has a sent, uncertain, or in-flight first contact.
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
