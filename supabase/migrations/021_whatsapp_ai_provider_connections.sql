create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.whatsapp_ai_provider_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'anthropic', 'openai-compatible')),
  secret_id uuid unique references vault.secrets(id) on delete set null,
  base_url text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider),
  check (
    (provider = 'openai-compatible' and (base_url is null or (length(base_url) between 8 and 512)))
    or (provider in ('google', 'anthropic') and base_url is null)
  )
);

alter table public.whatsapp_ai_provider_connections enable row level security;
revoke all on table public.whatsapp_ai_provider_connections from public, anon, authenticated, service_role;

create or replace function public.save_whatsapp_ai_provider_credential(
  p_user_id uuid,
  p_provider text,
  p_api_key text,
  p_base_url text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_secret_id uuid;
  next_secret_id uuid;
  secret_name text;
  clean_api_key text := btrim(p_api_key);
  clean_base_url text := nullif(rtrim(btrim(p_base_url), '/'), '');
begin
  if p_user_id is null
     or p_provider is null
     or p_provider not in ('google', 'anthropic', 'openai-compatible')
     or clean_api_key is null
     or length(clean_api_key) not between 8 and 4096 then
    raise exception 'invalid provider credential';
  end if;
  if (p_provider = 'openai-compatible' and (clean_base_url is null or length(clean_base_url) > 512))
     or (p_provider in ('google', 'anthropic') and clean_base_url is not null) then
    raise exception 'invalid provider endpoint';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':' || p_provider, 0));
  secret_name := 'digibusca-whatsapp-ai-' || p_user_id::text || '-' || p_provider;
  select connection.secret_id
    into current_secret_id
    from public.whatsapp_ai_provider_connections as connection
   where connection.user_id = p_user_id and connection.provider = p_provider
   for update;

  if current_secret_id is null then
    next_secret_id := vault.create_secret(
      clean_api_key,
      secret_name,
      'Credencial do provedor de IA do DigiBusca'
    );
    insert into public.whatsapp_ai_provider_connections (user_id, provider, secret_id, base_url, enabled, updated_at)
    values (p_user_id, p_provider, next_secret_id, clean_base_url, true, now())
    on conflict (user_id, provider) do update
      set secret_id = excluded.secret_id,
          base_url = excluded.base_url,
          enabled = true,
          updated_at = now();
  else
    perform vault.update_secret(
      current_secret_id,
      clean_api_key,
      secret_name,
      'Credencial do provedor de IA do DigiBusca'
    );
    update public.whatsapp_ai_provider_connections
       set base_url = clean_base_url, enabled = true, updated_at = now()
     where user_id = p_user_id and provider = p_provider;
  end if;
end;
$$;

create or replace function public.get_whatsapp_ai_provider_credential(
  p_user_id uuid,
  p_provider text
) returns table(enabled boolean, api_key text, base_url text)
language sql
security definer
set search_path = ''
as $$
  select connection.enabled,
         case when connection.enabled then secret.decrypted_secret else null end,
         connection.base_url
    from public.whatsapp_ai_provider_connections as connection
    left join vault.decrypted_secrets as secret on secret.id = connection.secret_id
   where connection.user_id = p_user_id
     and connection.provider = p_provider
   limit 1;
$$;

create or replace function public.list_whatsapp_ai_provider_connections(
  p_user_id uuid
) returns table(provider text, enabled boolean, has_credential boolean)
language sql
security definer
set search_path = ''
as $$
  select connection.provider,
         connection.enabled,
         connection.secret_id is not null
    from public.whatsapp_ai_provider_connections as connection
   where connection.user_id = p_user_id;
$$;

create or replace function public.disable_whatsapp_ai_provider_credential(
  p_user_id uuid,
  p_provider text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_secret_id uuid;
begin
  if p_user_id is null or p_provider is null or p_provider not in ('google', 'anthropic', 'openai-compatible') then
    raise exception 'invalid provider credential';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':' || p_provider, 0));
  select connection.secret_id
    into current_secret_id
    from public.whatsapp_ai_provider_connections as connection
   where connection.user_id = p_user_id and connection.provider = p_provider
   for update;

  if current_secret_id is not null then
    delete from vault.secrets where id = current_secret_id;
  end if;

  insert into public.whatsapp_ai_provider_connections (user_id, provider, secret_id, base_url, enabled, updated_at)
  values (p_user_id, p_provider, null, null, false, now())
  on conflict (user_id, provider) do update
    set secret_id = null, base_url = null, enabled = false, updated_at = now();
end;
$$;

revoke all on function public.save_whatsapp_ai_provider_credential(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.get_whatsapp_ai_provider_credential(uuid, text) from public, anon, authenticated;
revoke all on function public.list_whatsapp_ai_provider_connections(uuid) from public, anon, authenticated;
revoke all on function public.disable_whatsapp_ai_provider_credential(uuid, text) from public, anon, authenticated;
grant execute on function public.save_whatsapp_ai_provider_credential(uuid, text, text, text) to service_role;
grant execute on function public.get_whatsapp_ai_provider_credential(uuid, text) to service_role;
grant execute on function public.list_whatsapp_ai_provider_connections(uuid) to service_role;
grant execute on function public.disable_whatsapp_ai_provider_credential(uuid, text) to service_role;
