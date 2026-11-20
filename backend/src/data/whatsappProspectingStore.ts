import { createWhatsAppWebhookSupabaseClient } from '../config/supabase.js'
import { getEvolutionConnectionState } from '../integrations/evolutionApi.js'

const brazilTimeZone = 'America/Sao_Paulo'
const staleDailyCampaignMs = 30 * 60 * 1_000

export type WhatsAppProspectingSettings = {
  enabled: boolean
  dailyNewLeadLimit: number
  timezone: string
  defaultCity: string
  nextNewLeadAt?: string
}

export type WhatsAppProspectingQueueItem = {
  id: string
  leadId: string
  phoneNumberId: string
  recipientPhone: string
  message: string
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'unknown' | 'cancelled'
  scheduledAt: string
  claimedAt?: string
  sentAt?: string
  providerMessageId?: string
  errorCode?: string
  createdAt: string
}

export type WhatsAppProspectingChatMessage = {
  role: 'assistant' | 'user'
  text: string
  createdAt: string
}

export type WhatsAppDailyProspectingCampaign = {
  id: string
  campaignDate: string
  city?: string
  segment: string
  status: 'awaiting_city' | 'processing' | 'completed' | 'failed'
  searchedCount: number
  savedCount: number
  queuedCount: number
  messages: WhatsAppProspectingChatMessage[]
  errorCode?: string
  updatedAt: string
}

export class WhatsAppProspectingError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 422 | 503) {
    super(message)
    this.name = 'WhatsAppProspectingError'
  }
}

type QueueRow = {
  id: string
  lead_id: string
  phone_number_id: string
  recipient_phone: string
  message: string
  status: WhatsAppProspectingQueueItem['status']
  scheduled_at: string
  claimed_at: string | null
  sent_at: string | null
  provider_message_id: string | null
  error_code: string | null
  created_at: string
}

function throwIfError(error: { message: string } | null, message: string) {
  if (error) throw new Error(message)
}

