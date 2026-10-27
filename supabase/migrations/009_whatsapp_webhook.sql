create table if not exists public.whatsapp_phone_number_connections (
  phone_number_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  waba_id text,
  display_phone_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone_number_id, user_id)
);

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_number_id text not null,
  contact_wa_id text not null,
  contact_name text,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_direction text check (last_message_direction in ('inbound', 'outbound')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone_number_id, contact_wa_id),
  unique (id, user_id),
  foreign key (phone_number_id, user_id)
    references public.whatsapp_phone_number_connections(phone_number_id, user_id)
    on delete cascade
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_number_id text not null,
  conversation_id uuid not null,
  provider_message_id text not null,
  contact_wa_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text not null,
  body text,
  is_placeholder boolean not null default false,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (phone_number_id, provider_message_id),
  foreign key (phone_number_id, user_id)
    references public.whatsapp_phone_number_connections(phone_number_id, user_id)
    on delete cascade,
  foreign key (conversation_id, user_id)
    references public.whatsapp_conversations(id, user_id)
    on delete cascade
);

create table if not exists public.whatsapp_message_status_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_number_id text not null,
  conversation_id uuid not null,
  provider_message_id text not null,
  recipient_wa_id text not null,
  status text not null check (status in ('sent', 'delivered', 'read', 'failed')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (phone_number_id, provider_message_id, status, occurred_at, recipient_wa_id),
  foreign key (phone_number_id, user_id)
    references public.whatsapp_phone_number_connections(phone_number_id, user_id)
    on delete cascade,
  foreign key (conversation_id, user_id)
    references public.whatsapp_conversations(id, user_id)
    on delete cascade
);

create index if not exists whatsapp_conversations_user_activity_idx
  on public.whatsapp_conversations(user_id, last_message_at desc, id desc);
create index if not exists whatsapp_messages_conversation_activity_idx
  on public.whatsapp_messages(user_id, conversation_id, occurred_at desc, id desc);
create index if not exists whatsapp_status_events_conversation_message_idx
  on public.whatsapp_message_status_events(user_id, conversation_id, provider_message_id, occurred_at);

alter table public.whatsapp_phone_number_connections enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_message_status_events enable row level security;

drop policy if exists "Users can read their WhatsApp connections" on public.whatsapp_phone_number_connections;
create policy "Users can read their WhatsApp connections"
  on public.whatsapp_phone_number_connections for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their WhatsApp conversations" on public.whatsapp_conversations;
create policy "Users can read their WhatsApp conversations"
  on public.whatsapp_conversations for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their WhatsApp messages" on public.whatsapp_messages;
create policy "Users can read their WhatsApp messages"
  on public.whatsapp_messages for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their WhatsApp status events" on public.whatsapp_message_status_events;
create policy "Users can read their WhatsApp status events"
  on public.whatsapp_message_status_events for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.whatsapp_phone_number_connections from public, anon, authenticated;
revoke all on table public.whatsapp_conversations from public, anon, authenticated;
revoke all on table public.whatsapp_messages from public, anon, authenticated;
revoke all on table public.whatsapp_message_status_events from public, anon, authenticated;
grant select on table public.whatsapp_phone_number_connections to authenticated;
grant select on table public.whatsapp_conversations to authenticated;
grant select on table public.whatsapp_messages to authenticated;
grant select on table public.whatsapp_message_status_events to authenticated;
grant all on table public.whatsapp_phone_number_connections to service_role;
grant all on table public.whatsapp_conversations to service_role;
grant all on table public.whatsapp_messages to service_role;
grant all on table public.whatsapp_message_status_events to service_role;

create or replace function public.touch_whatsapp_conversation_from_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.whatsapp_conversations
  set last_message_at = new.occurred_at,
      last_message_preview = case
        when new.body is not null and length(trim(new.body)) > 0 then left(new.body, 500)
        else null
      end,
      last_message_direction = new.direction,
      updated_at = greatest(updated_at, new.occurred_at)
  where id = new.conversation_id
    and (last_message_at is null or new.occurred_at >= last_message_at);
  return new;
end;
$$;

create or replace function public.touch_whatsapp_conversation_from_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.whatsapp_conversations
  set last_message_at = new.occurred_at,
      last_message_preview = null,
      last_message_direction = 'outbound',
      updated_at = greatest(updated_at, new.occurred_at)
  where id = new.conversation_id
    and (last_message_at is null or new.occurred_at >= last_message_at);
  return new;
end;
$$;

revoke all on function public.touch_whatsapp_conversation_from_message() from public, anon, authenticated;
revoke all on function public.touch_whatsapp_conversation_from_status() from public, anon, authenticated;

drop trigger if exists whatsapp_messages_touch_conversation on public.whatsapp_messages;
create trigger whatsapp_messages_touch_conversation
  after insert on public.whatsapp_messages
  for each row execute function public.touch_whatsapp_conversation_from_message();

drop trigger if exists whatsapp_status_events_touch_conversation on public.whatsapp_message_status_events;
create trigger whatsapp_status_events_touch_conversation
  after insert on public.whatsapp_message_status_events
  for each row execute function public.touch_whatsapp_conversation_from_status();
