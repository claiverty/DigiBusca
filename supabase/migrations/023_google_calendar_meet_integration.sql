create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.google_calendar_oauth_clients (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id text not null,
  secret_id uuid unique references vault.secrets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(client_id) between 20 and 512),
  check (client_id ~ '^[A-Za-z0-9._-]+[.]apps[.]googleusercontent[.]com$')
);

alter table public.google_calendar_oauth_clients enable row level security;
revoke all on table public.google_calendar_oauth_clients from public, anon, authenticated, service_role;

create or replace function public.save_google_calendar_oauth_client(
  p_user_id uuid,
  p_client_id text,
  p_client_secret text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_secret_id uuid;
  next_secret_id uuid;
  secret_name text;
  clean_client_id text := btrim(p_client_id);
  clean_client_secret text := btrim(p_client_secret);
begin
  if p_user_id is null
     or clean_client_id is null
     or length(clean_client_id) not between 20 and 512
     or clean_client_id !~ '^[A-Za-z0-9._-]+[.]apps[.]googleusercontent[.]com$'
     or clean_client_secret is null
     or length(clean_client_secret) not between 8 and 4096 then
    raise exception 'invalid Google Calendar OAuth client';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':google-calendar-oauth-client', 0));
  secret_name := 'digibusca-google-calendar-oauth-client-' || p_user_id::text;
  select client.secret_id
    into current_secret_id
    from public.google_calendar_oauth_clients as client
   where client.user_id = p_user_id
   for update;

  if current_secret_id is null then
    next_secret_id := vault.create_secret(
      clean_client_secret,
      secret_name,
      'Client secret OAuth do Google Calendar do DigiBusca'
    );
    insert into public.google_calendar_oauth_clients (user_id, client_id, secret_id, created_at, updated_at)
    values (p_user_id, clean_client_id, next_secret_id, now(), now())
    on conflict (user_id) do update
      set client_id = excluded.client_id,
          secret_id = excluded.secret_id,
          updated_at = now();
  else
    perform vault.update_secret(
      current_secret_id,
      clean_client_secret,
      secret_name,
      'Client secret OAuth do Google Calendar do DigiBusca'
    );
    update public.google_calendar_oauth_clients
       set client_id = clean_client_id, updated_at = now()
     where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.get_google_calendar_oauth_client(p_user_id uuid)
returns table(client_id text, client_secret text)
language sql
security definer
set search_path = ''
as $$
  select client.client_id, secret.decrypted_secret
    from public.google_calendar_oauth_clients as client
    left join vault.decrypted_secrets as secret on secret.id = client.secret_id
   where client.user_id = p_user_id
     and client.secret_id is not null
   limit 1;
$$;

create or replace function public.disconnect_google_calendar_oauth_client(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_secret_id uuid;
begin
  if p_user_id is null then raise exception 'invalid Google Calendar OAuth owner'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':google-calendar-oauth-client', 0));
  select client.secret_id into current_secret_id
    from public.google_calendar_oauth_clients as client
   where client.user_id = p_user_id
   for update;
  if current_secret_id is not null then delete from vault.secrets where id = current_secret_id; end if;
  delete from public.google_calendar_oauth_clients where user_id = p_user_id;
end;
$$;

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  secret_id uuid unique references vault.secrets(id) on delete set null,
  account_email text not null,
  calendar_id text not null default 'primary',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(account_email) between 3 and 320),
  check (calendar_id = 'primary')
);

alter table public.google_calendar_connections enable row level security;
revoke all on table public.google_calendar_connections from public, anon, authenticated, service_role;

create or replace function public.save_google_calendar_connection(
  p_user_id uuid,
  p_refresh_token text,
  p_account_email text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_secret_id uuid;
  next_secret_id uuid;
  secret_name text;
  clean_refresh_token text := btrim(p_refresh_token);
  clean_account_email text := lower(btrim(p_account_email));
begin
  if p_user_id is null
     or clean_refresh_token is null
     or length(clean_refresh_token) not between 8 and 4096
     or clean_account_email is null
     or length(clean_account_email) not between 3 and 320
     or clean_account_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'invalid Google Calendar connection';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':google-calendar', 0));
  secret_name := 'digibusca-google-calendar-' || p_user_id::text;
  select connection.secret_id
    into current_secret_id
    from public.google_calendar_connections as connection
   where connection.user_id = p_user_id
   for update;

  if current_secret_id is null then
    next_secret_id := vault.create_secret(
      clean_refresh_token,
      secret_name,
      'Refresh token OAuth do Google Calendar do DigiBusca'
    );
    insert into public.google_calendar_connections (user_id, secret_id, account_email, calendar_id, connected_at, updated_at)
    values (p_user_id, next_secret_id, clean_account_email, 'primary', now(), now())
    on conflict (user_id) do update
      set secret_id = excluded.secret_id,
          account_email = excluded.account_email,
          calendar_id = 'primary',
          connected_at = now(),
          updated_at = now();
  else
    perform vault.update_secret(
      current_secret_id,
      clean_refresh_token,
      secret_name,
      'Refresh token OAuth do Google Calendar do DigiBusca'
    );
    update public.google_calendar_connections
       set account_email = clean_account_email, calendar_id = 'primary', updated_at = now()
     where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.get_google_calendar_connection(p_user_id uuid)
returns table(account_email text, calendar_id text, refresh_token text, connected_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select connection.account_email,
         connection.calendar_id,
         secret.decrypted_secret,
         connection.connected_at
    from public.google_calendar_connections as connection
    left join vault.decrypted_secrets as secret on secret.id = connection.secret_id
   where connection.user_id = p_user_id
     and connection.secret_id is not null
   limit 1;
$$;

create or replace function public.disconnect_google_calendar(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_secret_id uuid;
begin
  if p_user_id is null then raise exception 'invalid Google Calendar owner'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':google-calendar', 0));
  select connection.secret_id into current_secret_id
    from public.google_calendar_connections as connection
   where connection.user_id = p_user_id
   for update;
  if current_secret_id is not null then delete from vault.secrets where id = current_secret_id; end if;
  delete from public.google_calendar_connections where user_id = p_user_id;
end;
$$;

revoke all on function public.save_google_calendar_connection(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_google_calendar_connection(uuid) from public, anon, authenticated;
revoke all on function public.disconnect_google_calendar(uuid) from public, anon, authenticated;
revoke all on function public.save_google_calendar_oauth_client(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_google_calendar_oauth_client(uuid) from public, anon, authenticated;
revoke all on function public.disconnect_google_calendar_oauth_client(uuid) from public, anon, authenticated;
grant execute on function public.save_google_calendar_connection(uuid, text, text) to service_role;
grant execute on function public.get_google_calendar_connection(uuid) to service_role;
grant execute on function public.disconnect_google_calendar(uuid) to service_role;
grant execute on function public.save_google_calendar_oauth_client(uuid, text, text) to service_role;
grant execute on function public.get_google_calendar_oauth_client(uuid) to service_role;
grant execute on function public.disconnect_google_calendar_oauth_client(uuid) to service_role;