function mapQueueRow(row: QueueRow): WhatsAppProspectingQueueItem {
  return {
    id: row.id,
    leadId: row.lead_id,
    phoneNumberId: row.phone_number_id,
    recipientPhone: row.recipient_phone,
    message: row.message,
    status: row.status,
    scheduledAt: row.scheduled_at,
    ...(row.claimed_at ? { claimedAt: row.claimed_at } : {}),
    ...(row.sent_at ? { sentAt: row.sent_at } : {}),
    ...(row.provider_message_id ? { providerMessageId: row.provider_message_id } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    createdAt: row.created_at,
  }
}

function normalizeBrazilianPhone(phone: string) {
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function saoPauloDayRange(now = new Date()) {
  const localDate = saoPauloDate(now)
  const start = new Date(`${localDate}T00:00:00-03:00`)
  return { start: start.toISOString(), end: new Date(start.getTime() + 24 * 60 * 60 * 1_000).toISOString() }
}

function saoPauloDate(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: brazilTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

type DailyCampaignRow = {
  id: string
  campaign_date: string
  city: string | null
  segment: string
  status: WhatsAppDailyProspectingCampaign['status']
  searched_count: number
  saved_count: number
  queued_count: number
  messages: unknown
  error_code: string | null
  updated_at: string
}

function mapDailyCampaign(row: DailyCampaignRow): WhatsAppDailyProspectingCampaign {
  const messages = Array.isArray(row.messages) ? row.messages.flatMap((message) => {
    if (!isRecord(message) || (message.role !== 'assistant' && message.role !== 'user') || typeof message.text !== 'string' || typeof message.createdAt !== 'string') return []
    return [{ role: message.role as WhatsAppProspectingChatMessage['role'], text: message.text.slice(0, 1_024), createdAt: message.createdAt }]
  }) : []
  return {
    id: row.id,
    campaignDate: row.campaign_date,
    ...(row.city ? { city: row.city } : {}),
    segment: row.segment,
    status: row.status,
    searchedCount: Number(row.searched_count),
    savedCount: Number(row.saved_count),
    queuedCount: Number(row.queued_count),
    messages,
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    updatedAt: row.updated_at,
  }
}

export class WhatsAppProspectingStore {
  async getOrCreateDailyCampaign(userId: string, now = new Date()): Promise<WhatsAppDailyProspectingCampaign> {
    const admin = createWhatsAppWebhookSupabaseClient()
    const campaignDate = saoPauloDate(now)
    const createdAt = now.toISOString()
    const prompt: WhatsAppProspectingChatMessage = {
      role: 'assistant',
      text: 'Bom dia, qual cidade vamos prospectar hoje? Brasília, DF está como sugestão inicial. Se quiser, informe também um segmento; se deixar em branco, busco negócios locais em geral.',
      createdAt,
    }
    const inserted = await admin.from('whatsapp_prospecting_daily_campaigns').upsert({
      user_id: userId,
      campaign_date: campaignDate,
      segment: 'Todos os segmentos',
      status: 'awaiting_city',
      messages: [prompt],
      updated_at: createdAt,
    }, { onConflict: 'user_id,campaign_date', ignoreDuplicates: true })
    throwIfError(inserted.error, 'Não foi possível iniciar o chat diário de prospecção.')

    const result = await admin.from('whatsapp_prospecting_daily_campaigns')
      .select('id, campaign_date, city, segment, status, searched_count, saved_count, queued_count, messages, error_code, updated_at')
      .eq('user_id', userId)
      .eq('campaign_date', campaignDate)
      .single()
    throwIfError(result.error, 'Não foi possível carregar o chat diário de prospecção.')
    const row = result.data as DailyCampaignRow
    const campaign = mapDailyCampaign(row)
    if (
      campaign.status !== 'processing' ||
      !Number.isFinite(Date.parse(campaign.updatedAt)) ||
      now.getTime() - Date.parse(campaign.updatedAt) < staleDailyCampaignMs
    ) return campaign

    const recoveredAt = now.toISOString()
    const messages = [
      ...campaign.messages.slice(-7),
      {
        role: 'assistant' as const,
        text: 'A busca anterior parece ter sido interrompida. Envie a cidade novamente para eu tentar de novo.',
        createdAt: recoveredAt,
      },
    ]
    const recovered = await admin.from('whatsapp_prospecting_daily_campaigns')
      .update({ status: 'failed', error_code: 'campaign_interrupted', messages, updated_at: recoveredAt })
      .eq('id', campaign.id)
      .eq('user_id', userId)
      .eq('status', 'processing')
      .eq('updated_at', row.updated_at)
      .select('id, campaign_date, city, segment, status, searched_count, saved_count, queued_count, messages, error_code, updated_at')
      .maybeSingle()
    throwIfError(recovered.error, 'Não foi possível recuperar a busca diária interrompida.')
    if (recovered.data) return mapDailyCampaign(recovered.data as DailyCampaignRow)

    const latest = await admin.from('whatsapp_prospecting_daily_campaigns')
      .select('id, campaign_date, city, segment, status, searched_count, saved_count, queued_count, messages, error_code, updated_at')
      .eq('user_id', userId)
      .eq('campaign_date', campaignDate)
      .single()
    throwIfError(latest.error, 'Não foi possível recarregar o chat diário de prospecção.')
    return mapDailyCampaign(latest.data as DailyCampaignRow)
  }

  async beginDailyCampaign(userId: string, city: string, segment: string, now = new Date()) {
    const current = await this.getOrCreateDailyCampaign(userId, now)
    if (current.status === 'processing' || current.status === 'completed') {
      throw new WhatsAppProspectingError('A busca de hoje já foi iniciada. Confira o resultado no chat.', 409)
    }
    const admin = createWhatsAppWebhookSupabaseClient()
    const createdAt = now.toISOString()
    const messages = [
      ...current.messages.slice(-7),
      { role: 'user', text: segment === 'Todos os segmentos' ? city : `${city} — ${segment}`, createdAt },
      { role: 'assistant', text: `Certo, vou procurar ${segment === 'Todos os segmentos' ? 'negócios locais' : segment} em ${city} e preparar os contatos elegíveis.`, createdAt },
    ]
    const result = await admin.from('whatsapp_prospecting_daily_campaigns')
      .update({ city, segment, status: 'processing', messages, error_code: null, updated_at: createdAt })
      .eq('id', current.id)
      .eq('user_id', userId)
      .in('status', ['awaiting_city', 'failed'])
      .select('id, campaign_date, city, segment, status, searched_count, saved_count, queued_count, messages, error_code, updated_at')
      .maybeSingle()
    throwIfError(result.error, 'Não foi possível iniciar a busca do dia.')
    if (!result.data) throw new WhatsAppProspectingError('A busca de hoje já foi iniciada. Confira o resultado no chat.', 409)
    return mapDailyCampaign(result.data as DailyCampaignRow)
  }

  async finishDailyCampaign(userId: string, campaignId: string, counts: { searched: number; saved: number; queued: number; summary: string }, now = new Date()) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const current = await admin.from('whatsapp_prospecting_daily_campaigns')
      .select('messages')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .eq('status', 'processing')
      .maybeSingle()
    throwIfError(current.error, 'Não foi possível carregar o histórico da busca diária.')
    if (!current.data) throw new WhatsAppProspectingError('A busca diária não está mais em andamento.', 409)
    const oldMessages = Array.isArray((current.data as { messages: unknown }).messages) ? (current.data as { messages: WhatsAppProspectingChatMessage[] }).messages : []
    const messages = [...oldMessages.slice(-8), { role: 'assistant', text: counts.summary.slice(0, 1_024), createdAt: now.toISOString() }]
    const result = await admin.from('whatsapp_prospecting_daily_campaigns')
      .update({ status: 'completed', searched_count: counts.searched, saved_count: counts.saved, queued_count: counts.queued, messages, updated_at: now.toISOString() })
      .eq('id', campaignId)
      .eq('user_id', userId)
      .eq('status', 'processing')
      .select('id, campaign_date, city, segment, status, searched_count, saved_count, queued_count, messages, error_code, updated_at')
      .single()
    throwIfError(result.error, 'Não foi possível concluir a busca diária.')
    return mapDailyCampaign(result.data as DailyCampaignRow)
  }

  async failDailyCampaign(userId: string, campaignId: string, errorCode: string, message: string, now = new Date()) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const current = await admin.from('whatsapp_prospecting_daily_campaigns')
      .select('messages')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .eq('status', 'processing')
      .maybeSingle()
    throwIfError(current.error, 'Não foi possível carregar o histórico da busca diária.')
    if (!current.data) return
    const previousMessages = Array.isArray((current.data as { messages: unknown }).messages) ? (current.data as { messages: WhatsAppProspectingChatMessage[] }).messages : []
    const messages = [...previousMessages.slice(-8), { role: 'assistant', text: message.slice(0, 1_024), createdAt: now.toISOString() }]
    const result = await admin.from('whatsapp_prospecting_daily_campaigns')
      .update({ status: 'failed', error_code: errorCode.slice(0, 80), messages, updated_at: now.toISOString() })
      .eq('id', campaignId)
      .eq('user_id', userId)
      .eq('status', 'processing')
    throwIfError(result.error, 'Não foi possível registrar a falha da busca diária.')
  }

  async getSettings(userId: string): Promise<WhatsAppProspectingSettings> {
    const admin = createWhatsAppWebhookSupabaseClient()
    const inserted = await admin.from('whatsapp_prospecting_settings')
      .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
    throwIfError(inserted.error, 'Não foi possível preparar as configurações da prospecção.')

    const result = await admin.from('whatsapp_prospecting_settings')
      .select('enabled, daily_new_lead_limit, timezone, default_city, next_new_lead_at')
      .eq('user_id', userId)
      .single()
    throwIfError(result.error, 'Não foi possível carregar as configurações da prospecção.')
    const row = result.data as { enabled: boolean; daily_new_lead_limit: number; timezone: string; default_city: string; next_new_lead_at: string | null }
    return {
      enabled: row.enabled,
      dailyNewLeadLimit: Number(row.daily_new_lead_limit),
      timezone: row.timezone,
      defaultCity: row.default_city,
      ...(row.next_new_lead_at ? { nextNewLeadAt: row.next_new_lead_at } : {}),
    }
  }

  async saveSettings(userId: string, enabled: boolean, dailyNewLeadLimit: number) {
    if (!Number.isInteger(dailyNewLeadLimit) || dailyNewLeadLimit < 17 || dailyNewLeadLimit > 25) {
      throw new WhatsAppProspectingError('O limite diário precisa ficar entre 17 e 25 novos leads.', 400)
    }
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_prospecting_settings')
      .upsert({
        user_id: userId,
        enabled,
        daily_new_lead_limit: dailyNewLeadLimit,
        timezone: brazilTimeZone,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select('enabled, daily_new_lead_limit, timezone, default_city, next_new_lead_at')
      .single()
    throwIfError(result.error, 'Não foi possível salvar as configurações da prospecção.')
    const row = result.data as { enabled: boolean; daily_new_lead_limit: number; timezone: string; default_city: string; next_new_lead_at: string | null }
    return {
      enabled: row.enabled,
      dailyNewLeadLimit: Number(row.daily_new_lead_limit),
      timezone: row.timezone,
      defaultCity: row.default_city,
      ...(row.next_new_lead_at ? { nextNewLeadAt: row.next_new_lead_at } : {}),
    }
  }

  async getDailyCount(userId: string, now = new Date()) {
    const { start, end } = saoPauloDayRange(now)
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_prospecting_queue')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['sending', 'sent', 'unknown'])
      .gte('claimed_at', start)
      .lt('claimed_at', end)
    throwIfError(result.error, 'Não foi possível consultar o limite diário de prospecção.')
    return result.count ?? 0
  }

  async getPendingQueueCount(userId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_prospecting_queue')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'queued')
    throwIfError(result.error, 'Não foi possível consultar os itens aguardando na fila.')
    return result.count ?? 0
  }

  async listQueue(userId: string, limit = 100) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_prospecting_queue')
      .select('id, lead_id, phone_number_id, recipient_phone, message, status, scheduled_at, claimed_at, sent_at, provider_message_id, error_code, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)
    throwIfError(result.error, 'Não foi possível carregar a fila de prospecção.')
    return ((result.data ?? []) as QueueRow[]).map(mapQueueRow)
  }

  async enqueueNewLead(userId: string, phoneNumberId: string, leadId: string, message: string) {
    const trimmedMessage = message.trim()
    if (!trimmedMessage || trimmedMessage.length > 1_024) {
      throw new WhatsAppProspectingError('A mensagem precisa ter entre 1 e 1.024 caracteres.', 400)
    }

    const admin = createWhatsAppWebhookSupabaseClient()
    const connectionResult = await admin.from('whatsapp_phone_number_connections')
      .select('phone_number_id')
      .eq('phone_number_id', phoneNumberId)
      .eq('user_id', userId)
      .maybeSingle()
    throwIfError(connectionResult.error, 'Não foi possível validar a conexão WhatsApp selecionada.')
    if (!connectionResult.data) throw new WhatsAppProspectingError('Conecte um número WhatsApp Business antes de enfileirar contatos.', 404)

    const leadResult = await admin.from('saved_leads')
      .select('lead_data, status, whatsapp_consent_status, whatsapp_consent_source, whatsapp_consent_at')
      .eq('user_id', userId)
      .eq('lead_id', leadId)
      .maybeSingle()
    throwIfError(leadResult.error, 'Não foi possível validar o lead salvo e seu consentimento.')
    if (!leadResult.data) throw new WhatsAppProspectingError('Salve este lead no DigiBusca antes de enfileirar o contato.', 404)
    const lead = leadResult.data as {
      lead_data: unknown
      status: string
      whatsapp_consent_status: string | null
      whatsapp_consent_source: string | null
      whatsapp_consent_at: string | null
    }
    if (lead.whatsapp_consent_status !== 'opted_in' || !lead.whatsapp_consent_source?.trim() || !lead.whatsapp_consent_at) {
      throw new WhatsAppProspectingError('Registre o consentimento explícito deste contato antes de enfileirar.', 403)
    }
    const consentAt = Date.parse(lead.whatsapp_consent_at)
    if (!Number.isFinite(consentAt) || consentAt > Date.now()) {
      throw new WhatsAppProspectingError('A data do consentimento está inválida.', 403)
    }
    if (lead.status !== 'Novo') {
      throw new WhatsAppProspectingError('A fila de novos contatos aceita apenas leads com status Novo.', 409)
    }
    if (!isRecord(lead.lead_data) || typeof lead.lead_data.phone !== 'string') {
      throw new WhatsAppProspectingError('Atualize o telefone deste lead antes de enfileirar.', 422)
    }
    const recipientPhone = normalizeBrazilianPhone(lead.lead_data.phone)
    if (!recipientPhone) throw new WhatsAppProspectingError('O telefone do lead não está em um formato brasileiro válido.', 422)

    const existingConversation = await admin.from('whatsapp_conversations')
      .select('id, automation_opted_out')
      .eq('user_id', userId)
      .eq('contact_wa_id', recipientPhone)
    throwIfError(existingConversation.error, 'Não foi possível conferir o histórico deste contato.')
    const existingConversations = (existingConversation.data ?? []) as Array<{ id: string; automation_opted_out: boolean | null }>
    if (existingConversations.some((conversation) => conversation.automation_opted_out === true)) {
      throw new WhatsAppProspectingError('Este contato pediu para parar. O envio está bloqueado em todos os números conectados.', 403)
    }
    if (existingConversations.length > 0) {
      throw new WhatsAppProspectingError('Este número já tem uma conversa no WhatsApp. Continue pelo atendimento da caixa de entrada.', 409)
    }

    const result = await admin.from('whatsapp_prospecting_queue')
      .insert({
        user_id: userId,
        phone_number_id: phoneNumberId,
        lead_id: leadId,
        recipient_phone: recipientPhone,
        message: trimmedMessage,
        status: 'queued',
        scheduled_at: new Date().toISOString(),
      })
      .select('id, lead_id, phone_number_id, recipient_phone, message, status, scheduled_at, claimed_at, sent_at, provider_message_id, error_code, created_at')
      .single()
    if (result.error?.code === '23505') {
      throw new WhatsAppProspectingError('Este lead já está na fila ou já recebeu o primeiro contato.', 409)
    }
    throwIfError(result.error, 'Não foi possível adicionar o lead à fila de prospecção.')
    return mapQueueRow(result.data as QueueRow)
  }

  async cancelQueuedItem(userId: string, queueId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_prospecting_queue')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', queueId)
      .eq('user_id', userId)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle()
    throwIfError(result.error, 'Não foi possível cancelar o contato na fila.')
    return Boolean(result.data)
  }

  async listDueQueueItems(now = new Date(), limit = 25) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.rpc('list_whatsapp_prospecting_queue_candidates', {
      p_now: now.toISOString(),
      p_limit: limit,
    })
    throwIfError(result.error, 'Não foi possível consultar a fila de prospecção.')
    return ((result.data ?? []) as Array<{ queue_id: string }>).map((row) => row.queue_id)
  }

  async markStaleSendingAsUnknown(now = new Date()) {
    const cutoff = new Date(now.getTime() - 10 * 60 * 1_000).toISOString()
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_prospecting_queue')
      .update({ status: 'unknown', error_code: 'local_worker_interrupted', updated_at: now.toISOString() })
      .eq('status', 'sending')
      .lt('claimed_at', cutoff)
    throwIfError(result.error, 'Não foi possível recuperar envios interrompidos da fila.')
  }

  async claimQueueItem(queueId: string, now = new Date()) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.rpc('claim_whatsapp_prospecting_queue_item', {
      p_queue_id: queueId,
      p_now: now.toISOString(),
    })
    throwIfError(result.error, 'Não foi possível reservar o próximo contato da fila.')
    const rows = result.data as QueueRow[] | null
    return rows?.[0] ? mapQueueRow(rows[0]) : undefined
  }

  async getDispatchContext(item: WhatsAppProspectingQueueItem) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const ownerResult = await admin.from('whatsapp_prospecting_queue')
      .select('user_id')
      .eq('id', item.id)
      .single()
    throwIfError(ownerResult.error, 'Não foi possível confirmar a conta dona deste item da fila.')
    const userId = (ownerResult.data as { user_id: string }).user_id
    const [connectionResult, leadResult, settingsResult, conversationResult] = await Promise.all([
      admin.from('whatsapp_phone_number_connections')
        .select('phone_number_id, platform_type')
        .eq('phone_number_id', item.phoneNumberId)
        .eq('user_id', userId)
        .maybeSingle(),
      admin.from('saved_leads')
        .select('lead_data, status, whatsapp_consent_status, whatsapp_consent_source, whatsapp_consent_at')
        .eq('user_id', userId)
        .eq('lead_id', item.leadId)
        .maybeSingle(),
      admin.from('whatsapp_prospecting_settings')
        .select('enabled')
        .eq('user_id', userId)
        .maybeSingle(),
      admin.from('whatsapp_conversations')
        .select('id, automation_opted_out')
        .eq('user_id', userId)
        .eq('contact_wa_id', item.recipientPhone),
    ])
    throwIfError(connectionResult.error, 'Não foi possível carregar a conexão WhatsApp para envio.')
    throwIfError(leadResult.error, 'Não foi possível revalidar o consentimento do lead antes do envio.')
    throwIfError(settingsResult.error, 'Não foi possível revalidar as configurações de prospecção.')
    throwIfError(conversationResult.error, 'Não foi possível revalidar o histórico deste contato.')
    if (!connectionResult.data || !leadResult.data) throw new WhatsAppProspectingError('A conexão ou o lead não está mais disponível.', 404)
    const conversations = (conversationResult.data ?? []) as Array<{ id: string; automation_opted_out: boolean | null }>
    if (conversations.some((conversation) => conversation.automation_opted_out === true)) {
      throw new WhatsAppProspectingError('Este contato pediu para parar. O envio está bloqueado em todos os números conectados.', 403)
    }
    if (conversations.length > 0) throw new WhatsAppProspectingError('Este número já iniciou uma conversa; continue pela caixa de entrada.', 409)
    if ((settingsResult.data as { enabled?: boolean } | null)?.enabled !== true) {
      throw new WhatsAppProspectingError('A fila foi pausada antes do envio.', 409)
    }

    const connection = connectionResult.data as { phone_number_id: string; platform_type: string | null }
    const lead = leadResult.data as {
      lead_data: unknown
      status: string
      whatsapp_consent_status: string | null
      whatsapp_consent_source: string | null
      whatsapp_consent_at: string | null
    }
    if (
      lead.whatsapp_consent_status !== 'opted_in' || !lead.whatsapp_consent_source?.trim() || !lead.whatsapp_consent_at ||
      !Number.isFinite(Date.parse(lead.whatsapp_consent_at)) || Date.parse(lead.whatsapp_consent_at) > Date.now()
    ) {
      throw new WhatsAppProspectingError('O consentimento não está mais válido para este contato.', 403)
    }
    if (lead.status !== 'Novo') throw new WhatsAppProspectingError('O status do lead mudou antes do envio.', 409)
    const currentPhone = isRecord(lead.lead_data) && typeof lead.lead_data.phone === 'string'
      ? normalizeBrazilianPhone(lead.lead_data.phone)
      : undefined
    if (!currentPhone || currentPhone !== item.recipientPhone) {
      throw new WhatsAppProspectingError('O telefone do lead mudou ou está inválido. Revise o contato antes de enviar.', 409)
    }
    if (connection.platform_type !== 'EVOLUTION_API') {
      throw new WhatsAppProspectingError('Conecte a Evolution API antes de enviar pela fila.', 503)
    }
    let connectionState: Awaited<ReturnType<typeof getEvolutionConnectionState>>
    try {
      connectionState = await getEvolutionConnectionState(item.phoneNumberId)
    } catch {
      throw new WhatsAppProspectingError('A Evolution API não está disponível agora.', 503)
    }
    if (connectionState.state.toLowerCase() !== 'open') {
      throw new WhatsAppProspectingError('A instância Evolution está desconectada. Reconecte o WhatsApp antes de enviar.', 503)
    }
    return { userId }
  }

  async persistSentMessage(item: WhatsAppProspectingQueueItem, userId: string, providerMessageId: string, sentAt: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const conversationResult = await admin.from('whatsapp_conversations')
      .upsert({
        user_id: userId,
        phone_number_id: item.phoneNumberId,
        contact_wa_id: item.recipientPhone,
      }, { onConflict: 'phone_number_id,contact_wa_id' })
      .select('id')
      .single()
    throwIfError(conversationResult.error, 'A API aceitou o envio, mas não foi possível preparar o histórico da conversa.')
    const conversationId = (conversationResult.data as { id: string } | null)?.id
    if (!conversationId) throw new Error('A API aceitou o envio, mas a conversa não foi encontrada para salvar o histórico.')

    const messageResult = await admin.from('whatsapp_messages')
      .upsert({
        user_id: userId,
        phone_number_id: item.phoneNumberId,
        conversation_id: conversationId,
        provider_message_id: providerMessageId,
        contact_wa_id: item.recipientPhone,
        direction: 'outbound',
        message_type: 'text',
        body: item.message,
        source: 'live',
        is_placeholder: false,
        occurred_at: sentAt,
      }, { onConflict: 'phone_number_id,provider_message_id' })
    throwIfError(messageResult.error, 'A API aceitou o envio, mas não foi possível registrar a mensagem no histórico.')

    const leadResult = await admin.from('saved_leads')
      .update({ status: 'Contatado', updated_at: sentAt })
      .eq('user_id', userId)
      .eq('lead_id', item.leadId)
    throwIfError(leadResult.error, 'A mensagem foi enviada, mas não foi possível atualizar o status do lead.')

    const interactionResult = await admin.from('lead_interactions').insert({
      user_id: userId,
      lead_id: item.leadId,
      channel: 'WhatsApp',
      occurred_at: sentAt.slice(0, 10),
      notes: `Primeiro contato enviado pela Evolution API. Mensagem: ${item.message}`,
      outcome: 'Enviado pelo DigiBusca',
    })
    throwIfError(interactionResult.error, 'A mensagem foi enviada, mas não foi possível registrar a interação no CRM.')
  }

  async finishQueueItem(
    queueId: string,
    status: 'sent' | 'failed' | 'unknown',
    options: { providerMessageId?: string; errorCode?: string } = {},
  ) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const now = new Date().toISOString()
    const result = await admin.from('whatsapp_prospecting_queue')
      .update({
        status,
        ...(options.providerMessageId ? { provider_message_id: options.providerMessageId, sent_at: now } : {}),
        error_code: options.errorCode ?? null,
        updated_at: now,
      })
      .eq('id', queueId)
      .eq('status', 'sending')
    throwIfError(result.error, 'Não foi possível salvar o resultado do envio na fila.')
  }
}
