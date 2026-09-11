-- Keep a short-lived snapshot of Places fields so saved leads do not require a
-- Place Details request every time the portfolio is opened.
alter table public.saved_leads
  add column if not exists lead_data_expires_at timestamptz;

create index if not exists saved_leads_snapshot_expiry_idx
  on public.saved_leads (user_id, lead_data_expires_at);
