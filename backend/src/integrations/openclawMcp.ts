import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { runLocalWhatsAppProspectingTick } from '../application/processLocalWhatsAppProspecting.js'
import { executeSearchLeads } from '../application/searchLeads.js'
import { leadStatuses, parseLeadSnapshot, type Lead, type LeadSnapshot } from '../contracts/lead.js'
import { getOpenClawMcpConfig, isOpenClawGatewayReady, isWhatsAppOpenClawRuntimeEnabled, isWhatsAppOpenClawProspectingRuntimeEnabled, createWhatsAppWebhookSupabaseClient } from '../config/supabase.js'
import { GooglePlacesProvider } from './googlePlacesProvider.js'
import { WhatsAppProspectingError, WhatsAppProspectingStore } from '../data/whatsappProspectingStore.js'
import { WhatsAppStore } from '../data/whatsappStore.js'
import { logWarning } from '../observability/logger.js'
import {
  checkGoogleCalendarAvailability,
  createGoogleMeetEvent,
  getGoogleCalendarConnectionStatus,
  GoogleCalendarIntegrationError,
} from './googleCalendar.js'
import { isClearMeetingAcceptance, isMeetingConfirmationRequestForSlot } from './meetingConfirmation.js'

const savedLeadFields = 'lead_id, lead_data, lead_data_expires_at, status, notes, next_follow_up, conversation_stage, contact_name, next_action, draft_message, whatsapp_consent_status, whatsapp_consent_source, whatsapp_consent_at, whatsapp_outbound_authorization_status, whatsapp_outbound_authorization_source, whatsapp_outbound_authorization_at, updated_at'
const ownerSearchAuthorizationSource = 'Autorização do titular para prospecção de leads retornados pela busca DigiBusca/Google Maps'

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] }
}

function requestProspectingQueueDispatch() {
  setImmediate(() => {
    void runLocalWhatsAppProspectingTick().catch(() => {
      logWarning('openclaw_mcp_queue_dispatch_failed', { reason: 'queue_dispatch_unavailable' })
    })
  })
}

function asSnapshot(lead: Lead): LeadSnapshot | undefined {
  return parseLeadSnapshot({
    id: lead.id,
    name: lead.name,
    category: lead.category,
    address: lead.address,
    phone: lead.phone,
    rating: lead.rating,
    reviews: lead.reviews,
    ...(lead.website ? { website: lead.website } : {}),
    ...(lead.googleMapsUri ? { googleMapsUri: lead.googleMapsUri } : {}),
    source: lead.source,
    retrievedAt: lead.retrievedAt,
    opportunity: lead.opportunity,
    score: lead.score,
    diagnosis: lead.diagnosis,
  }, lead.id)
}

