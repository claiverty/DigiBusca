alter table public.whatsapp_conversations
  add column if not exists automation_paused boolean not null default false,
  add column if not exists automation_opted_out boolean not null default false,
  add column if not exists automation_pause_reason text,
  add column if not exists automation_stage text not null default 'identify_responsible';

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_automation_stage_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_automation_stage_check
  check (automation_stage in (
    'identify_responsible', 'request_permission', 'understand_scenario', 'explore_need',
    'present_idea', 'qualify_interest', 'present_conditions', 'confirm_decision', 'closed'
  ));

create table if not exists public.whatsapp_automation_profiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_number_id text not null,
  business_name text not null default '',
  sender_identity text not null default '',
  service_summary text not null default '',
  approved_facts text not null default '',
  escalation_contact text not null default '',
  automation_enabled boolean not null default false,
  channel_approved_at timestamptz,
  content_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (phone_number_id, user_id),
  foreign key (phone_number_id, user_id)
    references public.whatsapp_phone_number_connections(phone_number_id, user_id)
    on delete cascade,
  check (not automation_enabled or (
    length(trim(business_name)) > 0 and
    length(trim(sender_identity)) > 0 and
    length(trim(service_summary)) > 0 and
    length(trim(escalation_contact)) > 0 and
    channel_approved_at is not null and
    content_approved_at is not null
  ))
);

create table if not exists public.whatsapp_automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_number_id text not null,
  conversation_id uuid not null,
  inbound_provider_message_id text not null,
  reply_provider_message_id text,
  status text not null default 'processing'
    check (status in ('processing', 'sent', 'skipped', 'needs_human', 'failed')),
  reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (phone_number_id, inbound_provider_message_id),
  foreign key (phone_number_id, user_id)
    references public.whatsapp_phone_number_connections(phone_number_id, user_id)
    on delete cascade,
  foreign key (conversation_id, user_id)
    references public.whatsapp_conversations(id, user_id)
    on delete cascade
);

create index if not exists whatsapp_automation_runs_user_activity_idx
  on public.whatsapp_automation_runs(user_id, created_at desc);

alter table public.whatsapp_automation_profiles enable row level security;
alter table public.whatsapp_automation_runs enable row level security;
revoke all on table public.whatsapp_automation_profiles from public, anon, authenticated;
revoke all on table public.whatsapp_automation_runs from public, anon, authenticated;
grant all on table public.whatsapp_automation_profiles to service_role;
grant all on table public.whatsapp_automation_runs to service_role;
