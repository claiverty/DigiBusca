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

  v_remaining_count := v_daily_limit - v_daily_count - 1;
  v_window_end := (v_local_day + time '14:00') at time zone v_timezone;
  v_remaining_seconds := extract(epoch from (v_window_end - p_now));

  if v_remaining_count > 0 and v_remaining_seconds > 0 then
    -- Pace remaining contacts across the time left, with small natural variation
    -- and a ten-minute floor. The hard 14:00 cutoff takes precedence over the target.
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
