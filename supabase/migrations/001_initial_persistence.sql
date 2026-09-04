create extension if not exists pgcrypto;

create table if not exists public.saved_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id text not null,
  lead_data jsonb not null,
  status text not null default 'Novo',
  notes text,
  next_follow_up date,
  draft_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_leads_status_check check (status in ('Novo', 'Contatado', 'Respondeu', 'Proposta', 'Ganhou', 'Perdeu')),
  constraint saved_leads_user_lead_unique unique (user_id, lead_id)
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id text,
  business_name text not null,
  service text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  sold_at date not null,
  created_at timestamptz not null default now()
);

create index if not exists saved_leads_user_updated_idx
  on public.saved_leads (user_id, updated_at desc);

create index if not exists sales_user_sold_at_idx
  on public.sales (user_id, sold_at desc);

alter table public.saved_leads enable row level security;
alter table public.sales enable row level security;

drop policy if exists "Users can manage their saved leads" on public.saved_leads;
create policy "Users can manage their saved leads"
  on public.saved_leads
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their sales" on public.sales;
create policy "Users can manage their sales"
  on public.sales
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.saved_leads, public.sales from anon;
grant select, insert, update, delete on table public.saved_leads, public.sales to authenticated;
