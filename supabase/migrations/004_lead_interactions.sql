create table if not exists public.lead_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id text not null,
  channel text not null,
  occurred_at date not null,
  notes text not null,
  outcome text,
  created_at timestamptz not null default now(),
  constraint lead_interactions_channel_check check (channel in ('WhatsApp', 'Telefone', 'E-mail', 'Outro')),
  constraint lead_interactions_notes_check check (char_length(trim(notes)) > 0)
);

create index if not exists lead_interactions_user_lead_date_idx
  on public.lead_interactions (user_id, lead_id, occurred_at desc, created_at desc);

alter table public.lead_interactions enable row level security;

drop policy if exists "Users can manage their lead interactions" on public.lead_interactions;
create policy "Users can manage their lead interactions"
  on public.lead_interactions
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.lead_interactions from anon;
grant select, insert, update, delete on table public.lead_interactions to authenticated;
