import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import dotenv from 'dotenv'
import { executeSearchLeads } from '../application/searchLeads.js'
import { GooglePlacesProvider } from '../integrations/googlePlacesProvider.js'
import { isGoogleApiMonthlyLimitError } from '../application/googleApiUsageLimit.js'
import { leadStatuses, opportunityTypes, parseBulkLeadDeleteInput, parseBulkLeadStatusUpdateInput, parseLeadSnapshot, parseWhatsAppConsentChanges, type Lead, type LeadStatus, type LeadUpdate, type OpportunityType } from '../contracts/lead.js'
import type { CreateSaleInput, UpdateSaleInput } from '../contracts/sale.js'
import { interactionChannels, type CreateLeadInteractionInput } from '../contracts/interaction.js'
import { authenticateRequest, buildWhatsAppAgentProviderConfig, configureRuntimeEnvironment, getConfiguredWhatsAppOpenBotAgentId, getEvolutionApiConfig, getGeminiApiKey, getOpenClawBridgeConfig, getOpenClawGatewayHookConfig, getOpenClawMcpConfig, getWhatsAppAgentProviderConfig, getWhatsAppAgentProvidersStatus, getWhatsAppEvolutionSetupStatus, getWhatsAppOpenBotBridgeConfig, isOpenClawGatewayReady, isWhatsAppAutomationRuntimeEnabled, isWhatsAppDigiBuscaAgentRuntimeEnabled, isWhatsAppIntegrationEnabled, isWhatsAppOpenBotReplyRuntimeEnabled, isWhatsAppOpenClawRuntimeEnabled, isWhatsAppOpenClawProspectingRuntimeEnabled, isWhatsAppProspectingRuntimeEnabled, isWhatsAppWebhookPersistenceConfigured, openClawBridgeAuthorizationMatches, openClawMcpAuthorizationMatches } from '../config/supabase.js'
import { SupabaseStore, WhatsAppConsentSchemaMissingError } from '../data/supabaseStore.js'
import { listCities, listCountries, listStates } from '../integrations/locationCatalog.js'
import { parseGenerateOutreachInput } from '../contracts/aiOutreach.js'
import { GeminiOutreachError } from '../integrations/geminiOutreachProvider.js'
import { generateLeadOutreach } from '../application/generateLeadOutreach.js'
import { checkRateLimit } from './rateLimit.js'
import { createRequestId, logError, logInfo, logWarning } from '../observability/logger.js'
import { checkSiteHealth } from '../integrations/siteHealth.js'
import { buildOpenBotOutreachPrompt, OpenBotOutreachResponseError, validateOpenBotOutreachAnswer } from '../application/generateOpenBotOutreach.js'
import { getOpenBotDelivery, listOpenBotAgents, OpenBotAutomationError, sendOpenBotAgentMessage } from '../integrations/openbotAutomationApi.js'
import { getOpenBotWhatsAppAgentStatus, OpenBotWhatsAppBridgeError } from '../integrations/openBotWhatsAppBridge.js'
import { getWhatsAppConnections, getEvolutionPairingStatus, startEvolutionConnection } from '../application/evolutionConnections.js'
import { persistEvolutionWebhook } from '../application/evolutionWebhook.js'
import { processWhatsAppAutomation } from '../application/processWhatsAppAutomation.js'
import { evolutionWebhookSecretMatches, EvolutionApiError } from '../integrations/evolutionApi.js'
import { whatsappWebhookMaxBodyBytes, WhatsAppWebhookBodyTooLargeError } from '../application/whatsappWebhook.js'
import { isUuid, parseWhatsAppPageOptions } from '../contracts/whatsapp.js'
import { parseWhatsAppAutomationProfileInput, whatsappAgentProviders } from '../contracts/whatsappAutomation.js'
import { WhatsAppStore } from '../data/whatsappStore.js'
import { invalidateWhatsAppAgentModelCache, listWhatsAppAgentModels, listWhatsAppAgentModelsForConfig, WhatsAppAgentModelCatalogError } from '../integrations/whatsappAgentModels.js'
import { getDefaultWhatsAppAgentModel, getWhatsAppAgentProviderConfigForUser, getWhatsAppAgentProvidersStateForUser } from '../integrations/whatsappAgentProviderConfig.js'
import { disableWhatsAppAiProviderCredential, saveWhatsAppAiProviderCredential, WhatsAppAiProviderCredentialStorageError } from '../data/whatsappAiProviderCredentials.js'
import { WhatsAppProspectingError, WhatsAppProspectingStore } from '../data/whatsappProspectingStore.js'
import { runLocalWhatsAppProspectingTick, startLocalWhatsAppProspectingScheduler } from '../application/processLocalWhatsAppProspecting.js'
import { runWhatsAppDailyProspectingCampaign } from '../application/runWhatsAppDailyProspectingCampaign.js'
import { authorizeOpenClawOutbound, OpenClawBridgeError, persistOpenClawInbound, persistOpenClawOutbound } from '../application/openClawWhatsAppBridge.js'
import { handleOpenClawMcpRequest } from '../integrations/openclawMcp.js'

dotenv.config({ path: process.env.DIGIBUSCA_ENV_FILE ?? 'backend/.env' })
dotenv.config({ path: 'frontend/.env' })
configureRuntimeEnvironment(process.env)

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST?.trim() || '127.0.0.1'
const leadProvider = new GooglePlacesProvider()
const persistenceStore = new SupabaseStore()
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

