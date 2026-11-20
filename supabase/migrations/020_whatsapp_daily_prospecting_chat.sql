create table if not exists public.whatsapp_prospecting_daily_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_date date not null,
  city text,
  segment text not null default 'Todos os segmentos',
  status text not null default 'awaiting_city'
    check (status in ('awaiting_city', 'processing', 'completed', 'failed')),
  searched_count integer not null default 0 check (searched_count >= 0),
  saved_count integer not null default 0 check (saved_count >= 0),
  queued_count integer not null default 0 check (queued_count >= 0),
  messages jsonb not null default '[]'::jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, campaign_date),
  check (jsonb_typeof(messages) = 'array' and length(messages::text) <= 12000),
  check (city is null or length(city) between 1 and 120),
  check (length(segment) between 1 and 120)
);

create index if not exists whatsapp_prospecting_daily_campaigns_user_date_idx
  on public.whatsapp_prospecting_daily_campaigns(user_id, campaign_date desc);

alter table public.whatsapp_prospecting_daily_campaigns enable row level security;
revoke all on table public.whatsapp_prospecting_daily_campaigns from public, anon, authenticated;
grant select on table public.whatsapp_prospecting_daily_campaigns to authenticated;
grant all on table public.whatsapp_prospecting_daily_campaigns to service_role;

drop policy if exists whatsapp_prospecting_daily_campaigns_owner_read
  on public.whatsapp_prospecting_daily_campaigns;
create policy whatsapp_prospecting_daily_campaigns_owner_read
  on public.whatsapp_prospecting_daily_campaigns
  for select to authenticated
  using (auth.uid() = user_id);

alter table public.whatsapp_prospecting_settings
  add column if not exists default_city text not null default 'Brasília, DF';

alter table public.whatsapp_prospecting_settings
  drop constraint if exists whatsapp_prospecting_default_city_length;
alter table public.whatsapp_prospecting_settings
  add constraint whatsapp_prospecting_default_city_length
  check (length(default_city) between 2 and 120);
