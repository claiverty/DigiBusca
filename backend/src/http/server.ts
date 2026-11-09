import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import dotenv from 'dotenv'
import { executeSearchLeads } from '../application/searchLeads.js'
import { GooglePlacesProvider } from '../integrations/googlePlacesProvider.js'
import { isGoogleApiMonthlyLimitError } from '../application/googleApiUsageLimit.js'
import { opportunityTypes, parseLeadSnapshot, parseWhatsAppConsentChanges, type Lead, type LeadStatus, type LeadUpdate, type OpportunityType } from '../contracts/lead.js'
import type { CreateSaleInput, UpdateSaleInput } from '../contracts/sale.js'
import { interactionChannels, type CreateLeadInteractionInput } from '../contracts/interaction.js'
import { authenticateRequest, configureRuntimeEnvironment, getEvolutionApiConfig, getGeminiApiKey, getWhatsAppEvolutionSetupStatus, isWhatsAppAutomationRuntimeEnabled, isWhatsAppIntegrationEnabled, isWhatsAppProspectingRuntimeEnabled, isWhatsAppWebhookPersistenceConfigured } from '../config/supabase.js'
import { SupabaseStore, WhatsAppConsentSchemaMissingError } from '../data/supabaseStore.js'
import { listCities, listCountries, listStates } from '../integrations/locationCatalog.js'
import { parseGenerateOutreachInput } from '../contracts/aiOutreach.js'
import { GeminiOutreachError } from '../integrations/geminiOutreachProvider.js'
import { generateLeadOutreach } from '../application/generateLeadOutreach.js'
import { checkRateLimit } from './rateLimit.js'
import { createRequestId, logError, logInfo } from '../observability/logger.js'
import { checkSiteHealth } from '../integrations/siteHealth.js'
import { buildOpenBotOutreachPrompt, OpenBotOutreachResponseError, validateOpenBotOutreachAnswer } from '../application/generateOpenBotOutreach.js'
import { getOpenBotDelivery, listOpenBotAgents, OpenBotAutomationError, sendOpenBotAgentMessage } from '../integrations/openbotAutomationApi.js'
import { getEvolutionConnections, getEvolutionPairingStatus, startEvolutionConnection } from '../application/evolutionConnections.js'
import { persistEvolutionWebhook } from '../application/evolutionWebhook.js'
import { evolutionWebhookSecretMatches, EvolutionApiError } from '../integrations/evolutionApi.js'
import { whatsappWebhookMaxBodyBytes, WhatsAppWebhookBodyTooLargeError } from '../application/whatsappWebhook.js'
import { isUuid, parseWhatsAppPageOptions } from '../contracts/whatsapp.js'
import { parseWhatsAppAutomationProfileInput } from '../contracts/whatsappAutomation.js'
import { WhatsAppStore } from '../data/whatsappStore.js'
import { WhatsAppProspectingError, WhatsAppProspectingStore } from '../data/whatsappProspectingStore.js'
import { startLocalWhatsAppProspectingScheduler } from '../application/processLocalWhatsAppProspecting.js'

dotenv.config({ path: process.env.DIGIBUSCA_ENV_FILE ?? 'backend/.env' })
dotenv.config({ path: 'frontend/.env' })
configureRuntimeEnvironment(process.env)

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST?.trim() || '127.0.0.1'
const leadProvider = new GooglePlacesProvider()
const persistenceStore = new SupabaseStore()
const leadStatuses: LeadStatus[] = [
  'Novo',
  'Contatado',
  'Respondeu',
  'Proposta',
  'Ganhou',
  'Perdeu',
]
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  ...(process.env.DIGIBUSCA_APP_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
])

function mergeSavedLeadState(lead: Lead, state: Awaited<ReturnType<SupabaseStore['getSavedLeadState']>>) {
  if (!state) {
    return lead
  }

  const { leadId: _leadId, lead: _lead, leadDataExpiresAt: _leadDataExpiresAt, ...userState } = state
  return { ...lead, ...userState }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  const origin = response.req.headers.origin
  const currentRequestId = response.getHeader('X-Request-Id')
  const requestId = typeof currentRequestId === 'string'
    ? currentRequestId
    : createRequestId(
        typeof response.req.headers['cf-ray'] === 'string'
          ? response.req.headers['cf-ray']
          : typeof response.req.headers['x-request-id'] === 'string'
            ? response.req.headers['x-request-id']
            : undefined,
      )
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin':
      origin && allowedOrigins.has(origin) ? origin : 'http://127.0.0.1:5173',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...(origin && allowedOrigins.has(origin) && requestHasPrivateNetworkHeader(response.req)
      ? { 'Access-Control-Allow-Private-Network': 'true' }
      : {}),
    Vary: 'Origin',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Request-Id': requestId,
  })
  response.end(JSON.stringify(payload))
}