async function saveSearchSnapshot(userId: string, lead: Lead) {
  const snapshot = asSnapshot(lead)
  if (!snapshot) return false
  const admin = createWhatsAppWebhookSupabaseClient()
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString()
  const existing = await admin.from('saved_leads')
    .select('lead_id, whatsapp_consent_status')
    .eq('user_id', userId)
    .eq('lead_id', lead.id)
    .maybeSingle()
  if (existing.error) throw new Error('Não foi possível verificar o lead salvo.')

  if (existing.data) {
    const existingRow = existing.data as { whatsapp_consent_status?: string | null }
    const updated = await admin.from('saved_leads')
      .update({
        lead_data: snapshot,
        lead_data_expires_at: expiresAt,
        ...(existingRow.whatsapp_consent_status !== 'opted_out' ? {
          whatsapp_outbound_authorization_status: 'authorized_by_owner',
          whatsapp_outbound_authorization_source: ownerSearchAuthorizationSource,
          whatsapp_outbound_authorization_at: new Date(lead.retrievedAt).toISOString(),
        } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('lead_id', lead.id)
    if (updated.error) throw new Error('Não foi possível atualizar o snapshot do lead.')
    return false
  }

  const inserted = await admin.from('saved_leads').insert({
    user_id: userId,
    lead_id: lead.id,
    lead_data: snapshot,
    lead_data_expires_at: expiresAt,
    status: 'Novo',
    whatsapp_consent_status: 'unknown',
    whatsapp_consent_source: null,
    whatsapp_consent_at: null,
    whatsapp_outbound_authorization_status: 'authorized_by_owner',
    whatsapp_outbound_authorization_source: ownerSearchAuthorizationSource,
    whatsapp_outbound_authorization_at: new Date(lead.retrievedAt).toISOString(),
    updated_at: new Date().toISOString(),
  })
  if (inserted.error?.code === '23505') {
    const racedUpdate = await admin.from('saved_leads')
      .update({ lead_data: snapshot, lead_data_expires_at: expiresAt, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('lead_id', lead.id)
    if (racedUpdate.error) throw new Error('Não foi possível atualizar o snapshot do lead.')
    return false
  }
  if (inserted.error) throw new Error('Não foi possível salvar o lead da busca.')
  return true
}

function normalizeSavedLead(row: Record<string, unknown>) {
  const snapshot = typeof row.lead_data === 'object' && row.lead_data !== null
    ? row.lead_data as Record<string, unknown>
    : {}
  return {
    leadId: row.lead_id,
    name: typeof snapshot.name === 'string' ? snapshot.name : '',
    category: typeof snapshot.category === 'string' ? snapshot.category : '',
    phone: typeof snapshot.phone === 'string' ? snapshot.phone : '',
    address: typeof snapshot.address === 'string' ? snapshot.address : '',
    website: typeof snapshot.website === 'string' ? snapshot.website : null,
    opportunity: typeof snapshot.opportunity === 'string' ? snapshot.opportunity : null,
    status: row.status,
    notes: row.notes,
    nextFollowUp: row.next_follow_up,
    conversationStage: row.conversation_stage,
    contactName: row.contact_name,
    nextAction: row.next_action,
    draftMessage: row.draft_message,
    whatsappConsentStatus: row.whatsapp_consent_status ?? 'unknown',
    whatsappOutboundAuthorizationStatus: row.whatsapp_outbound_authorization_status ?? 'not_authorized',
    whatsappOutboundAuthorizationSource: row.whatsapp_outbound_authorization_source ?? null,
    whatsappOutboundAuthorizationAt: row.whatsapp_outbound_authorization_at ?? null,
    updatedAt: row.updated_at,
  }
}

function createOpenClawMcpServer() {
  const server = new McpServer({ name: 'digibusca-cristhian', version: '1.0.0' }, {
    instructions: [
      'Ferramentas privadas do DigiBusca usadas pelo Cristhian, agente principal do WhatsApp.',
      'O titular autorizou o primeiro contato aos resultados desta busca. Isso é uma autorização operacional da conta, não consentimento declarado pelo destinatário. Opt-out, conversa existente, janela, pausa e limite sempre bloqueiam o envio.',
      'A busca do Cristhian coloca automaticamente na fila os leads elegíveis. O backend agenda cada envio e chama uma execução isolada do Cristhian. Não retire contatos da fila nem tente enviar a mensagem por conta própria; o plugin do DigiBusca valida e registra cada envio confirmado.',
      'Para preparar um primeiro contato manual, use queue_prospect. A fila faz o despacho automaticamente, sempre respeitando autorização, janela e limite.',
      'O DigiBusca aplica janela de dias úteis das 9h às 14h, limite diário, pausa, opt-out, deduplicação e revalidação antes do envio.',
      'Para reuniões, consulte a disponibilidade no Google Agenda. Ao oferecer um horário, informe claramente o dia, a data e a hora e pergunte de forma natural se pode reservar. Considere qualquer resposta claramente afirmativa — inclusive “sim”, “confirmo”, “pode marcar”, “fechado”, “ok”, “perfeito”, “combinado” ou equivalente — como confirmação; nunca exija frase exata nem que a pessoa repita o horário. Ao chamar create_confirmed_meeting, informe o texto da última oferta do Cristhian e a resposta mais recente do cliente, exatamente como aparecem no chat. A ferramenta valida esses textos e a disponibilidade atual da agenda. Se houver dúvida, recusa ou proposta de outro horário, não crie o evento; consulte a agenda novamente se necessário. Confirme pelo WhatsApp usando o link do Meet retornado pela ferramenta.',
      'Não exponha detalhes de outros compromissos da agenda. Se o horário estiver ocupado, diga apenas que ele não está disponível e pergunte outra opção.',
      'Não exponha dados de outros leads nem altere consentimento com estas ferramentas.',
    ].join('\n'),
    maxToolInputElements: 128,
  })

  server.registerTool('get_runtime_status', {
    title: 'Ver status do Cristhian',
    description: 'Consulta a conexão entre OpenClaw, WhatsApp e DigiBusca, além do estado da fila.',
    inputSchema: z.object({}),
  }, async () => {
    const config = getOpenClawMcpConfig()
    if (!config) return errorResult('Integração MCP OpenClaw ainda não configurada no backend.')
    try {
      const admin = createWhatsAppWebhookSupabaseClient()
      const [connection, profile, settings] = await Promise.all([
        admin.from('whatsapp_phone_number_connections')
          .select('platform_type')
          .eq('user_id', config.ownerUserId)
          .eq('phone_number_id', config.phoneNumberId)
          .maybeSingle(),
        admin.from('whatsapp_automation_profiles')
          .select('response_mode, automation_enabled, channel_approved_at, content_approved_at')
          .eq('user_id', config.ownerUserId)
          .eq('phone_number_id', config.phoneNumberId)
          .maybeSingle(),
        admin.from('whatsapp_prospecting_settings')
          .select('enabled, daily_new_lead_limit, timezone, default_city, next_new_lead_at')
          .eq('user_id', config.ownerUserId)
          .maybeSingle(),
      ])
      const failures = [connection.error, profile.error, settings.error].filter(Boolean)
      if (failures.length > 0) throw new Error('storage_unavailable')
      const connectionReady = connection.data?.platform_type === 'OPENCLAW_WEB'
      const activeProfile = profile.data?.response_mode === 'openclaw' && profile.data?.automation_enabled === true
      const storageReady = await new WhatsAppStore().isOpenClawStorageReady().catch(() => false)
      const gatewayReady = await isOpenClawGatewayReady()
      const googleCalendar = await getGoogleCalendarConnectionStatus(config.ownerUserId).catch(() => ({ configured: false, storageReady: false, connected: false }))
      return textResult({
        agent: 'Cristhian',
        runtimeEnabled: isWhatsAppOpenClawRuntimeEnabled(),
        prospectingDispatcherReady: isWhatsAppOpenClawProspectingRuntimeEnabled() && storageReady && gatewayReady && connectionReady,
        gatewayReady,
        whatsappTransport: connection.data?.platform_type ?? 'not_connected',
        whatsappPairingRegistered: connectionReady,
        whatsappSessionLiveVerified: false,
        replyAutomationConfigured: connectionReady && activeProfile && Boolean(profile.data?.channel_approved_at && profile.data?.content_approved_at),
        googleCalendar,
        prospecting: settings.data ? {
          enabled: settings.data.enabled === true,
          dailyLimit: settings.data.daily_new_lead_limit,
          timezone: settings.data.timezone,
          defaultCity: settings.data.default_city,
          nextSendAt: settings.data.next_new_lead_at,
        } : null,
      })
    } catch {
      return errorResult('Não foi possível consultar o estado do DigiBusca. Confira se a migration 022 está aplicada.')
    }
  })

  server.registerTool('check_calendar_availability', {
    title: 'Conferir horário no Google Agenda',
    description: 'Confere se um intervalo está livre na agenda principal. Retorna somente ocupado/livre e os intervalos indisponíveis, sem títulos nem detalhes de outros eventos. Use antes de oferecer ou confirmar um horário.',
    inputSchema: z.object({
      startAt: z.string().trim().min(20).max(40),
      endAt: z.string().trim().min(20).max(40),
    }),
  }, async ({ startAt, endAt }) => {
    const config = getOpenClawMcpConfig()
    if (!config) return errorResult('Integração MCP OpenClaw ainda não configurada no backend.')
    try {
      const result = await checkGoogleCalendarAvailability(config.ownerUserId, startAt, endAt)
      return textResult({ checked: true, ...result })
    } catch (error) {
      if (error instanceof GoogleCalendarIntegrationError) {
        if (error.reason === 'not_configured') return errorResult('Google Agenda ainda não foi configurado no DigiBusca.')
        if (error.reason === 'not_connected') return errorResult('Google Agenda ainda não está conectado. Não confirme nem prometa disponibilidade.')
        if (error.reason === 'authorization_expired') return errorResult('A autorização do Google expirou. Avise internamente para reconectar a agenda e não confirme horário.')
        if (error.reason === 'invalid_time') return errorResult('Informe um intervalo futuro válido, com fuso horário, de até sete dias.')
        return errorResult('Não foi possível consultar a agenda agora. Não confirme disponibilidade.')
      }
      return errorResult('Não foi possível consultar a agenda agora. Não confirme disponibilidade.')
    }
  })

  server.registerTool('create_confirmed_meeting', {
    title: 'Salvar reunião e criar link do Meet',
    description: 'Cria um evento na agenda principal depois que o cliente aceitar naturalmente o horário oferecido. “Sim”, “Confirmo”, “pode marcar”, “fechado”, “ok” e qualquer resposta afirmativa clara valem; não exija frase exata nem que o cliente repita o dia ou horário. Passe latestAssistantOffer e latestCustomerConfirmation com os textos exatos das duas mensagens mais recentes relevantes no chat do OpenClaw. A ferramenta valida que a oferta apresenta este mesmo dia/horário e que a resposta confirma sem ressalvas, revalida a disponibilidade antes de salvar e retorna o link do Google Meet.',
    inputSchema: z.object({
      contactName: z.string().trim().min(1).max(120),
      contactPhone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
      startAt: z.string().trim().min(20).max(40),
      durationMinutes: z.number().int().min(15).max(180).default(30),
      projectSummary: z.string().trim().min(2).max(600),
      latestAssistantOffer: z.string().trim().min(8).max(1000).describe('Texto exato da oferta mais recente do Cristhian para este dia e horário, conforme aparece na conversa atual do OpenClaw.'),
      latestCustomerConfirmation: z.string().trim().min(1).max(500).describe('Texto exato da resposta mais recente do cliente aceitando o horário. Uma resposta simples como “Confirmo” ou “sim” basta; não peça que o cliente repita uma frase.'),
    }),
  }, async ({ contactName, contactPhone, startAt, durationMinutes, projectSummary, latestAssistantOffer, latestCustomerConfirmation }) => {
    const config = getOpenClawMcpConfig()
    if (!config) return errorResult('Integração MCP OpenClaw ainda não configurada no backend.')
    try {
      const receivedAt = new Date().toISOString()
      if (!isMeetingConfirmationRequestForSlot(latestAssistantOffer, startAt, receivedAt)
        || !isClearMeetingAcceptance(latestCustomerConfirmation, startAt, receivedAt)) {
        return errorResult('Não reconheci uma confirmação clara para o horário oferecido. Só confirme se a mensagem mais recente do cliente aceitar esse mesmo horário sem ressalvas. Não peça uma frase exata.')
      }
      const event = await createGoogleMeetEvent({
        userId: config.ownerUserId,
        contactName,
        contactPhone,
        startAt,
        durationMinutes,
        projectSummary,
      })
      if (!event.created) return textResult({ created: false, reason: 'busy', message: 'Esse horário ficou ocupado. Pergunte ao cliente outra opção e confira novamente.' })
      const meetReady = 'meetUrl' in event && Boolean(event.meetUrl)
      return textResult({ ...event, message: meetReady
        ? 'Reunião salva e link do Google Meet pronto para enviar ao cliente.'
        : 'Reunião salva, mas o link do Google Meet ainda está sendo preparado. Não diga que o link está pronto; consulte o evento novamente em instantes.' })
    } catch (error) {
      if (error instanceof GoogleCalendarIntegrationError) {
        if (error.reason === 'not_configured') return errorResult('Google Agenda ainda não foi configurado no DigiBusca.')
        if (error.reason === 'not_connected') return errorResult('Google Agenda ainda não está conectado. Não confirme nem prometa disponibilidade.')
        if (error.reason === 'authorization_expired') return errorResult('A autorização do Google expirou. Avise internamente para reconectar a agenda; não diga que a reunião foi salva.')
        if (error.reason === 'invalid_time') return errorResult('O horário, telefone ou duração da reunião é inválido. Não criei o evento.')
        if (error.reason === 'busy') return errorResult('O horário está ocupado. Pergunte ao cliente outra opção antes de criar a reunião.')
      }
      return errorResult('Não foi possível salvar a reunião agora. Não diga ao cliente que o evento ou link foi criado.')
    }
  })

  server.registerTool('request_calendar_follow_up', {
    title: 'Sinalizar pedido de reunião para conferência',
    description: 'Marca a conversa para sua conferência interna quando o Google Agenda estiver desconectado, indisponível ou quando for preciso verificar manualmente. Não pausa o Cristhian nem envia mensagem ao cliente.',
    inputSchema: z.object({
      contactPhone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
      requestedTime: z.string().trim().min(2).max(160),
    }),
  }, async ({ contactPhone, requestedTime }) => {
    const config = getOpenClawMcpConfig()
    if (!config) return errorResult('Integração MCP OpenClaw ainda não configurada no backend.')
    try {
      const digits = contactPhone.replace(/\D/g, '')
      const admin = createWhatsAppWebhookSupabaseClient()
      const conversation = await admin.from('whatsapp_conversations')
        .select('id')
        .eq('user_id', config.ownerUserId)
        .eq('phone_number_id', config.phoneNumberId)
        .eq('contact_wa_id', digits)
        .maybeSingle()
      if (conversation.error || !conversation.data) return errorResult('Não encontrei a conversa para sinalizar o pedido de reunião.')
      const marked = await new WhatsAppStore().markConversationScheduleReviewRequired(config.ownerUserId, conversation.data.id)
      if (!marked) return errorResult('A conversa está pausada ou o cliente pediu para parar. Não registrei um novo pedido de agenda.')
      return textResult({ followUpRequired: true, conversationId: conversation.data.id, requestedTime, message: 'Pedido sinalizado internamente. O Cristhian continua atendendo; não diga ao cliente que houve transferência.' })
    } catch {
      return errorResult('Não foi possível sinalizar o pedido de reunião. Não diga ao cliente que a agenda foi conferida.')
    }
  })

  server.registerTool('search_leads_without_site', {
    title: 'Buscar negócios sem site',
    description: 'Busca até 20 negócios locais sem site no Google Places, salva os leads e registra a autorização do titular para primeiro contato conforme a política configurada. Não registra consentimento do destinatário.',
    inputSchema: z.object({
      city: z.string().trim().min(2).max(120),
      segment: z.string().trim().max(120).optional(),
    }),
  }, async ({ city, segment }) => {
    const config = getOpenClawMcpConfig()
    if (!config) return errorResult('Integração MCP OpenClaw ainda não configurada no backend.')
    try {
      const admin = createWhatsAppWebhookSupabaseClient()
      const provider = new GooglePlacesProvider(undefined, async (requestType) => {
        const reservation = await admin.rpc('reserve_google_api_usage_for_user', {
          p_user_id: config.ownerUserId,
          p_request_type: requestType,
        })
        if (reservation.error) throw new Error('quota_reservation_unavailable')
        return reservation.data as 'reserved' | 'reserved_at_limit' | 'blocked'
      })
      const result = await executeSearchLeads(provider, {
        city,
        segment: segment?.trim() || 'Todos os segmentos',
        opportunity: 'Sem site',
        languageCode: 'pt-BR',
        regionCode: 'BR',
      })
      const prospecting = new WhatsAppProspectingStore()
      let savedCount = 0
      for (const lead of result.data.slice(0, 20)) {
        if (await saveSearchSnapshot(config.ownerUserId, lead)) savedCount += 1
      }
      const [settings, dailyCount, pendingCount, connectionPlatform, storageReady] = await Promise.all([
        prospecting.getSettings(config.ownerUserId),
        prospecting.getDailyCount(config.ownerUserId),
        prospecting.getPendingQueueCount(config.ownerUserId),
        new WhatsAppStore().getConnectionPlatformType(config.ownerUserId, config.phoneNumberId),
        new WhatsAppStore().isOpenClawStorageReady().catch(() => false),
      ])
      const gatewayReady = await isOpenClawGatewayReady()
      let availableSlots = isWhatsAppOpenClawProspectingRuntimeEnabled() && storageReady && gatewayReady && settings.enabled && connectionPlatform === 'OPENCLAW_WEB'
        ? Math.max(0, settings.dailyNewLeadLimit - dailyCount - pendingCount)
        : 0
      let queuedCount = 0
      if (availableSlots > 0) {
        for (const lead of result.data.slice(0, 20)) {
          if (availableSlots <= 0) break
          if (!lead.phone.trim()) continue
          try {
            await prospecting.enqueueNewLead(config.ownerUserId, config.phoneNumberId, lead.id, undefined, 'OPENCLAW_WEB')
            queuedCount += 1
            availableSlots -= 1
          } catch {
            // Existing, opted-out, ineligible or already queued leads are skipped.
          }
        }
      }
      if (queuedCount > 0) requestProspectingQueueDispatch()
      const savedAuthorizationResult = result.data.length > 0
        ? await admin.from('saved_leads')
          .select('lead_id, whatsapp_consent_status, whatsapp_outbound_authorization_status')
          .eq('user_id', config.ownerUserId)
          .in('lead_id', result.data.slice(0, 20).map((lead) => lead.id))
        : { data: [], error: null }
      if (savedAuthorizationResult.error) throw new Error('lead_authorization_lookup_failed')
      const authorizationByLeadId = new Map(((savedAuthorizationResult.data ?? []) as Array<{
        lead_id: string
        whatsapp_consent_status: string | null
        whatsapp_outbound_authorization_status: string | null
      }>).map((row) => [row.lead_id, row]))
      return textResult({
        city,
        segment: segment?.trim() || 'Todos os segmentos',
        found: Math.min(result.data.length, 20),
        newlySaved: savedCount,
        queuedCount,
        leads: result.data.slice(0, 20).map((lead) => {
          const authorization = authorizationByLeadId.get(lead.id)
          return {
            leadId: lead.id,
            name: lead.name,
            category: lead.category,
            phone: lead.phone,
            address: lead.address,
            website: lead.website ?? null,
            status: 'Novo',
            whatsappConsentStatus: authorization?.whatsapp_consent_status ?? 'unknown',
            outboundAuthorization: authorization?.whatsapp_consent_status === 'opted_out'
              ? 'blocked_opt_out'
              : authorization?.whatsapp_consent_status === 'opted_in'
                ? 'recipient_opted_in'
                : authorization?.whatsapp_outbound_authorization_status === 'authorized_by_owner'
                  ? 'authorized_by_owner'
                  : 'not_authorized',
          }
        }),
        nextPageAvailable: Boolean(result.meta.nextPageToken),
        message: queuedCount > 0
          ? `Busca concluída. ${queuedCount} contatos foram preparados com mensagem inicial e adicionados à fila. O titular autorizou a prospecção; respeite os horários, limites e descadastros do DigiBusca.`
          : !settings.enabled
            ? 'Busca concluída. Os leads foram salvos, mas a fila de prospecção está pausada no DigiBusca.'
            : connectionPlatform !== 'OPENCLAW_WEB' || !isWhatsAppOpenClawRuntimeEnabled()
              ? 'Busca concluída. Os leads foram salvos, mas o transporte OpenClaw ainda não está registrado e ativo no DigiBusca.'
              : !storageReady
                ? 'Busca concluída. Os leads foram salvos, mas a migration 022 do OpenClaw ainda não está aplicada no Supabase.'
              : !gatewayReady
                ? 'Busca concluída. Os leads foram salvos, mas o Gateway OpenClaw não está pronto agora; a fila não foi iniciada.'
              : !isWhatsAppOpenClawProspectingRuntimeEnabled()
                ? 'Busca concluída. Os leads foram salvos, mas o despacho automático do Cristhian ainda não está configurado. Confira o webhook privado e o token do OpenClaw.'
              : availableSlots === 0
                ? 'Busca concluída. Os leads foram salvos, mas o limite diário já está reservado por envios ou contatos na fila.'
                : 'Busca concluída. Os leads foram salvos, mas não há novos contatos elegíveis para a fila.',
      })
    } catch (error) {
      const message = error instanceof Error && error.message.includes('quota')
        ? 'Não foi possível reservar a cota de busca do Google. Confira a migration 022 e o limite mensal.'
        : 'A busca não foi concluída. Confira a chave do Google Places, a cota e a migration 022.'
      return errorResult(message)
    }
  })

  server.registerTool('list_leads', {
    title: 'Consultar leads salvos',
    description: 'Lista leads da conta DigiBusca fixa, incluindo consentimento declarado e autorização operacional do titular para contato.',
    inputSchema: z.object({
      status: z.enum(leadStatuses as [typeof leadStatuses[number], ...typeof leadStatuses[number][]]).optional(),
      query: z.string().trim().max(120).optional(),
      limit: z.number().int().min(1).max(100).default(30),
    }),
  }, async ({ status, query, limit }) => {
    const config = getOpenClawMcpConfig()
    if (!config) return errorResult('Integração MCP OpenClaw ainda não configurada no backend.')
    try {
      const admin = createWhatsAppWebhookSupabaseClient()
      let request = admin.from('saved_leads').select(savedLeadFields)
        .eq('user_id', config.ownerUserId)
        .order('updated_at', { ascending: false })
        .limit(Math.min(500, Math.max(limit * 5, 100)))
      if (status) request = request.eq('status', status)
      const result = await request
      if (result.error) throw new Error('lead_storage_unavailable')
      const needle = query?.toLocaleLowerCase('pt-BR')
      const leads = ((result.data ?? []) as Array<Record<string, unknown>>)
        .map(normalizeSavedLead)
        .filter((lead) => !needle || `${lead.name} ${lead.category} ${lead.phone} ${lead.address}`.toLocaleLowerCase('pt-BR').includes(needle))
        .slice(0, limit)
      return textResult({ count: leads.length, leads })
    } catch {
      return errorResult('Não foi possível consultar os leads salvos no DigiBusca.')
    }
  })

  server.registerTool('update_lead', {
    title: 'Atualizar lead no CRM',
    description: 'Atualiza status, notas, etapa e próximo contato de um lead da conta DigiBusca. Não altera consentimento.',
    inputSchema: z.object({
      leadId: z.string().trim().min(1).max(200),
      status: z.enum(leadStatuses as [typeof leadStatuses[number], ...typeof leadStatuses[number][]]).optional(),
      notes: z.string().max(2_000).optional(),
      nextFollowUp: z.string().max(100).optional(),
      conversationStage: z.string().max(120).optional(),
      contactName: z.string().max(160).optional(),
      nextAction: z.string().max(500).optional(),
      draftMessage: z.string().max(2_000).optional(),
    }).refine((value) => Object.keys(value).some((key) => key !== 'leadId'), 'Informe pelo menos um campo para atualizar.'),
  }, async ({ leadId, ...changes }) => {
    const config = getOpenClawMcpConfig()
    if (!config) return errorResult('Integração MCP OpenClaw ainda não configurada no backend.')
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (changes.status !== undefined) patch.status = changes.status
    if (changes.notes !== undefined) patch.notes = changes.notes || null
    if (changes.nextFollowUp !== undefined) patch.next_follow_up = changes.nextFollowUp || null
    if (changes.conversationStage !== undefined) patch.conversation_stage = changes.conversationStage || null
    if (changes.contactName !== undefined) patch.contact_name = changes.contactName || null
    if (changes.nextAction !== undefined) patch.next_action = changes.nextAction || null
    if (changes.draftMessage !== undefined) patch.draft_message = changes.draftMessage || null
    try {
      const admin = createWhatsAppWebhookSupabaseClient()
      const result = await admin.from('saved_leads').update(patch)
        .eq('user_id', config.ownerUserId)
        .eq('lead_id', leadId)
        .select('lead_id, status, updated_at')
        .maybeSingle()
      if (result.error) throw new Error('lead_update_failed')
      if (!result.data) return errorResult('Esse lead não está salvo na conta DigiBusca.')
      return textResult({ updated: true, leadId: result.data.lead_id, status: result.data.status, updatedAt: result.data.updated_at })
    } catch {
      return errorResult('Não foi possível atualizar esse lead no DigiBusca.')
    }
  })

  server.registerTool('queue_prospect', {
    title: 'Preparar primeiro contato',
    description: 'Prepara um lead elegível com a abertura padrão do Cristhian e o adiciona à fila, que fará o despacho automático respeitando autorização, opt-out, janela e limite diário.',
    inputSchema: z.object({
      leadId: z.string().trim().min(1).max(200),
    }),
  }, async ({ leadId }) => {
    const config = getOpenClawMcpConfig()
    if (!config) return errorResult('Integração MCP OpenClaw ainda não configurada no backend.')
    if (!isWhatsAppOpenClawProspectingRuntimeEnabled()) return errorResult('O despacho automático do Cristhian ainda não está configurado no backend.')
    try {
      if (!await new WhatsAppStore().isOpenClawStorageReady()) return errorResult('A migration 022 do OpenClaw ainda não está aplicada no Supabase.')
      if (!await isOpenClawGatewayReady()) return errorResult('O Gateway OpenClaw não está pronto. O lead não foi adicionado à fila.')
      const store = new WhatsAppProspectingStore()
      const settings = await store.getSettings(config.ownerUserId)
      if (!settings.enabled) return errorResult('A fila de prospecção está pausada no DigiBusca.')
      const item = await store.enqueueNewLead(config.ownerUserId, config.phoneNumberId, leadId, undefined, 'OPENCLAW_WEB')
      requestProspectingQueueDispatch()
      return textResult({ queued: true, queueId: item.id, leadId: item.leadId, scheduledAt: item.scheduledAt })
    } catch (error) {
      if (error instanceof WhatsAppProspectingError) return errorResult(error.message)
      return errorResult('Não foi possível preparar esse contato na fila.')
    }
  })

  return server
}

const mcpHandler = createMcpHandler(() => createOpenClawMcpServer(), { legacy: 'stateless' })
const nodeMcpHandler = toNodeHandler(mcpHandler)

export async function handleOpenClawMcpRequest(request: IncomingMessage, response: ServerResponse) {
  await nodeMcpHandler(request, response)
}
