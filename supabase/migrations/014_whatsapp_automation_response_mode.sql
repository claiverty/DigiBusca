alter table public.whatsapp_automation_profiles
  add column if not exists response_mode text not null default 'handoff_only';

alter table public.whatsapp_automation_profiles
  drop constraint if exists whatsapp_automation_profiles_response_mode_check;

alter table public.whatsapp_automation_profiles
  add constraint whatsapp_automation_profiles_response_mode_check
  check (response_mode in ('handoff_only', 'gemini'));