function requestHasPrivateNetworkHeader(request: IncomingMessage) {
  return request.headers['access-control-request-private-network'] === 'true'
}

function isAuthTokenError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes('jwt')
}

function sendRequestError(response: ServerResponse, error: unknown) {
  if (response.headersSent) {
    response.destroy()
    return
  }

  if (isAuthTokenError(error)) {
    sendJson(response, 401, { error: 'Sua sessão não é mais válida. Faça login novamente.' })
    return
  }

  if (error instanceof WhatsAppConsentSchemaMissingError) {
    sendJson(response, 503, { error: error.message })
    return
  }

  logError('api_request_failed', error, {
    method: response.req.method ?? 'UNKNOWN',
    path: response.req.url?.split('?')[0] ?? '/',
    requestId: createRequestId(
      typeof response.req.headers['cf-ray'] === 'string'
        ? response.req.headers['cf-ray']
        : typeof response.req.headers['x-request-id'] === 'string'
          ? response.req.headers['x-request-id']
          : undefined,
    ),
  })
  sendJson(response, 500, { error: 'Não foi possível concluir a operação agora.' })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isWhatsAppIntegrationPath(pathname: string) {
  return pathname === '/api/whatsapp' || pathname.startsWith('/api/whatsapp/') || pathname === '/api/webhooks/evolution'
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''

    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      if (!body) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('JSON inválido.'))
      }
    })
    request.on('error', reject)
  })
}

function readRawWebhookBody(request: IncomingMessage): Promise<Uint8Array> {
  const contentLength = request.headers['content-length']
  if (typeof contentLength === 'string' && /^\d+$/.test(contentLength) && Number(contentLength) > whatsappWebhookMaxBodyBytes) {
    request.resume()
    return Promise.reject(new WhatsAppWebhookBodyTooLargeError())
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.byteLength
      if (totalBytes > whatsappWebhookMaxBodyBytes) {
        tooLarge = true
        chunks.length = 0
        return
      }
      if (!tooLarge) chunks.push(buffer)
    })
    request.on('end', () => {
      if (tooLarge) {
        reject(new WhatsAppWebhookBodyTooLargeError())
        return
      }
      resolve(new Uint8Array(Buffer.concat(chunks, totalBytes)))
    })
    request.on('error', reject)
  })
}

function parseSaleInput(value: unknown): CreateSaleInput | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const { businessName, service, amount, soldAt, leadId } = value
  if (
    typeof businessName !== 'string' ||
    !businessName.trim() ||
    typeof service !== 'string' ||
    !service.trim() ||
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    typeof soldAt !== 'string' ||
    !soldAt
  ) {
    return undefined
  }

  return {
    businessName: businessName.trim(),
    service: service.trim(),
    amount,
    soldAt,
    ...(typeof leadId === 'string' && leadId ? { leadId } : {}),
  }
}

function parseUpdateSaleInput(value: unknown): UpdateSaleInput | undefined {
  const input = parseSaleInput(value)
  if (!input) return undefined

  const { leadId: _leadId, ...changes } = input
  return changes
}

function parseLeadInteractionInput(value: unknown): CreateLeadInteractionInput | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const { channel, occurredAt, notes, outcome } = value
  if (
    typeof channel !== 'string' ||
    !interactionChannels.includes(channel as (typeof interactionChannels)[number]) ||
    typeof occurredAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(occurredAt) ||
    Number.isNaN(Date.parse(`${occurredAt}T12:00:00Z`)) ||
    typeof notes !== 'string' ||
    !notes.trim() ||
    notes.trim().length > 5_000 ||
    (outcome !== undefined && (typeof outcome !== 'string' || outcome.trim().length > 500))
  ) {
    return undefined
  }

  return {
    channel: channel as (typeof interactionChannels)[number],
    occurredAt,
    notes: notes.trim(),
    ...(typeof outcome === 'string' && outcome.trim() ? { outcome: outcome.trim() } : {}),
  }
}

function parseOpenBotOutreachStartInput(value: unknown): { agentId: string; clientMessageId: string; input: NonNullable<ReturnType<typeof parseGenerateOutreachInput>> } | undefined {
  if (!isRecord(value) || !isRecord(value.input)) return undefined
  const agentId = typeof value.agentId === 'string' ? value.agentId.trim() : ''
  const clientMessageId = typeof value.clientMessageId === 'string' ? value.clientMessageId.trim() : ''
  const input = parseGenerateOutreachInput(value.input)
  if (!agentId || agentId.length > 200 || !clientMessageId || clientMessageId.length > 128 || !input) return undefined
  return { agentId, clientMessageId, input }
}

