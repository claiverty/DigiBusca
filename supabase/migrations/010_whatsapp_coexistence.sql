alter table public.whatsapp_phone_number_connections
  add column if not exists access_token_ciphertext text,
  add column if not exists access_token_iv text,
  add column if not exists access_token_expires_at timestamptz,
  add column if not exists is_on_biz_app boolean not null default false,
  add column if not exists platform_type text,
  add column if not exists history_sync_state jsonb,
  add column if not exists app_state_sync_state jsonb;

drop policy if exists "Users can read their WhatsApp connections"
  on public.whatsapp_phone_number_connections;
revoke all on table public.whatsapp_phone_number_connections from public, anon, authenticated;
grant all on table public.whatsapp_phone_number_connections to service_role;

create table if not exists public.whatsapp_business_contacts (
  phone_number_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_wa_id text not null,
  contact_name text,
  is_removed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (phone_number_id, contact_wa_id),
  foreign key (phone_number_id, user_id)
    references public.whatsapp_phone_number_connections(phone_number_id, user_id)
    on delete cascade
);

alter table public.whatsapp_business_contacts enable row level security;
revoke all on table public.whatsapp_business_contacts from public, anon, authenticated;
grant all on table public.whatsapp_business_contacts to service_role;
