-- Use o modelo atual no agente Cristhian e exija nova aprovação antes de voltar a responder.
alter table public.whatsapp_automation_profiles
  alter column agent_model set default 'gemini-4-hydrogen';

update public.whatsapp_automation_profiles
set agent_model = 'gemini-4-hydrogen',
    automation_enabled = false,
    content_approved_at = null,
    updated_at = now()
where agent_provider = 'google'
  and response_mode = 'digibot_agent'
  and agent_model is distinct from 'gemini-4-hydrogen';
