create table if not exists public.google_api_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  request_type text not null check (request_type in ('text_search', 'place_details')),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, request_type)
);

create table if not exists public.google_api_usage_baselines (
  month_start date primary key,
  request_count integer not null check (request_count >= 0)
);

insert into public.google_api_usage_baselines (month_start, request_count)
values ('2026-09-01', 403)
on conflict (month_start) do update
set request_count = excluded.request_count;

alter table public.google_api_usage_daily enable row level security;
alter table public.google_api_usage_baselines enable row level security;

drop policy if exists "Users can read their Google API usage" on public.google_api_usage_daily;
create policy "Users can read their Google API usage"
  on public.google_api_usage_daily
  for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their Google API usage" on public.google_api_usage_daily;
create policy "Users can insert their Google API usage"
  on public.google_api_usage_daily
  for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their Google API usage" on public.google_api_usage_daily;
create policy "Users can update their Google API usage"
  on public.google_api_usage_daily
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.increment_google_api_usage(google_request_type text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.google_api_usage_daily (user_id, usage_date, request_type, request_count)
  values (
    auth.uid(),
    (now() at time zone 'America/Sao_Paulo')::date,
    google_request_type,
    1
  )
  on conflict (user_id, usage_date, request_type)
  do update set
    request_count = public.google_api_usage_daily.request_count + 1,
    updated_at = now();
end;
$$;

create or replace function public.get_google_api_usage()
returns table (
  requests_today bigint,
  requests_this_month bigint,
  text_search_requests bigint,
  place_details_requests bigint,
  historical_requests bigint,
  monthly_limit bigint
)
language sql
security definer
set search_path = public
as $$
  with monthly_usage as (
    select request_type, sum(request_count)::bigint as request_count
    from public.google_api_usage_daily
    where usage_date >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
    group by request_type
  ),
  monthly_baseline as (
    select coalesce(sum(request_count), 0)::bigint as request_count
    from public.google_api_usage_baselines
    where month_start = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
  )
  select
    coalesce((
      select sum(request_count)
      from public.google_api_usage_daily
      where usage_date = (now() at time zone 'America/Sao_Paulo')::date
    ), 0)::bigint as requests_today,
    (
      coalesce((select sum(request_count) from monthly_usage), 0)
      + (select request_count from monthly_baseline)
    )::bigint as requests_this_month,
    coalesce((select request_count from monthly_usage where request_type = 'text_search'), 0)::bigint as text_search_requests,
    coalesce((select request_count from monthly_usage where request_type = 'place_details'), 0)::bigint as place_details_requests,
    (select request_count from monthly_baseline)::bigint as historical_requests,
    1000::bigint as monthly_limit;
$$;

revoke all on table public.google_api_usage_daily from anon;
revoke all on table public.google_api_usage_baselines from anon, authenticated;
grant select, insert, update on table public.google_api_usage_daily to authenticated;
revoke execute on function public.increment_google_api_usage(text) from public, anon;
revoke execute on function public.get_google_api_usage() from public, anon;
grant execute on function public.increment_google_api_usage(text) to authenticated;
grant execute on function public.get_google_api_usage() to authenticated;