function parseOpenBotOutreachPollInput(value: unknown): NonNullable<ReturnType<typeof parseGenerateOutreachInput>> | undefined {
  if (!isRecord(value)) return undefined
  return parseGenerateOutreachInput(value.input)
}

function getSearchParams(request: IncomingMessage) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const opportunity = requestUrl.searchParams.get('opportunity')?.trim()

  return {
    city: requestUrl.searchParams.get('city')?.trim() ?? '',
    segment: requestUrl.searchParams.get('segment')?.trim() || 'Todos os segmentos',
    opportunity: opportunity || undefined,
    languageCode: requestUrl.searchParams.get('languageCode')?.trim() || undefined,
    regionCode: requestUrl.searchParams.get('regionCode')?.trim() || undefined,
    pageToken: requestUrl.searchParams.get('pageToken')?.trim() || undefined,
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  if (isWhatsAppIntegrationPath(requestUrl.pathname)) response.setHeader('Cache-Control', 'no-store')

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, null)
    return
  }

  if (requestUrl.pathname === '/api/health') {
    sendJson(response, 200, {
      status: 'ok',
      service: 'digibusca-backend',
      searchProvider: leadProvider.isConfigured ? 'google-places' : 'google-places-not-configured',
    })
    return
  }

  if (requestUrl.pathname === '/api/health/whatsapp-ready') {
    const configReady = isWhatsAppIntegrationEnabled() && Boolean(getEvolutionApiConfig()) && isWhatsAppWebhookPersistenceConfigured()
    const storageReady = configReady && await new WhatsAppStore().isEvolutionStorageReady()
    const ready = configReady && storageReady
    sendJson(response, ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready' })
    return
  }

  if (isWhatsAppIntegrationPath(requestUrl.pathname) && !isWhatsAppIntegrationEnabled()) {
    sendJson(response, 410, { error: 'A integração do WhatsApp está desativada.' })
    return
  }

  if (requestUrl.pathname === '/api/webhooks/whatsapp') {
    sendJson(response, 410, { error: 'Este endpoint legado foi desativado. Use o webhook local da Evolution API.' })
    return
  }

  if (requestUrl.pathname === '/api/webhooks/evolution') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Este webhook aceita somente POST.' })
      return
    }
    const suppliedSecret = request.headers['x-digibot-webhook-secret']
    if (!evolutionWebhookSecretMatches(typeof suppliedSecret === 'string' ? suppliedSecret : undefined)) {
      sendJson(response, 401, { error: 'A chave do webhook Evolution é inválida.' })
      return
    }
    let body: unknown
    try {
      const rawBody = await readRawWebhookBody(request)
      body = JSON.parse(new TextDecoder().decode(rawBody)) as unknown
    } catch (error) {
      if (error instanceof WhatsAppWebhookBodyTooLargeError) {
        sendJson(response, 413, { error: error.message })
        return
      }
      sendJson(response, 400, { error: 'O webhook Evolution enviou um JSON inválido.' })
      return
    }
    try {
      await persistEvolutionWebhook(body)
      sendJson(response, 200, { received: true })
    } catch {
      sendJson(response, 503, { error: 'Não foi possível persistir o evento Evolution no Supabase.' })
    }
    return
  }

  const authentication = await authenticateRequest(request.headers.authorization)
  if (!authentication) {
    sendJson(response, 401, { error: 'Faça login para acessar os dados da sua conta.' })
    return
  }

  const { accessToken, user } = authentication

  if (request.method === 'GET' && requestUrl.pathname === '/api/whatsapp/prospecting') {
    try {
      const prospectingStore = new WhatsAppProspectingStore()
      const [settings, dailyCount, queue] = await Promise.all([
        prospectingStore.getSettings(user.id),
        prospectingStore.getDailyCount(user.id),
        prospectingStore.listQueue(user.id),
      ])
      response.setHeader('Cache-Control', 'no-store')
      sendJson(response, 200, {
        data: {
          settings,
          dailyCount,
          queue,
          localRuntimeEnabled: isWhatsAppProspectingRuntimeEnabled(),
          evolutionConfigured: Boolean(getEvolutionApiConfig()),
        },
      })
    } catch {
      sendJson(response, 503, { error: 'Aplique a migration 013 do WhatsApp no Supabase para habilitar a fila de prospecção.' })
    }
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/whatsapp/prospecting/settings') {
    let body: unknown
    try {
      body = await readJsonBody(request)
    } catch {
      sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
      return
    }
    if (
      !isRecord(body) || typeof body.enabled !== 'boolean' ||
      typeof body.dailyNewLeadLimit !== 'number' || !Number.isInteger(body.dailyNewLeadLimit) ||
      body.dailyNewLeadLimit < 17 || body.dailyNewLeadLimit > 25
    ) {
      sendJson(response, 400, { error: 'Informe se a prospecção está ativa e um limite entre 17 e 25 novos leads por dia.' })
      return
    }
    if (body.enabled && !isWhatsAppProspectingRuntimeEnabled()) {
      sendJson(response, 503, { error: 'Ative WHATSAPP_PROSPECTING_RUNTIME_ENABLED no backend local e reinicie-o antes de ligar a fila.' })
      return
    }
    if (body.enabled && !getEvolutionApiConfig()) {
      sendJson(response, 503, { error: 'Configure a Evolution API no backend local antes de ligar a fila.' })
      return
    }
    if (body.enabled) {
      const connections = await getEvolutionConnections(user.id)
      if (!connections.some((connection) => connection.connectionState?.toLowerCase() === 'open')) {
        sendJson(response, 409, { error: 'Conecte o WhatsApp à Evolution API antes de ativar a fila.' })
        return
      }
    }
    try {
      const settings = await new WhatsAppProspectingStore().saveSettings(user.id, body.enabled, body.dailyNewLeadLimit)
      sendJson(response, 200, { data: settings })
    } catch (error) {
      if (error instanceof WhatsAppProspectingError) {
        sendJson(response, error.status, { error: error.message })
        return
      }
      sendJson(response, 503, { error: 'Não foi possível salvar as configurações da fila. Confira a migration 013 do WhatsApp.' })
    }
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/whatsapp/prospecting/queue') {
    let body: unknown
    try {
      body = await readJsonBody(request)
    } catch {
      sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
      return
    }
    if (
      !isRecord(body) || typeof body.phoneNumberId !== 'string' || !/^[-_a-zA-Z0-9]{1,128}$/.test(body.phoneNumberId) ||
      typeof body.leadId !== 'string' || !body.leadId.trim() || body.leadId.length > 200 ||
      typeof body.message !== 'string' || !body.message.trim() || body.message.trim().length > 1_024
    ) {
      sendJson(response, 400, { error: 'Informe o número conectado, o lead salvo e uma mensagem de até 1.024 caracteres.' })
      return
    }
    try {
      const data = await new WhatsAppProspectingStore().enqueueNewLead(
        user.id,
        body.phoneNumberId,
        body.leadId.trim(),
        body.message,
      )
      sendJson(response, 201, { data })
    } catch (error) {
      if (error instanceof WhatsAppProspectingError) {
        sendJson(response, error.status, { error: error.message })
        return
      }
      sendJson(response, 503, { error: 'Não foi possível adicionar este lead à fila de prospecção.' })
    }
    return
  }

  const prospectingQueueMatch = requestUrl.pathname.match(/^\/api\/whatsapp\/prospecting\/queue\/([^/]+)$/)
  if (request.method === 'DELETE' && prospectingQueueMatch) {
    const queueId = prospectingQueueMatch[1]
    if (!isUuid(queueId)) {
      sendJson(response, 400, { error: 'O item da fila é inválido.' })
      return
    }
    try {
      const cancelled = await new WhatsAppProspectingStore().cancelQueuedItem(user.id, queueId)
      if (!cancelled) {
        sendJson(response, 409, { error: 'Este item já foi processado ou não pertence à sua conta.' })
        return
      }
      sendJson(response, 200, { data: { cancelled: true } })
    } catch {
      sendJson(response, 503, { error: 'Não foi possível cancelar este item da fila.' })
    }
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/whatsapp/connections') {
    response.setHeader('Cache-Control', 'no-store')
    sendJson(response, 200, { data: await getEvolutionConnections(user.id) })
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/whatsapp/connections/evolution/qr') {
    response.setHeader('Cache-Control', 'no-store')
    try {
      sendJson(response, 200, { data: await getEvolutionPairingStatus(user.id) })
    } catch {
      sendJson(response, 503, { error: 'Não foi possível atualizar o QR Code. Gere um novo código.' })
    }
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/whatsapp/connections/evolution') {
    try {
      const data = await startEvolutionConnection(user.id)
      response.setHeader('Cache-Control', 'no-store')
      sendJson(response, 201, { data })
    } catch (error) {
      response.setHeader('Cache-Control', 'no-store')
      const statusCode = error instanceof EvolutionApiError
        ? error.status
        : error instanceof Error && error.message.includes('já está associado') ? 409 : 503
      sendJson(response, statusCode, { error: error instanceof Error ? error.message : 'Não foi possível conectar a Evolution API.' })
    }
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/whatsapp/conversations') {
    const options = parseWhatsAppPageOptions(requestUrl.searchParams)
    if (!options) {
      sendJson(response, 400, { error: 'Os parâmetros de paginação são inválidos.' })
      return
    }
    sendJson(response, 200, { data: await new WhatsAppStore().listConversations(accessToken, user.id, options) })
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/whatsapp/automation') {
    const phoneNumberId = requestUrl.searchParams.get('phoneNumberId') ?? ''
    if (!/^[-_a-zA-Z0-9]{1,128}$/.test(phoneNumberId)) {
      sendJson(response, 400, { error: 'Selecione um número WhatsApp válido.' })
      return
    }
    const profile = await new WhatsAppStore().getAutomationProfile(user.id, phoneNumberId)
    response.setHeader('Cache-Control', 'no-store')
    sendJson(response, 200, { data: profile ?? null })
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/whatsapp/automation') {
    let body: unknown
    try {
      body = await readJsonBody(request)
    } catch {
      sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
      return
    }
    const input = parseWhatsAppAutomationProfileInput(body)
    if (!input) {
      sendJson(response, 400, { error: 'Revise os campos e as aprovações antes de salvar.' })
      return
    }
    if (input.automationEnabled && !isWhatsAppAutomationRuntimeEnabled()) {
      sendJson(response, 503, { error: 'A automação está bloqueada pelo interruptor global do servidor.' })
      return
    }
    const profile = await new WhatsAppStore().saveAutomationProfile(user.id, input)
    response.setHeader('Cache-Control', 'no-store')
    sendJson(response, 200, { data: profile })
    return
  }

  const automationPauseMatch = requestUrl.pathname.match(/^\/api\/whatsapp\/conversations\/([^/]+)\/automation$/)
  if (request.method === 'PATCH' && automationPauseMatch) {
    const conversationId = automationPauseMatch[1]
    let body: unknown
    try {
      body = await readJsonBody(request)
    } catch {
      sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
      return
    }
    if (!isUuid(conversationId) || typeof body !== 'object' || body === null || typeof (body as Record<string, unknown>).paused !== 'boolean') {
      sendJson(response, 400, { error: 'A ação da conversa é inválida.' })
      return
    }
    const paused = (body as { paused: boolean }).paused
    const updated = await new WhatsAppStore().setConversationAutomationPaused(user.id, conversationId, paused, paused ? 'manual' : 'manual_resume')
    if (!updated) {
      sendJson(response, 404, { error: 'Conversa não encontrada.' })
      return
    }
    sendJson(response, 200, { data: { paused } })
    return
  }

  const whatsappMessagesMatch = requestUrl.pathname.match(/^\/api\/whatsapp\/conversations\/([^/]+)\/messages$/)
  if (request.method === 'GET' && whatsappMessagesMatch) {
    const conversationId = whatsappMessagesMatch[1]
    const options = parseWhatsAppPageOptions(requestUrl.searchParams)
    if (!isUuid(conversationId) || !options) {
      sendJson(response, 400, { error: 'A conversa ou os parâmetros de paginação são inválidos.' })
      return
    }
    const data = await new WhatsAppStore().listConversationMessages(accessToken, user.id, conversationId, options)
    if (!data) {
      sendJson(response, 404, { error: 'Conversa não encontrada.' })
      return
    }
    sendJson(response, 200, { data })
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/whatsapp/status') {
    const connectionStorageReady = await new WhatsAppStore().isEvolutionStorageReady()
    const automationStorageReady = await new WhatsAppStore().isAutomationStorageReady()
    sendJson(response, 200, { data: { ...getWhatsAppEvolutionSetupStatus(), connectionStorageReady, automationStorageReady } })
    return
  }

  const trackedLeadProvider = new GooglePlacesProvider(
    undefined,
    (requestType) => persistenceStore.reserveGoogleApiRequest(accessToken, requestType),
  )
  const interactionMatch = requestUrl.pathname.match(/^\/api\/leads\/([^/]+)\/interactions$/)

  if (request.method === 'GET' && requestUrl.pathname === '/api/openbot/agents') {
    try {
      sendJson(response, 200, { data: await listOpenBotAgents() })
    } catch (error) {
      if (error instanceof OpenBotAutomationError) {
        sendJson(response, error.status, { error: error.message })
        return
      }
      throw error
    }
    return
  }

  if (request.method === 'GET' && interactionMatch) {
    sendJson(response, 200, {
      data: await persistenceStore.listLeadInteractions(accessToken, user.id, interactionMatch[1]),
    })
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/locations/countries') {
    sendJson(response, 200, { data: await listCountries() })
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/locations/states') {
    const countryCode = requestUrl.searchParams.get('country')?.trim().toUpperCase()
    if (!countryCode) {
      sendJson(response, 400, { error: 'O parâmetro country é obrigatório.' })
      return
    }

    sendJson(response, 200, { data: await listStates(countryCode) })
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/locations/cities') {
    const countryCode = requestUrl.searchParams.get('country')?.trim().toUpperCase()
    const stateCode = requestUrl.searchParams.get('state')?.trim().toUpperCase() || undefined
    if (!countryCode) {
      sendJson(response, 400, { error: 'O parâmetro country é obrigatório.' })
      return
    }

    sendJson(response, 200, { data: await listCities(countryCode, stateCode) })
    return
  }

  if (request.method !== 'GET') {
    const saveMatch = requestUrl.pathname.match(/^\/api\/leads\/([^/]+)\/save$/)
    const updateMatch = requestUrl.pathname.match(/^\/api\/leads\/([^/]+)$/)
    const salesMatch = requestUrl.pathname === '/api/sales'
    const saleMatch = requestUrl.pathname.match(/^\/api\/sales\/([^/]+)$/)

    if (requestUrl.pathname === '/api/whatsapp/send-template' && request.method === 'POST') {
      sendJson(response, 410, { error: 'Envios diretos foram substituídos pela fila de prospecção com limite diário.' })
      return
    }

    if (requestUrl.pathname === '/api/openbot/outreach' && request.method === 'POST') {
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch {
        sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
        return
      }

      const input = parseOpenBotOutreachStartInput(body)
      if (!input) {
        sendJson(response, 400, { error: 'Revise o agente e os dados da abordagem antes de continuar.' })
        return
      }

      const rateLimit = checkRateLimit({ key: `openbot-outreach:${user.id}`, limit: 8, windowMs: 60_000 })
      if (!rateLimit.allowed) {
        response.setHeader('Retry-After', String(rateLimit.retryAfterSeconds))
        sendJson(response, 429, { error: 'Aguarde um instante antes de pedir outro rascunho ao OpenBot.' })
        return
      }

      try {
        const delivery = await sendOpenBotAgentMessage(
          input.agentId,
          buildOpenBotOutreachPrompt(input.input),
          input.clientMessageId,
        )
        sendJson(response, 202, { data: { ...delivery, status: 'queued' } })
      } catch (error) {
        if (error instanceof OpenBotAutomationError) {
          sendJson(response, error.status, { error: error.message })
          return
        }
        throw error
      }
      return
    }

    const openBotDeliveryMatch = requestUrl.pathname.match(/^\/api\/openbot\/agents\/([^/]+)\/deliveries\/([^/]+)$/)
    if (openBotDeliveryMatch && request.method === 'POST') {
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch {
        sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
        return
      }

      const input = parseOpenBotOutreachPollInput(body)
      if (!input) {
        sendJson(response, 400, { error: 'Os dados de contexto da abordagem são inválidos.' })
        return
      }

      let agentId: string
      let deliveryId: string
      try {
        agentId = decodeURIComponent(openBotDeliveryMatch[1])
        deliveryId = decodeURIComponent(openBotDeliveryMatch[2])
      } catch {
        sendJson(response, 400, { error: 'O identificador da tarefa do OpenBot é inválido.' })
        return
      }

      try {
        const delivery = await getOpenBotDelivery(agentId, deliveryId)
        if (delivery.status === 'failed' || delivery.status === 'interrupted' || delivery.status === 'cancelled') {
          sendJson(response, 502, { error: 'O agente não concluiu o rascunho. Confira o estado da tarefa no OpenBot.' })
          return
        }
        if (delivery.status !== 'completed') {
          sendJson(response, 202, { data: { status: delivery.status } })
          return
        }

        sendJson(response, 200, {
          data: { status: 'completed', result: validateOpenBotOutreachAnswer(delivery.answer, input) },
        })
      } catch (error) {
        if (error instanceof OpenBotAutomationError || error instanceof OpenBotOutreachResponseError) {
          sendJson(response, error.status, { error: error.message })
          return
        }
        throw error
      }
      return
    }

    if (requestUrl.pathname === '/api/ai/outreach' && request.method === 'POST') {
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch {
        sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
        return
      }

      const input = parseGenerateOutreachInput(body)
      if (!input) {
        sendJson(response, 400, { error: 'Revise os dados da abordagem e tente novamente.' })
        return
      }

      const apiKey = getGeminiApiKey()
      if (!apiKey) {
        sendJson(response, 503, { error: 'A IA ainda não está configurada.' })
        return
      }

      try {
        sendJson(response, 200, { data: await generateLeadOutreach(apiKey, input) })
      } catch (error) {
        if (error instanceof GeminiOutreachError) {
          sendJson(response, error.status, { error: error.message })
          return
        }
        throw error
      }
      return
    }

    if (requestUrl.pathname === '/api/site-health' && request.method === 'POST') {
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch {
        sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
        return
      }

      const siteUrl = isRecord(body) && typeof body.url === 'string' ? body.url.trim() : ''
      if (!siteUrl || siteUrl.length > 2_000) {
        sendJson(response, 400, { error: 'Informe um endereço de site válido.' })
        return
      }

      const rateLimit = checkRateLimit({ key: `site-health:${user.id}`, limit: 30, windowMs: 60_000 })
      if (!rateLimit.allowed) {
        response.setHeader('Retry-After', String(rateLimit.retryAfterSeconds))
        sendJson(response, 429, { error: 'Aguarde um instante antes de verificar mais sites.' })
        return
      }

      sendJson(response, 200, { data: await checkSiteHealth(siteUrl) })
      return
    }

    if (saveMatch && (request.method === 'POST' || request.method === 'DELETE')) {
      if (request.method === 'POST') {
        let body: unknown
        try {
          body = await readJsonBody(request)
        } catch {
          sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
          return
        }

        const snapshot = isRecord(body) ? parseLeadSnapshot(body.lead, saveMatch[1]) : undefined
        if (isRecord(body) && body.lead !== undefined && !snapshot) {
          sendJson(response, 400, { error: 'Os dados do lead salvos são inválidos.' })
          return
        }

        const savedLead = await persistenceStore.saveLeadState(accessToken, user.id, saveMatch[1], snapshot)
        sendJson(response, 200, { data: savedLead })
        return
      }

      await persistenceStore.removeSavedLead(accessToken, user.id, saveMatch[1])
      sendJson(response, 204, null)
      return
    }

    if (interactionMatch && request.method === 'POST') {
      let body: unknown

      try {
        body = await readJsonBody(request)
      } catch {
        sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
        return
      }

      const input = parseLeadInteractionInput(body)
      if (!input) {
        sendJson(response, 400, { error: 'Informe canal, data e observação da interação.' })
        return
      }

      sendJson(response, 201, {
        data: await persistenceStore.createLeadInteraction(
          accessToken,
          user.id,
          interactionMatch[1],
          input,
        ),
      })
      return
    }

    if (updateMatch && request.method === 'PATCH') {
      let body: unknown

      try {
        body = await readJsonBody(request)
      } catch {
        sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
        return
      }

      if (!isRecord(body)) {
        sendJson(response, 400, { error: 'O corpo da requisição é inválido.' })
        return
      }

      if (body.status !== undefined && !leadStatuses.includes(body.status as LeadStatus)) {
        sendJson(response, 400, { error: 'Status de lead inválido.' })
        return
      }

      for (const key of ['conversationStage', 'contactName', 'nextAction'] as const) {
        if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 500)) {
          sendJson(response, 400, { error: 'Dados de acompanhamento inválidos.' })
          return
        }
      }
      const changes: Partial<LeadUpdate> = {}
      for (const key of ['conversationStage', 'contactName', 'nextAction'] as const) {
        if (typeof body[key] === 'string') changes[key] = body[key].trim()
      }
      if (body.status !== undefined) changes.status = body.status as LeadStatus
      if (body.notes !== undefined) changes.notes = typeof body.notes === 'string' ? body.notes : ''
      if (body.nextFollowUp !== undefined)
        changes.nextFollowUp = typeof body.nextFollowUp === 'string' && body.nextFollowUp
          ? body.nextFollowUp
          : ''
      if (body.draftMessage !== undefined)
        changes.draftMessage = typeof body.draftMessage === 'string' ? body.draftMessage : ''

      if (['whatsappConsentStatus', 'whatsappConsentSource', 'whatsappConsentAt'].some((key) => body[key] !== undefined)) {
        const consentChanges = parseWhatsAppConsentChanges(body)
        if (!consentChanges) {
          sendJson(response, 400, { error: 'Para registrar autorização, informe a origem e uma data válida. Marque apenas consentimento explícito.' })
          return
        }
        Object.assign(changes, consentChanges)
      }

      const updatedLead = await persistenceStore.saveLeadState(
        accessToken,
        user.id,
        updateMatch[1],
        undefined,
        changes,
      )

      sendJson(response, 200, { data: updatedLead })
      return
    }

    if (salesMatch && request.method === 'POST') {
      let body: unknown

      try {
        body = await readJsonBody(request)
      } catch {
        sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
        return
      }

      const input = parseSaleInput(body)
      if (!input) {
        sendJson(response, 400, { error: 'Informe comércio, serviço, valor e data da venda.' })
        return
      }

      sendJson(response, 201, {
        data: await persistenceStore.createSale(accessToken, user.id, input),
      })
      return
    }

    if (saleMatch && request.method === 'PATCH') {
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch {
        sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
        return
      }

      const input = parseUpdateSaleInput(body)
      if (!input) {
        sendJson(response, 400, { error: 'Informe comércio, serviço, valor e data da venda.' })
        return
      }

      const sale = await persistenceStore.updateSale(
        accessToken,
        user.id,
        decodeURIComponent(saleMatch[1]),
        input,
      )
      if (!sale) {
        sendJson(response, 404, { error: 'Venda não encontrada.' })
        return
      }
      sendJson(response, 200, { data: sale })
      return
    }

    if (saleMatch && request.method === 'DELETE') {
      const deleted = await persistenceStore.deleteSale(
        accessToken,
        user.id,
        decodeURIComponent(saleMatch[1]),
      )
      if (!deleted) {
        sendJson(response, 404, { error: 'Venda não encontrada.' })
        return
      }
      sendJson(response, 204, null)
      return
    }

    sendJson(response, 405, { error: 'Método não permitido.' })
    return
  }

  if (requestUrl.pathname === '/api/saved-lead-ids') {
    sendJson(response, 200, {
      data: await persistenceStore.listSavedLeadStates(accessToken, user.id),
    })
    return
  }

  if (requestUrl.pathname === '/api/saved-leads') {
    sendJson(response, 200, {
      data: await persistenceStore.listSavedLeadStates(accessToken, user.id),
    })
    return
  }

  const savedLeadDetailMatch = requestUrl.pathname.match(/^\/api\/saved-leads\/([^/]+)$/)
  if (savedLeadDetailMatch) {
    const savedState = await persistenceStore.getSavedLeadState(accessToken, user.id, savedLeadDetailMatch[1])
    if (!savedState) {
      sendJson(response, 404, { error: 'Este lead não está salvo na sua conta.' })
      return
    }

    if (savedState.lead) {
      sendJson(response, 200, {
        data: mergeSavedLeadState({ ...savedState.lead, status: savedState.status }, savedState),
      })
      return
    }

    try {
      const lead = await trackedLeadProvider.findById(savedState.leadId)
      if (!lead) {
        sendJson(response, 404, { error: 'Não foi possível encontrar este negócio no Google agora.' })
        return
      }

      await persistenceStore.refreshSavedLeadSnapshot(accessToken, user.id, lead)

      sendJson(response, 200, { data: mergeSavedLeadState(lead, savedState) })
    } catch (error) {
      sendJson(response, isGoogleApiMonthlyLimitError(error) ? 429 : 503, {
        error: error instanceof Error ? error.message : 'Não foi possível atualizar os dados deste negócio agora.',
      })
    }
    return
  }

  if (requestUrl.pathname === '/api/sales') {
    sendJson(response, 200, { data: await persistenceStore.listSales(accessToken, user.id) })
    return
  }

  if (requestUrl.pathname === '/api/google-api-usage') {
    sendJson(response, 200, { data: await persistenceStore.getGoogleApiUsage(accessToken) })
    return
  }

  if (requestUrl.pathname === '/api/leads') {
    const { opportunity, ...query } = getSearchParams(request)

    if (!query.city) {
      sendJson(response, 400, { error: 'O parâmetro city é obrigatório.' })
      return
    }

    if (
      query.city.length > 120 ||
      (query.segment && query.segment.length > 120) ||
      (query.pageToken && query.pageToken.length > 24_000)
    ) {
      sendJson(response, 400, { error: 'A localização e o segmento precisam ser mais curtos.' })
      return
    }

    if (opportunity && !opportunityTypes.includes(opportunity as OpportunityType)) {
      sendJson(response, 400, { error: 'O filtro de oportunidade é inválido.' })
      return
    }

    try {
      const payload = await executeSearchLeads(trackedLeadProvider, {
        ...query,
        ...(opportunity ? { opportunity: opportunity as OpportunityType } : {}),
      })
      logInfo('lead_search_completed', {
        requestId: createRequestId(
          typeof request.headers['cf-ray'] === 'string'
            ? request.headers['cf-ray']
            : typeof request.headers['x-request-id'] === 'string'
              ? request.headers['x-request-id']
              : undefined,
        ),
        resultCount: payload.data.length,
      })
      sendJson(response, 200, payload)
    } catch (error) {
      logError('lead_search_failed', error, {
        requestId: createRequestId(
          typeof request.headers['cf-ray'] === 'string'
            ? request.headers['cf-ray']
            : typeof request.headers['x-request-id'] === 'string'
              ? request.headers['x-request-id']
              : undefined,
        ),
      })
      sendJson(response, isGoogleApiMonthlyLimitError(error) ? 429 : 503, {
        error: error instanceof Error ? error.message : 'Não foi possível consultar os negócios agora.',
      })
    }
    return
  }

  sendJson(response, 404, { error: 'Rota não encontrada.' })
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => sendRequestError(response, error))
})

server.listen(port, host, () => {
  logInfo('api_started', { port, host })
})

const whatsappScheduler = startLocalWhatsAppProspectingScheduler()
if (whatsappScheduler) {
  logInfo('whatsapp_local_scheduler_started', { intervalSeconds: 30 })
}
