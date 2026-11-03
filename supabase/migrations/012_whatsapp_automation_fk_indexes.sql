create index if not exists whatsapp_automation_profiles_user_id_idx
  on public.whatsapp_automation_profiles(user_id);

create index if not exists whatsapp_automation_runs_conversation_user_idx
  on public.whatsapp_automation_runs(conversation_id, user_id);

create index if not exists whatsapp_automation_runs_phone_user_idx
  on public.whatsapp_automation_runs(phone_number_id, user_id);
