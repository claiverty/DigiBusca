-- The OpenClaw readiness check verifies this column via PostgREST with LIMIT 0.
-- Grant only this column to the server-only service role; authenticated users
-- keep their existing RLS-scoped table access.
grant select (whatsapp_message_id)
  on table public.lead_interactions
  to service_role;
