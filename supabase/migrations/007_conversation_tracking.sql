-- Conversation state is user-entered CRM data, independent of the public snapshot.
alter table public.saved_leads
  add column if not exists conversation_stage text,
  add column if not exists contact_name text,
  add column if not exists next_action text;
