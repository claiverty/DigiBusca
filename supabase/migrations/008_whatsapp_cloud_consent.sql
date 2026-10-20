alter table public.saved_leads
  add column if not exists whatsapp_consent_status text not null default 'unknown',
  add column if not exists whatsapp_consent_source text,
  add column if not exists whatsapp_consent_at timestamptz;

alter table public.saved_leads
  add constraint saved_leads_whatsapp_consent_status_check
    check (whatsapp_consent_status in ('unknown', 'opted_in', 'opted_out'));
