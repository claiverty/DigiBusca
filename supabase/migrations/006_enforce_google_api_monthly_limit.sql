create or replace function public.reserve_google_api_usage(google_request_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request_user_id uuid := auth.uid();
  sao_paulo_now timestamp := now() at time zone 'America/Sao_Paulo';
  current_month_start date := date_trunc('month', sao_paulo_now)::date;
  current_usage bigint;
  monthly_limit constant bigint := 1000;
begin
  if request_user_id is null then
    raise exception 'Authentication is required to reserve Google API usage.';
  end if;

  if google_request_type not in ('text_search', 'place_details') then
    raise exception 'Invalid Google API request type.';
  end if;

  -- Serialize reservations so concurrent requests cannot pass the same remaining slot.
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
  values (
    request_user_id,
    sao_paulo_now::date,
    google_request_type,
    1
  )
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

revoke all on function public.reserve_google_api_usage(text) from public, anon;
grant execute on function public.reserve_google_api_usage(text) to authenticated;
