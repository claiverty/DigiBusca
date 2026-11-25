-- Persist a confirmed OpenClaw prospecting send, its WhatsApp history, its CRM
-- interaction, and the queue result in one transaction. Repeated hook delivery
-- is safe, and an unknown outcome may be reconciled when a late confirmation
-- arrives.
create or replace function public.settle_openclaw_prospecting_delivery(
  p_queue_id uuid,
  p_user_id uuid,
  p_phone_number_id text,
  p_recipient_phone text,
  p_message text,
  p_provider_message_id text,
  p_success boolean,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.whatsapp_prospecting_queue%rowtype;
  v_conversation_id uuid;
  v_message_id uuid;
  v_sent_at timestamptz := coalesce(p_occurred_at, now());
begin
  select * into v_item
  from public.whatsapp_prospecting_queue
  where id = p_queue_id
    and user_id = p_user_id
    and phone_number_id = p_phone_number_id
    and recipient_phone = p_recipient_phone
    and message = p_message
    and outbound_send_authorized_at is not null
  for update;

  if not found then
    return jsonb_build_object('settled', false, 'reason', 'authorized_queue_item_not_found');
  end if;

  if p_provider_message_id is null
    or length(trim(p_provider_message_id)) not between 1 and 256
    or p_provider_message_id !~ '^[A-Za-z0-9_.:@/-]+$' then
    return jsonb_build_object('settled', false, 'reason', 'invalid_message_identity');
  end if;

  if p_success is true
    and v_item.status = 'sent'
    and v_item.provider_message_id = p_provider_message_id then
    return jsonb_build_object('settled', true, 'duplicate', true, 'delivery', 'sent');
  end if;
  if p_success is false
    and v_item.status = 'failed'
    and v_item.error_code = 'openclaw_delivery_failed'
    and v_item.provider_message_id = p_provider_message_id then
    return jsonb_build_object('settled', true, 'duplicate', true, 'delivery', 'failed');
  end if;

  if v_item.status not in ('sending', 'unknown', 'failed') then
    return jsonb_build_object('settled', false, 'reason', 'queue_item_already_final');
  end if;
  if v_item.status = 'failed' and v_item.provider_message_id is distinct from p_provider_message_id then
    return jsonb_build_object('settled', false, 'reason', 'queue_item_already_final');
  end if;

  if p_success is not true then
    update public.whatsapp_prospecting_queue
    set status = 'failed',
        delivery_status = 'failed',
        provider_message_id = p_provider_message_id,
        error_code = 'openclaw_delivery_failed',
        updated_at = now()
    where id = v_item.id;
    return jsonb_build_object('settled', true, 'delivery', 'failed');
  end if;

  if v_sent_at > now() + interval '5 minutes' then
    return jsonb_build_object('settled', false, 'reason', 'invalid_message_time');
  end if;

  insert into public.whatsapp_conversations (
    user_id, phone_number_id, contact_wa_id, linked_lead_id,
    last_message_at, last_message_preview, last_message_direction, updated_at
  ) values (
    p_user_id, p_phone_number_id, p_recipient_phone, v_item.lead_id,
    v_sent_at, left(v_item.message, 500), 'outbound', v_sent_at
  )
  on conflict (phone_number_id, contact_wa_id) do update
  set linked_lead_id = excluded.linked_lead_id,
      last_message_at = case
        when whatsapp_conversations.last_message_at is null
          or whatsapp_conversations.last_message_at <= excluded.last_message_at
        then excluded.last_message_at else whatsapp_conversations.last_message_at end,
      last_message_preview = case
        when whatsapp_conversations.last_message_at is null
          or whatsapp_conversations.last_message_at <= excluded.last_message_at
        then excluded.last_message_preview else whatsapp_conversations.last_message_preview end,
      last_message_direction = case
        when whatsapp_conversations.last_message_at is null
          or whatsapp_conversations.last_message_at <= excluded.last_message_at
        then excluded.last_message_direction else whatsapp_conversations.last_message_direction end,
      updated_at = greatest(whatsapp_conversations.updated_at, excluded.updated_at)
  returning id into v_conversation_id;

  insert into public.whatsapp_messages (
    user_id, phone_number_id, conversation_id, provider_message_id,
    contact_wa_id, direction, message_type, body, source,
    is_placeholder, occurred_at
  ) values (
    p_user_id, p_phone_number_id, v_conversation_id, p_provider_message_id,
    p_recipient_phone, 'outbound', 'text', v_item.message, 'live', false, v_sent_at
  )
  on conflict (phone_number_id, provider_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is null then
    select id into v_message_id
    from public.whatsapp_messages
    where phone_number_id = p_phone_number_id
      and provider_message_id = p_provider_message_id
      and user_id = p_user_id
      and conversation_id = v_conversation_id
      and contact_wa_id = p_recipient_phone
      and direction = 'outbound'
      and body = v_item.message
      and is_placeholder = false;
    if not found then
      raise exception 'OpenClaw message identity conflicts with an existing WhatsApp message';
    end if;
  end if;

  update public.saved_leads
  set status = 'Contatado', updated_at = v_sent_at
  where user_id = p_user_id and lead_id = v_item.lead_id and status = 'Novo';

  insert into public.lead_interactions (
    user_id, lead_id, whatsapp_message_id, channel, occurred_at, notes, outcome
  ) values (
    p_user_id,
    v_item.lead_id,
    p_provider_message_id,
    'WhatsApp',
    (v_sent_at at time zone 'America/Sao_Paulo')::date,
    'Primeiro contato confirmado pelo WhatsApp Web do OpenClaw. Mensagem: ' || v_item.message,
    'Envio confirmado pelo OpenClaw'
  )
  on conflict (user_id, whatsapp_message_id) where whatsapp_message_id is not null do nothing;

  update public.whatsapp_prospecting_queue
  set status = 'sent',
      delivery_status = 'sent',
      provider_message_id = p_provider_message_id,
      sent_at = v_sent_at,
      error_code = null,
      updated_at = now()
  where id = v_item.id;

  return jsonb_build_object('settled', true, 'duplicate', false, 'delivery', 'sent');
end;
$$;

revoke all on function public.settle_openclaw_prospecting_delivery(uuid, uuid, text, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.settle_openclaw_prospecting_delivery(uuid, uuid, text, text, text, text, boolean, timestamptz)
  to service_role;