function parseWhatsAppAiProviderInput(value: unknown) {
  if (!isRecord(value) || !whatsappAgentProviders.includes(value.provider as typeof whatsappAgentProviders[number])) return undefined
  const provider = value.provider as typeof whatsappAgentProviders[number]
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : ''
  const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim() : undefined
  if (apiKey.length < 8 || apiKey.length > 4_096) return undefined
  if (provider === 'openai-compatible' && (!baseUrl || baseUrl.length > 512)) return undefined
  if (provider !== 'openai-compatible' && baseUrl) return undefined
  const config = buildWhatsAppAgentProviderConfig(provider, getDefaultWhatsAppAgentModel(provider), apiKey, baseUrl)
  return config ? { provider, apiKey, baseUrl, config } : undefined
}

function isWhatsAppIntegrationPath(pathname: string) {
  return pathname === '/api/whatsapp' || pathname.startsWith('/api/whatsapp/') || pathname === '/api/webhooks/evolution' || pathname.startsWith('/api/openclaw/')
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

const bulkLeadBodyLimitBytes = 64 * 1024

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('O corpo da requisição excede o limite de 64 KiB.')
    this.name = 'RequestBodyTooLargeError'
  }
}

function readLimitedJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const contentLength = request.headers['content-length']
  if (typeof contentLength === 'string' && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    request.resume()
    return Promise.reject(new RequestBodyTooLargeError())
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let tooLarge = false

    request.on('data', (chunk: Buffer | string) => {
      if (tooLarge) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
      if (totalBytes + buffer.byteLength > maxBytes) {
        tooLarge = true
        chunks.length = 0
        reject(new RequestBodyTooLargeError())
        return
      }
      totalBytes += buffer.byteLength
      chunks.push(buffer)
    })
    request.on('end', () => {
      if (tooLarge) return
      const body = Buffer.concat(chunks, totalBytes).toString('utf8')
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
    request.on('error', (error) => {
      if (!tooLarge) reject(error)
    })
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

  if (requestUrl.pathname === '/mcp') {
    response.setHeader('Cache-Control', 'no-store')
    if (!getOpenClawMcpConfig()) {
      sendJson(response, 503, { error: 'O servidor MCP do Cristhian ainda não está configurado.' })
      return
    }
    if (!openClawMcpAuthorizationMatches(typeof request.headers.authorization === 'string' ? request.headers.authorization : undefined)) {
      sendJson(response, 401, { error: 'A credencial MCP do OpenClaw é inválida.' })
      return
    }
    await handleOpenClawMcpRequest(request, response)
    return
  }

  if (requestUrl.pathname === '/api/openclaw/inbound' || requestUrl.pathname === '/api/openclaw/outbound' || requestUrl.pathname === '/api/openclaw/authorize-outbound') {
    response.setHeader('Cache-Control', 'no-store')
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'A ponte OpenClaw aceita somente POST.' })
      return
    }
    if (!isWhatsAppOpenClawRuntimeEnabled()) {
      sendJson(response, 503, { error: 'O runtime OpenClaw do WhatsApp está desativado.' })
      return
    }
    const suppliedToken = request.headers['x-digibusca-openclaw-token']
    if (!openClawBridgeAuthorizationMatches(typeof suppliedToken === 'string' ? suppliedToken : undefined)) {
      sendJson(response, 401, { error: 'A credencial da ponte OpenClaw é inválida.' })
      return
    }
    let body: unknown
    try {
      body = await readLimitedJsonBody(request, 16 * 1024)
    } catch (error) {
      sendJson(response, error instanceof RequestBodyTooLargeError ? 413 : 400, { error: 'Revise os dados da mensagem e tente novamente.' })
      return
    }
    if (!isRecord(body)) {
      sendJson(response, 400, { error: 'O corpo da mensagem precisa ser um objeto JSON.' })
      return
    }
    try {
      if (requestUrl.pathname === '/api/openclaw/inbound') {
        if (
          typeof body.phoneNumberId !== 'string' || typeof body.senderE164 !== 'string' ||
          typeof body.providerMessageId !== 'string' || typeof body.occurredAt !== 'string' ||
          (body.openClawRunId !== undefined && typeof body.openClawRunId !== 'string') ||
          (body.openClawSessionKey !== undefined && typeof body.openClawSessionKey !== 'string') ||
          (body.contactName !== undefined && typeof body.contactName !== 'string') ||
          (body.content !== undefined && typeof body.content !== 'string') ||
          (body.messageType !== undefined && typeof body.messageType !== 'string')
        ) {
          sendJson(response, 400, { error: 'A mensagem recebida tem campos inválidos.' })
          return
        }
        const result = await persistOpenClawInbound({
          phoneNumberId: body.phoneNumberId,
          senderE164: body.senderE164,
          providerMessageId: body.providerMessageId,
          occurredAt: body.occurredAt,
          ...(typeof body.openClawRunId === 'string' ? { openClawRunId: body.openClawRunId } : {}),
          ...(typeof body.openClawSessionKey === 'string' ? { openClawSessionKey: body.openClawSessionKey } : {}),
          ...(typeof body.contactName === 'string' ? { contactName: body.contactName } : {}),
          ...(typeof body.content === 'string' ? { content: body.content } : {}),
          ...(typeof body.messageType === 'string' ? { messageType: body.messageType } : {}),
        })
        sendJson(response, 200, result)
      } else if (requestUrl.pathname === '/api/openclaw/authorize-outbound') {
        if (
          typeof body.phoneNumberId !== 'string' || typeof body.recipientE164 !== 'string' || typeof body.content !== 'string' ||
          (body.openClawRunId !== undefined && typeof body.openClawRunId !== 'string') ||
          (body.openClawSessionKey !== undefined && typeof body.openClawSessionKey !== 'string')
        ) {
          sendJson(response, 400, { error: 'A mensagem de saída tem campos inválidos.' })
          return
        }
        const result = await authorizeOpenClawOutbound({
          phoneNumberId: body.phoneNumberId,
          recipientE164: body.recipientE164,
          content: body.content,
          ...(typeof body.openClawRunId === 'string' ? { openClawRunId: body.openClawRunId } : {}),
          ...(typeof body.openClawSessionKey === 'string' ? { openClawSessionKey: body.openClawSessionKey } : {}),
        })
        sendJson(response, 200, result)
      } else {
        if (
          typeof body.phoneNumberId !== 'string' || typeof body.recipientE164 !== 'string' ||
          typeof body.providerMessageId !== 'string' || typeof body.occurredAt !== 'string' || typeof body.success !== 'boolean' ||
          (body.openClawRunId !== undefined && typeof body.openClawRunId !== 'string') ||
          (body.openClawSessionKey !== undefined && typeof body.openClawSessionKey !== 'string') ||
          (body.content !== undefined && typeof body.content !== 'string') ||
          (body.messageType !== undefined && typeof body.messageType !== 'string')
        ) {
          sendJson(response, 400, { error: 'A mensagem enviada tem campos inválidos.' })
          return
        }
        const result = await persistOpenClawOutbound({
          phoneNumberId: body.phoneNumberId,
          recipientE164: body.recipientE164,
          providerMessageId: body.providerMessageId,
          occurredAt: body.occurredAt,
          success: body.success,
          ...(typeof body.openClawRunId === 'string' ? { openClawRunId: body.openClawRunId } : {}),
          ...(typeof body.openClawSessionKey === 'string' ? { openClawSessionKey: body.openClawSessionKey } : {}),
          ...(typeof body.content === 'string' ? { content: body.content } : {}),
          ...(typeof body.messageType === 'string' ? { messageType: body.messageType } : {}),
        })
        sendJson(response, 200, result)
      }
    } catch (error) {
      if (error instanceof OpenClawBridgeError) {
        sendJson(response, error.status, { error: error.message })
        return
      }
      logWarning('openclaw_whatsapp_bridge_failed', { reason: 'message_persistence_unavailable' })
      sendJson(response, 503, { error: 'Não foi possível registrar a mensagem no histórico do DigiBusca.' })
    }
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
      const persistedWebhook = await persistEvolutionWebhook(body)
      sendJson(response, 200, { received: true })
      if (persistedWebhook?.shouldProcessInboundNow) {
        setImmediate(() => {
          void processWhatsAppAutomation(persistedWebhook.events, { stopRequestsAlreadyPersisted: true }).catch(() => {
            logWarning('whatsapp_webhook_followup_failed', { reason: 'inbound_processing_unavailable' })
          })
        })
      }
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
      const [settings, dailyCount, queue, campaign] = await Promise.all([
        prospectingStore.getSettings(user.id),
        prospectingStore.getDailyCount(user.id),
        prospectingStore.listQueue(user.id),
        prospectingStore.getOrCreateDailyCampaign(user.id),
      ])
      const openClawConfig = getOpenClawMcpConfig()
      const openClawStorageReady = openClawConfig?.ownerUserId === user.id
        ? await new WhatsAppStore().isOpenClawStorageReady().catch(() => false)
        : false
      const openClawConnectionPlatform = openClawConfig?.ownerUserId === user.id
        ? await new WhatsAppStore().getConnectionPlatformType(user.id, openClawConfig.phoneNumberId).catch(() => undefined)
        : undefined
      const openClawGatewayReady = await isOpenClawGatewayReady()
      response.setHeader('Cache-Control', 'no-store')
      sendJson(response, 200, {
        data: {
          settings,
          dailyCount,
          queue,
          campaign,
          localRuntimeEnabled: isWhatsAppProspectingRuntimeEnabled(),
          evolutionConfigured: Boolean(getEvolutionApiConfig()),
          openClawProspectingDispatcherReady: isWhatsAppOpenClawProspectingRuntimeEnabled() && openClawStorageReady && openClawGatewayReady && openClawConnectionPlatform === 'OPENCLAW_WEB',
        },
      })
    } catch {
      sendJson(response, 503, { error: 'Aplique as migrations 013, 020 e 022 do WhatsApp no Supabase para habilitar a fila, o chat diário e a integração OpenClaw.' })
    }
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/whatsapp/prospecting/campaign') {
    let body: unknown
    try {
      body = await readJsonBody(request)
    } catch {
      sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
      return
    }
    if (
      !isRecord(body) || typeof body.city !== 'string' || body.city.trim().length < 2 || body.city.trim().length > 120 ||
      (body.segment !== undefined && (typeof body.segment !== 'string' || body.segment.trim().length > 120)) ||
      (body.phoneNumberId !== undefined && (typeof body.phoneNumberId !== 'string' || !/^[-_a-zA-Z0-9]{1,128}$/.test(body.phoneNumberId)))
    ) {
      sendJson(response, 400, { error: 'Informe uma cidade válida e, se quiser, um segmento de até 120 caracteres.' })
      return
    }
    const rateLimit = checkRateLimit({ key: `whatsapp-daily-campaign:${user.id}`, limit: 3, windowMs: 60_000 })
    if (!rateLimit.allowed) {
      sendJson(response, 429, { error: 'Aguarde um instante antes de iniciar outra busca.' })
      return
    }
    const city = body.city.trim()
    const segment = typeof body.segment === 'string' && body.segment.trim() ? body.segment.trim() : 'Todos os segmentos'
    const phoneNumberId = typeof body.phoneNumberId === 'string' ? body.phoneNumberId : undefined
    const prospectingStore = new WhatsAppProspectingStore()
    let campaign
    try {
      campaign = await prospectingStore.beginDailyCampaign(user.id, city, segment)
    } catch (error) {
      if (error instanceof WhatsAppProspectingError) {
        sendJson(response, error.status, { error: error.message })
        return
      }
      sendJson(response, 503, { error: 'Não foi possível iniciar o chat diário. Confira se a migration 020 está aplicada no Supabase.' })
      return
    }

    let connections: Awaited<ReturnType<typeof getWhatsAppConnections>> = []
    if (phoneNumberId) {
      try {
        connections = await getWhatsAppConnections(user.id)
      } catch {
        connections = []
      }
    }
    const openClawConfig = getOpenClawMcpConfig()
    const selectedConnection = connections.find((connection) => (
      connection.phoneNumberId === phoneNumberId && (
        connection.connectionState?.toLowerCase() === 'open' ||
        (connection.platformType === 'OPENCLAW_WEB' && connection.connectionState?.toLowerCase() === 'registered' && connection.phoneNumberId === openClawConfig?.phoneNumberId)
      )
    ))
    const selectedConnectionPlatformType = selectedConnection?.platformType === 'EVOLUTION_API' || selectedConnection?.platformType === 'OPENCLAW_WEB'
      ? selectedConnection.platformType
      : undefined
    let queueSendingAvailable = Boolean(
      phoneNumberId && selectedConnection?.platformType === 'EVOLUTION_API' &&
      isWhatsAppProspectingRuntimeEnabled() && getEvolutionApiConfig(),
    )
    if (phoneNumberId && selectedConnection?.platformType === 'OPENCLAW_WEB') {
      const bridgeReady = Boolean(openClawConfig && openClawConfig.ownerUserId === user.id && getOpenClawBridgeConfig())
      const storageReady = await new WhatsAppStore().isOpenClawStorageReady().catch(() => false)
      const hookReady = Boolean(getOpenClawGatewayHookConfig())
      const gatewayReady = await isOpenClawGatewayReady()
      queueSendingAvailable = Boolean(isWhatsAppOpenClawProspectingRuntimeEnabled() && bridgeReady && storageReady && hookReady && gatewayReady)
    }
    try {
      const result = await runWhatsAppDailyProspectingCampaign({
        userId: user.id,
        accessToken,
        city,
        segment,
        ...(phoneNumberId ? { phoneNumberId } : {}),
        ...(selectedConnectionPlatformType ? { queuePlatformType: selectedConnectionPlatformType } : {}),
        queueSendingAvailable,
        campaign,
        provider: new GooglePlacesProvider(
          undefined,
          (requestType) => persistenceStore.reserveGoogleApiRequest(accessToken, requestType),
        ),
        persistenceStore,
        prospectingStore,
      })
      sendJson(response, 200, { data: result })
      if (result.queuedCount > 0) {
        setImmediate(() => {
          void runLocalWhatsAppProspectingTick().catch(() => {
            logWarning('whatsapp_campaign_dispatch_failed', { reason: 'queue_dispatch_unavailable' })
          })
        })
      }
    } catch (error) {
      sendJson(response, isGoogleApiMonthlyLimitError(error) ? 429 : 503, {
        error: error instanceof Error ? error.message : 'Não foi possível concluir a busca de hoje.',
      })
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
    if (body.enabled) {
      let connections: Awaited<ReturnType<typeof getWhatsAppConnections>>
      try {
        connections = await getWhatsAppConnections(user.id)
      } catch {
        sendJson(response, 503, { error: 'Não foi possível verificar as conexões do WhatsApp.' })
        return
      }
      const evolutionReady = isWhatsAppProspectingRuntimeEnabled() && Boolean(getEvolutionApiConfig()) &&
        connections.some((connection) => connection.platformType === 'EVOLUTION_API' && connection.connectionState?.toLowerCase() === 'open')
      const openClawConfig = getOpenClawMcpConfig()
      const openClawStorageReady = openClawConfig?.ownerUserId === user.id
        ? await new WhatsAppStore().isOpenClawStorageReady().catch(() => false)
        : false
      const openClawGatewayReady = await isOpenClawGatewayReady()
      const openClawReady = isWhatsAppOpenClawProspectingRuntimeEnabled() &&
        openClawConfig?.ownerUserId === user.id && openClawStorageReady && openClawGatewayReady &&
        connections.some((connection) => connection.phoneNumberId === openClawConfig.phoneNumberId && connection.platformType === 'OPENCLAW_WEB' && connection.connectionState?.toLowerCase() === 'registered')
      if (!evolutionReady && !openClawReady) {
        sendJson(response, 503, { error: 'Para ativar a fila, conecte a Evolution com runtime ativo ou configure o Cristhian OpenClaw, o webhook privado e o pareamento registrado.' })
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
      (body.message !== undefined && (typeof body.message !== 'string' || !body.message.trim() || body.message.trim().length > 1_024))
    ) {
      sendJson(response, 400, { error: 'Informe o número conectado e o lead salvo. A mensagem inicial será preparada pelo DigiBusca.' })
      return
    }
    try {
      const prospectingStore = new WhatsAppProspectingStore()
      const settings = await prospectingStore.getSettings(user.id)
      if (!settings.enabled) {
        sendJson(response, 409, { error: 'Ative a fila automática antes de adicionar contatos para envio.' })
        return
      }
      const platformType = await new WhatsAppStore().getConnectionPlatformType(user.id, body.phoneNumberId)
      if (platformType !== 'EVOLUTION_API' && platformType !== 'OPENCLAW_WEB') {
        sendJson(response, 409, { error: 'O número selecionado não tem um transporte WhatsApp registrado.' })
        return
      }
      if (platformType === 'EVOLUTION_API' && (!isWhatsAppProspectingRuntimeEnabled() || !getEvolutionApiConfig())) {
        sendJson(response, 503, { error: 'O runtime de prospecção da Evolution não está configurado.' })
        return
      }
      if (platformType === 'OPENCLAW_WEB') {
        const config = getOpenClawMcpConfig()
        const storageReady = config?.ownerUserId === user.id
          ? await new WhatsAppStore().isOpenClawStorageReady().catch(() => false)
          : false
        const gatewayReady = await isOpenClawGatewayReady()
        if (!isWhatsAppOpenClawProspectingRuntimeEnabled() || config?.ownerUserId !== user.id || config.phoneNumberId !== body.phoneNumberId || !storageReady || !gatewayReady) {
          sendJson(response, 503, { error: 'O dispatcher OpenClaw ainda não está pronto para esse número. Confira o Gateway, o webhook privado, o registro do pareamento e a migration 022.' })
          return
        }
      }
      const data = await prospectingStore.enqueueNewLead(
        user.id,
        body.phoneNumberId,
        body.leadId.trim(),
        typeof body.message === 'string' ? body.message : undefined,
        platformType,
      )
      sendJson(response, 201, { data })
      setImmediate(() => {
        void runLocalWhatsAppProspectingTick().catch(() => {
          logWarning('whatsapp_manual_queue_dispatch_failed', { reason: 'queue_dispatch_unavailable' })
        })
      })
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
    sendJson(response, 200, { data: await getWhatsAppConnections(user.id) })
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

  if (request.method === 'POST' && requestUrl.pathname === '/api/whatsapp/connections/openclaw') {
    const config = getOpenClawMcpConfig()
    if (!config || !getOpenClawBridgeConfig() || config.ownerUserId !== user.id) {
      sendJson(response, 503, { error: 'Configure a conexão privada do OpenClaw no backend antes de registrar o pareamento.' })
      return
    }
    try {
      await new WhatsAppStore().saveOpenClawConnection(user.id, config.phoneNumberId)
      response.setHeader('Cache-Control', 'no-store')
      sendJson(response, 201, { data: { phoneNumberId: config.phoneNumberId, platformType: 'OPENCLAW_WEB', connectionState: 'registered' } })
    } catch (error) {
      sendJson(response, error instanceof Error && error.message.includes('pendentes da fila Evolution') ? 409 : 503, {
        error: error instanceof Error ? error.message : 'Não foi possível registrar a conexão do OpenClaw.',
      })
    }
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/whatsapp/conversations/pending-count') {
    response.setHeader('Cache-Control', 'no-store')
    const count = await new WhatsAppStore().countHumanPendingConversations(accessToken, user.id)
    sendJson(response, 200, { data: count })
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/whatsapp/conversations/pending') {
    response.setHeader('Cache-Control', 'no-store')
    const data = await new WhatsAppStore().listHumanPendingConversations(accessToken, user.id)
    sendJson(response, 200, { data })
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

  if (request.method === 'POST' && requestUrl.pathname === '/api/whatsapp/agent-providers') {
    const rateLimit = checkRateLimit({ key: `whatsapp-agent-provider-connect:${user.id}`, limit: 5, windowMs: 60_000 })
    if (!rateLimit.allowed) {
      sendJson(response, 429, { error: 'Aguarde um instante antes de testar outra conexão de IA.' })
      return
    }
    let body: unknown
    try {
      body = await readLimitedJsonBody(request, 16 * 1024)
    } catch (error) {
      sendJson(response, error instanceof RequestBodyTooLargeError ? 413 : 400, { error: 'Revise os dados da conexão e tente novamente.' })
      return
    }
    const input = parseWhatsAppAiProviderInput(body)
    if (!input) {
      sendJson(response, 400, { error: 'Informe uma chave válida e, para APIs compatíveis com OpenAI, uma URL HTTPS válida.' })
      return
    }
    let automationPaused = false
    try {
      const models = await listWhatsAppAgentModelsForConfig(input.provider, input.config)
      automationPaused = (await new WhatsAppStore().pauseDigiBuscaAutomationForProviderChange(user.id, input.provider)) > 0
      await saveWhatsAppAiProviderCredential({
        userId: user.id,
        provider: input.provider,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
      })
      invalidateWhatsAppAgentModelCache(input.provider, user.id)
      response.setHeader('Cache-Control', 'private, no-store')
      sendJson(response, 200, { data: { provider: input.provider, configured: true, models } })
    } catch (error) {
      response.setHeader('Cache-Control', 'private, no-store')
      if (error instanceof WhatsAppAiProviderCredentialStorageError) {
        const message = error.reason === 'migration_missing'
          ? 'Aplique a migration 021_whatsapp_ai_provider_connections.sql no Supabase para habilitar conexões pelo painel.'
          : 'Não foi possível guardar a conexão protegida no Supabase.'
        sendJson(response, 503, { error: message, automationPaused })
        return
      }
      if (error instanceof WhatsAppAgentModelCatalogError) {
        sendJson(response, 422, { error: error.reason === 'catalog_empty'
          ? 'A API não retornou modelos compatíveis para esta conexão.'
          : 'Não foi possível validar a chave e consultar os modelos. Confira a chave e o provedor.', automationPaused })
        return
      }
      sendJson(response, 503, { error: 'Não foi possível concluir a conexão com este provedor agora.', automationPaused })
    }
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/whatsapp/agent-providers/migrate') {
    const provider = requestUrl.searchParams.get('provider') ?? ''
    if (!whatsappAgentProviders.includes(provider as typeof whatsappAgentProviders[number])) {
      sendJson(response, 400, { error: 'Selecione um provedor de IA válido.' })
      return
    }
    const providerId = provider as typeof whatsappAgentProviders[number]
    const rateLimit = checkRateLimit({ key: `whatsapp-agent-provider-migrate:${user.id}`, limit: 5, windowMs: 60_000 })
    if (!rateLimit.allowed) {
      sendJson(response, 429, { error: 'Aguarde um instante antes de migrar outra conexão.' })
      return
    }
    const legacyConfig = getWhatsAppAgentProviderConfig(providerId, getDefaultWhatsAppAgentModel(providerId))
    if (!legacyConfig) {
      sendJson(response, 409, { error: 'Não há uma conexão deste provedor configurada no servidor para migrar.' })
      return
    }
    let automationPaused = false
    try {
      const models = await listWhatsAppAgentModelsForConfig(providerId, legacyConfig)
      automationPaused = (await new WhatsAppStore().pauseDigiBuscaAutomationForProviderChange(user.id, providerId)) > 0
      await saveWhatsAppAiProviderCredential({
        userId: user.id,
        provider: providerId,
        apiKey: legacyConfig.apiKey,
        baseUrl: legacyConfig.baseUrl,
      })
      invalidateWhatsAppAgentModelCache(providerId, user.id)
      response.setHeader('Cache-Control', 'private, no-store')
      sendJson(response, 200, { data: { provider: providerId, configured: true, models } })
    } catch (error) {
      response.setHeader('Cache-Control', 'private, no-store')
      if (error instanceof WhatsAppAiProviderCredentialStorageError) {
        const message = error.reason === 'migration_missing'
          ? 'Aplique a migration 021_whatsapp_ai_provider_connections.sql no Supabase para migrar conexões pelo painel.'
          : 'Não foi possível guardar a conexão protegida no Supabase.'
        sendJson(response, 503, { error: message, automationPaused })
        return
      }
      if (error instanceof WhatsAppAgentModelCatalogError) {
        sendJson(response, 422, { error: 'Não foi possível validar a conexão existente e consultar os modelos.', automationPaused })
        return
      }
      sendJson(response, 503, { error: 'Não foi possível migrar a conexão do servidor para o painel agora.', automationPaused })
    }
    return
  }

  if (request.method === 'DELETE' && requestUrl.pathname === '/api/whatsapp/agent-providers') {
    const provider = requestUrl.searchParams.get('provider') ?? ''
    if (!whatsappAgentProviders.includes(provider as typeof whatsappAgentProviders[number])) {
      sendJson(response, 400, { error: 'Selecione um provedor de IA válido.' })
      return
    }
    const rateLimit = checkRateLimit({ key: `whatsapp-agent-provider-disconnect:${user.id}`, limit: 5, windowMs: 60_000 })
    if (!rateLimit.allowed) {
      sendJson(response, 429, { error: 'Aguarde um instante antes de desconectar outro provedor.' })
      return
    }
    let automationPaused = false
    try {
      automationPaused = (await new WhatsAppStore().pauseDigiBuscaAutomationForProviderChange(user.id, provider as typeof whatsappAgentProviders[number])) > 0
      await disableWhatsAppAiProviderCredential(user.id, provider as typeof whatsappAgentProviders[number])
      invalidateWhatsAppAgentModelCache(provider as typeof whatsappAgentProviders[number], user.id)
      const state = await getWhatsAppAgentProvidersStateForUser(user.id)
      response.setHeader('Cache-Control', 'private, no-store')
      sendJson(response, 200, { data: { agentProviders: state.configured, agentProviderSources: state.source } })
    } catch (error) {
      const message = error instanceof WhatsAppAiProviderCredentialStorageError && error.reason === 'migration_missing'
        ? 'Aplique a migration 021_whatsapp_ai_provider_connections.sql no Supabase para gerenciar conexões pelo painel.'
        : 'Não foi possível desconectar o provedor com segurança.'
      sendJson(response, 503, { error: message, automationPaused })
    }
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/whatsapp/agent-models') {
    const provider = requestUrl.searchParams.get('provider') ?? ''
    if (!whatsappAgentProviders.includes(provider as typeof whatsappAgentProviders[number])) {
      sendJson(response, 400, { error: 'Selecione um provedor de IA válido.' })
      return
    }
    const rateLimit = checkRateLimit({ key: `whatsapp-agent-models:${user.id}`, limit: 10, windowMs: 60_000 })
    if (!rateLimit.allowed) {
      sendJson(response, 429, { error: 'Aguarde um instante antes de atualizar a lista de modelos.' })
      return
    }
    try {
      const providerId = provider as typeof whatsappAgentProviders[number]
      const config = await getWhatsAppAgentProviderConfigForUser(user.id, providerId, getDefaultWhatsAppAgentModel(providerId))
      const data = await listWhatsAppAgentModels(providerId, { config, cacheScope: user.id })
      response.setHeader('Cache-Control', 'private, no-store')
      sendJson(response, 200, { data })
    } catch (error) {
      response.setHeader('Cache-Control', 'private, no-store')
      const statusCode = error instanceof WhatsAppAgentModelCatalogError && error.reason === 'provider_not_configured' ? 409 : 503
      const message = error instanceof WhatsAppAiProviderCredentialStorageError && error.reason === 'migration_missing'
        ? 'Aplique a migration 021_whatsapp_ai_provider_connections.sql no Supabase para carregar conexões do painel.'
        : error instanceof WhatsAppAgentModelCatalogError && error.reason === 'provider_not_configured'
        ? 'Conecte a API deste provedor no painel para carregar os modelos disponíveis.'
        : error instanceof WhatsAppAgentModelCatalogError && error.reason === 'catalog_empty'
          ? 'Este provedor não retornou modelos compatíveis com a automação.'
          : 'Não foi possível consultar os modelos deste provedor agora.'
      sendJson(response, statusCode, { error: message })
    }
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
    if (input.automationEnabled && input.responseMode === 'openbot') {
      const bridge = getWhatsAppOpenBotBridgeConfig()
      if (!isWhatsAppOpenBotReplyRuntimeEnabled() || !bridge || input.openBotAgentId !== bridge.agentId) {
        sendJson(response, 503, { error: 'O atendimento OpenBot está indisponível até a bridge privada e o agente dedicado estarem configurados.' })
        return
      }
      try {
        const agent = await getOpenBotWhatsAppAgentStatus(input.openBotAgentId)
        if (!agent.connected) {
          sendJson(response, 503, { error: 'O agente OpenBot selecionado não está conectado à Local scripts API.' })
          return
        }
      } catch {
        sendJson(response, 503, { error: 'Não foi possível confirmar a conexão privada com o agente OpenBot.' })
        return
      }
    }
    if (input.automationEnabled && input.responseMode === 'digibot_agent') {
      const agentStorageReady = await new WhatsAppStore().isDigiBuscaAgentStorageReady()
      let providerConfig
      try {
        providerConfig = await getWhatsAppAgentProviderConfigForUser(user.id, input.agentProvider, input.agentModel)
      } catch {
        sendJson(response, 503, { error: 'Não foi possível consultar a conexão protegida da IA. Tente novamente em instantes.' })
        return
      }
      if (!isWhatsAppDigiBuscaAgentRuntimeEnabled() || !providerConfig || !agentStorageReady) {
        sendJson(response, 503, { error: 'O agente DigiBusca ainda não está pronto. Confira a migration 019, conecte uma API no painel e verifique o interruptor WHATSAPP_DIGIBOT_AGENT_RUNTIME_ENABLED no backend.' })
        return
      }
    }
    if (input.automationEnabled && input.responseMode === 'openclaw') {
      const config = getOpenClawMcpConfig()
      const store = new WhatsAppStore()
      const [connectionPlatform, openClawStorageReady] = await Promise.all([
        store.getConnectionPlatformType(user.id, input.phoneNumberId),
        store.isOpenClawStorageReady(),
      ])
      if (
        !isWhatsAppOpenClawRuntimeEnabled() || !config || config.ownerUserId !== user.id ||
        config.phoneNumberId !== input.phoneNumberId || connectionPlatform !== 'OPENCLAW_WEB' || !openClawStorageReady
      ) {
        sendJson(response, 503, { error: 'O Cristhian do OpenClaw ainda não está pronto. Confira o MCP privado, a ponte de mensagens, a migration 022 e se este número já foi pareado e marcado como OPENCLAW_WEB.' })
        return
      }
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
    const store = new WhatsAppStore()
    const updated = await store.setConversationAutomationPaused(user.id, conversationId, paused, paused ? 'manual' : 'manual_resume')
    if (!updated) {
      sendJson(response, 404, { error: 'Conversa não encontrada.' })
      return
    }
    if (!paused && await store.queueLatestUnansweredReply(user.id, conversationId) === 'conflict') {
      sendJson(response, 409, { error: 'O atendimento mudou durante a tentativa. Atualize a conversa para conferir o estado atual.' })
      return
    }
    sendJson(response, 200, { data: { paused } })
    return
  }

  const scheduleReviewMatch = requestUrl.pathname.match(/^\/api\/whatsapp\/conversations\/([^/]+)\/schedule-review$/)
  if (request.method === 'PATCH' && scheduleReviewMatch) {
    const conversationId = scheduleReviewMatch[1]
    let body: unknown
    try {
      body = await readJsonBody(request)
    } catch {
      sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
      return
    }
    if (!isUuid(conversationId) || typeof body !== 'object' || body === null || (body as Record<string, unknown>).reviewed !== true) {
      sendJson(response, 400, { error: 'A confirmação do aviso de agendamento é inválida.' })
      return
    }
    const updated = await new WhatsAppStore().clearConversationScheduleReview(user.id, conversationId)
    if (!updated) {
      sendJson(response, 409, { error: 'Este aviso de agendamento já foi removido ou a conversa mudou.' })
      return
    }
    sendJson(response, 200, { data: { reviewed: true } })
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

  const whatsappQualificationMatch = requestUrl.pathname.match(/^\/api\/whatsapp\/conversations\/([^/]+)\/qualification$/)
  if (request.method === 'GET' && whatsappQualificationMatch) {
    const conversationId = whatsappQualificationMatch[1]
    if (!isUuid(conversationId)) {
      sendJson(response, 400, { error: 'A conversa é inválida.' })
      return
    }
    const data = await new WhatsAppStore().getConversationQualification(accessToken, user.id, conversationId)
    response.setHeader('Cache-Control', 'no-store')
    sendJson(response, 200, { data: data ?? null })
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/whatsapp/status') {
    const connectionStorageReady = await new WhatsAppStore().isEvolutionStorageReady()
    const automationStorageReady = await new WhatsAppStore().isAutomationStorageReady()
    const openClawStorageReady = await new WhatsAppStore().isOpenClawStorageReady()
    const digiBuscaAgentStorageReady = await new WhatsAppStore().isDigiBuscaAgentStorageReady()
    let agentProviders = getWhatsAppAgentProvidersStatus()
    let agentProviderSources = {
      google: agentProviders.google ? 'server' : 'none',
      anthropic: agentProviders.anthropic ? 'server' : 'none',
      openaiCompatible: agentProviders.openaiCompatible ? 'server' : 'none',
    }
    try {
      const state = await getWhatsAppAgentProvidersStateForUser(user.id)
      agentProviders = state.configured
      agentProviderSources = state.source
    } catch (error) {
      if (error instanceof WhatsAppAiProviderCredentialStorageError && error.reason === 'migration_missing') {
        // Keep legacy VPS connections visible so the panel can offer migration, but runtime reads still fail closed.
        agentProviders = getWhatsAppAgentProvidersStatus()
        agentProviderSources = {
          google: agentProviders.google ? 'server' : 'none',
          anthropic: agentProviders.anthropic ? 'server' : 'none',
          openaiCompatible: agentProviders.openaiCompatible ? 'server' : 'none',
        }
      } else {
      agentProviders = { google: false, anthropic: false, openaiCompatible: false }
      agentProviderSources = { google: 'unavailable', anthropic: 'unavailable', openaiCompatible: 'unavailable' }
      }
    }
    sendJson(response, 200, { data: { ...getWhatsAppEvolutionSetupStatus(), agentProviders, agentProviderSources, connectionStorageReady, automationStorageReady, openClawStorageReady, digiBuscaAgentStorageReady } })
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/whatsapp/openbot/status') {
    const agentId = requestUrl.searchParams.get('agentId') ?? ''
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(agentId)) {
      sendJson(response, 400, { error: 'Informe um agent ID válido.' })
      return
    }
    const bridge = getWhatsAppOpenBotBridgeConfig()
    if (!bridge || agentId !== bridge.agentId) {
      response.setHeader('Cache-Control', 'no-store')
      sendJson(response, 200, { data: { agentId, agentName: null, connected: false } })
      return
    }
    try {
      const data = await getOpenBotWhatsAppAgentStatus(agentId)
      response.setHeader('Cache-Control', 'no-store')
      sendJson(response, 200, { data })
    } catch (error) {
      if (error instanceof OpenBotWhatsAppBridgeError) {
        response.setHeader('Cache-Control', 'no-store')
        sendJson(response, 200, { data: { agentId, agentName: null, connected: false } })
        return
      }
      throw error
    }
    return
  }

  const trackedLeadProvider = new GooglePlacesProvider(
    undefined,
    (requestType) => persistenceStore.reserveGoogleApiRequest(accessToken, requestType),
  )
  const interactionMatch = requestUrl.pathname.match(/^\/api\/leads\/([^/]+)\/interactions$/)

  if (request.method === 'GET' && requestUrl.pathname === '/api/openbot/agents') {
    try {
      const dedicatedWhatsAppAgentId = getConfiguredWhatsAppOpenBotAgentId()
      sendJson(response, 200, { data: (await listOpenBotAgents()).filter((agent) => agent.id !== dedicatedWhatsAppAgentId) })
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

    if (requestUrl.pathname === '/api/leads/bulk' && request.method === 'PATCH') {
      let body: unknown
      try {
        body = await readLimitedJsonBody(request, bulkLeadBodyLimitBytes)
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          sendJson(response, 413, { error: error.message })
          return
        }
        sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
        return
      }
      const input = parseBulkLeadStatusUpdateInput(body)
      if (!input) {
        sendJson(response, 400, { error: 'Informe de 1 a 200 IDs de leads únicos e válidos e um status permitido.' })
        return
      }
      const updatedLeadIds = await persistenceStore.updateSavedLeadStatuses(accessToken, user.id, input.leadIds, input.status)
      sendJson(response, 200, { data: { updatedCount: updatedLeadIds.length, updatedLeadIds } })
      return
    }

    if (requestUrl.pathname === '/api/leads/bulk' && request.method === 'DELETE') {
      let body: unknown
      try {
        body = await readLimitedJsonBody(request, bulkLeadBodyLimitBytes)
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          sendJson(response, 413, { error: error.message })
          return
        }
        sendJson(response, 400, { error: 'O corpo da requisição precisa ser um JSON válido.' })
        return
      }
      const input = parseBulkLeadDeleteInput(body)
      if (!input) {
        sendJson(response, 400, { error: 'Informe de 1 a 200 IDs de leads únicos e válidos.' })
        return
      }
      const deletedLeadIds = await persistenceStore.removeSavedLeads(accessToken, user.id, input.leadIds)
      sendJson(response, 200, { data: { deletedCount: deletedLeadIds.length, deletedLeadIds } })
      return
    }

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

      if (input.agentId === getConfiguredWhatsAppOpenBotAgentId()) {
        sendJson(response, 409, { error: 'O agente dedicado ao atendimento WhatsApp não pode ser usado para rascunhos de prospecção.' })
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

      if (agentId === getConfiguredWhatsAppOpenBotAgentId()) {
        sendJson(response, 409, { error: 'O agente dedicado ao atendimento WhatsApp não pode ser usado para prospecção.' })
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

      if (changes.whatsappConsentStatus === 'opted_out') {
        await new WhatsAppStore().markSavedLeadOptedOut(user.id, updateMatch[1])
      }

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

async function cleanExpiredAgentQualifications() {
  const store = new WhatsAppStore()
  if (!await store.isDigiBuscaAgentStorageReady()) return
  await store.purgeExpiredAgentQualifications()
}

const agentQualificationRetentionScheduler = setInterval(() => {
  void cleanExpiredAgentQualifications().catch(() => {
    logWarning('whatsapp_agent_qualification_retention_failed', { reason: 'retention_cleanup_unavailable' })
  })
}, 24 * 60 * 60 * 1_000)
agentQualificationRetentionScheduler.unref()
void cleanExpiredAgentQualifications().catch(() => {
  logWarning('whatsapp_agent_qualification_retention_failed', { reason: 'retention_cleanup_unavailable' })
})
