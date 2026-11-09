update public.whatsapp_automation_profiles
set automation_enabled = false,
    content_approved_at = null,
    updated_at = now()
where automation_enabled is distinct from false
   or content_approved_at is not null;
