import { executeSearchLeads } from '../application/searchLeads.js'
import { authenticateRequest, configureRuntimeEnvironment, getGeminiApiKey, getWhatsAppCloudSetupStatus, getWhatsAppEmbeddedSignupServerConfig, type RuntimeEnvironment } from '../config/supabase.js'
import { parseLeadSnapshot, parseWhatsAppConsentChanges, type Lead, type LeadStatus, type LeadUpdate, opportunityTypes, type OpportunityType } from '../contracts/lead.js'
import { parseGenerateOutreachInput } from '../contracts/aiOutreach.js'
import type { CreateSaleInput, UpdateSaleInput } from '../contracts/sale.js'
import { interactionChannels, type CreateLeadInteractionInput } from '../contracts/interaction.js'
import { SupabaseStore, WhatsAppConsentSchemaMissingError } from '../data/supabaseStore.js'
import { GooglePlacesProvider } from '../integrations/googlePlacesProvider.js'
import { isGoogleApiMonthlyLimitError } from '../application/googleApiUsageLimit.js'
import { checkRateLimit } from './rateLimit.js'
import { getRequestId, logError, logInfo } from '../observability/logger.js'
import { GeminiOutreachError } from '../integrations/geminiOutreachProvider.js'
import { generateLeadOutreach } from '../application/generateLeadOutreach.js'
import { checkSiteHealth } from '../integrations/siteHealth.js'
import { parseWhatsAppTemplateSendInput, sendWhatsAppTemplateForLead, WhatsAppSendFlowError } from '../application/sendWhatsAppTemplate.js'
import { handleWhatsAppWebhook, WhatsAppWebhookBodyTooLargeError } from '../application/handleWhatsAppWebhook.js'
import { whatsappWebhookMaxBodyBytes } from '../application/whatsappWebhook.js'
import { isUuid, parseWhatsAppEmbeddedSignupInput, parseWhatsAppPageOptions } from '../contracts/whatsapp.js'
import { WhatsAppConnectionConflictError, WhatsAppStore } from '../data/whatsappStore.js'
import { exchangeWhatsAppEmbeddedSignupCode, findCoexistencePhoneNumber, WhatsAppEmbeddedSignupError } from '../integrations/whatsappEmbeddedSignup.js'

type WorkerEnvironment = RuntimeEnvironment & {
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

const leadStatuses: LeadStatus[] = ['Novo', 'Contatado', 'Respondeu', 'Proposta', 'Ganhou', 'Perdeu']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function mergeSavedLeadState(lead: Lead, state: Awaited<ReturnType<SupabaseStore['getSavedLeadState']>>) {
  if (!state) return lead

  const { leadId: _leadId, lead: _lead, leadDataExpiresAt: _leadDataExpiresAt, ...userState } = state
  return { ...lead, ...userState }
}

function jsonResponse(request: Request, status: number, payload: unknown, extraHeaders?: HeadersInit) {
  const requestId = getRequestId(request)
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Request-Id': requestId,
    Vary: 'Origin',
  })
  const origin = request.headers.get('Origin')
  if (origin) headers.set('Access-Control-Allow-Origin', origin)
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value))

  return new Response(status === 204 ? null : JSON.stringify(payload), { status, headers })
}

function parseSaleInput(value: unknown): CreateSaleInput | undefined {
  if (!isRecord(value)) return undefined

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
  if (!isRecord(value)) return undefined

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

function getSearchParams(url: URL) {
  const opportunity = url.searchParams.get('opportunity')?.trim()
  return {
    city: url.searchParams.get('city')?.trim() ?? '',
    segment: url.searchParams.get('segment')?.trim() || 'Todos os segmentos',
    opportunity: opportunity || undefined,
    languageCode: url.searchParams.get('languageCode')?.trim() || undefined,
    regionCode: url.searchParams.get('regionCode')?.trim() || undefined,
    pageToken: url.searchParams.get('pageToken')?.trim() || undefined,
  }
}

function isAuthTokenError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes('jwt')
}

async function parseBody(request: Request) {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

async function readRawWebhookBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get('Content-Length')
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > whatsappWebhookMaxBodyBytes) {
    throw new WhatsAppWebhookBodyTooLargeError()
  }
  if (!request.body) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > whatsappWebhookMaxBodyBytes) {
      await reader.cancel().catch(() => undefined)
      throw new WhatsAppWebhookBodyTooLargeError()
    }
    chunks.push(value)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function webhookResponse(result: Awaited<ReturnType<typeof handleWhatsAppWebhook>>, request: Request) {
  return new Response(result.body, {
    status: result.status,
    headers: {
      'Content-Type': result.contentType,
      'Cache-Control': 'no-store',
      'X-Request-Id': getRequestId(request),
    },
  })
}

async function handleApiRequest(request: Request) {
  if (request.method === 'OPTIONS') return jsonResponse(request, 204, null)

  const url = new URL(request.url)
  const leadProvider = new GooglePlacesProvider()
  const persistenceStore = new SupabaseStore()

  if (url.pathname === '/api/health') {
    return jsonResponse(request, 200, {
      status: 'ok',
      service: 'digibusca-backend',
      searchProvider: leadProvider.isConfigured ? 'google-places' : 'google-places-not-configured',
    })
  }

  if (url.pathname === '/api/webhooks/whatsapp') {
    const result = await handleWhatsAppWebhook(
      request.method,
      url,
      request.headers.get('X-Hub-Signature-256'),
      () => readRawWebhookBody(request),
    )
    return webhookResponse(result, request)
  }

  const authentication = await authenticateRequest(request.headers.get('Authorization') ?? undefined)
  if (!authentication) {
    return jsonResponse(request, 401, { error: 'Faça login para acessar os dados da sua conta.' })
  }

  const { accessToken, user } = authentication

  if (request.method === 'GET' && url.pathname === '/api/whatsapp/connections') {
    return jsonResponse(request, 200, { data: await new WhatsAppStore().listConnections(user.id) }, { 'Cache-Control': 'no-store' })
  }

  if (request.method === 'POST' && url.pathname === '/api/whatsapp/connections/embedded-signup') {
    const input = parseWhatsAppEmbeddedSignupInput(await parseBody(request))
    if (!input) return jsonResponse(request, 400, { error: 'A resposta do Embedded Signup está incompleta. Reinicie a conexão.' })
    const config = getWhatsAppEmbeddedSignupServerConfig()
    if (!config) {
      return jsonResponse(request, 503, { error: 'O backend ainda precisa configurar a troca segura de código do Embedded Signup.' })
    }
    const whatsappStore = new WhatsAppStore()
    if (!(await whatsappStore.isCoexistenceStorageReady())) {
      return jsonResponse(request, 503, { error: 'A migration local do WhatsApp precisa estar aplicada ao Supabase antes de conectar uma conta.' })
    }

    try {
      const exchanged = await exchangeWhatsAppEmbeddedSignupCode(input.code, config)
      const phone = await findCoexistencePhoneNumber(input.wabaId, input.phoneNumberId, exchanged.accessToken, config.graphApiVersion)
      const data = await whatsappStore.connectCoexistencePhone(
        user.id,
        input.wabaId,
        phone,
        exchanged.accessToken,
        exchanged.expiresAt,
      )
      return jsonResponse(request, 201, { data }, { 'Cache-Control': 'no-store' })
    } catch (error) {
      if (error instanceof WhatsAppEmbeddedSignupError) {
        return jsonResponse(request, error.status, { error: error.message }, { 'Cache-Control': 'no-store' })
      }
      if (error instanceof WhatsAppConnectionConflictError) {
        return jsonResponse(request, 409, { error: error.message }, { 'Cache-Control': 'no-store' })
      }
      throw error
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/whatsapp/conversations') {
    const options = parseWhatsAppPageOptions(url.searchParams)
    if (!options) return jsonResponse(request, 400, { error: 'Os parâmetros de paginação são inválidos.' })
    return jsonResponse(request, 200, await new WhatsAppStore().listConversations(accessToken, user.id, options))
  }

  const whatsappMessagesMatch = url.pathname.match(/^\/api\/whatsapp\/conversations\/([^/]+)\/messages$/)
  if (request.method === 'GET' && whatsappMessagesMatch) {
    const conversationId = whatsappMessagesMatch[1]
    const options = parseWhatsAppPageOptions(url.searchParams)
    if (!isUuid(conversationId) || !options) {
      return jsonResponse(request, 400, { error: 'A conversa ou os parâmetros de paginação são inválidos.' })
    }
    const data = await new WhatsAppStore().listConversationMessages(accessToken, user.id, conversationId, options)
    if (!data) return jsonResponse(request, 404, { error: 'Conversa não encontrada.' })
    return jsonResponse(request, 200, data)
  }

  if (request.method === 'GET' && url.pathname === '/api/whatsapp/status') {
    const connectionStorageReady = await new WhatsAppStore().isCoexistenceStorageReady()
    return jsonResponse(request, 200, { data: { ...getWhatsAppCloudSetupStatus(), connectionStorageReady } })
  }

  const trackedLeadProvider = new GooglePlacesProvider(
    undefined,
    (requestType) => persistenceStore.reserveGoogleApiRequest(accessToken, requestType),
  )

  function limitGoogleRequest(scope: 'search' | 'saved-lead') {
    const limit = scope === 'search' ? 12 : 24
    const result = checkRateLimit({
      key: `${scope}:${user.id}`,
      limit,
      windowMs: 60_000,
    })

    if (result.allowed) return undefined

    return jsonResponse(
      request,
      429,
      {
        error: 'Você fez muitas consultas em pouco tempo. Aguarde um instante antes de tentar novamente.',
      },
      { 'Retry-After': String(result.retryAfterSeconds) },
    )
  }

  if (request.method === 'POST' || request.method === 'PATCH' || request.method === 'DELETE') {
    const saveMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/save$/)
    const updateMatch = url.pathname.match(/^\/api\/leads\/([^/]+)$/)
    const interactionMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/interactions$/)
    const saleMatch = url.pathname.match(/^\/api\/sales\/([^/]+)$/)

    if (url.pathname === '/api/whatsapp/send-template' && request.method === 'POST') {
      const input = parseWhatsAppTemplateSendInput(await parseBody(request))
      if (!input) return jsonResponse(request, 400, { error: 'Informe um lead salvo e uma mensagem de até 1.024 caracteres.' })

      const rateLimit = checkRateLimit({ key: `whatsapp-send:${user.id}`, limit: 10, windowMs: 60_000 })
      if (!rateLimit.allowed) {
        return jsonResponse(
          request,
          429,
          { error: 'Aguarde antes de fazer outro envio pela API.' },
          { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        )
      }

      try {
        const data = await sendWhatsAppTemplateForLead(
          persistenceStore,
          accessToken,
          user.id,
          input.leadId,
          input.message,
        )
        return jsonResponse(request, 200, { data })
      } catch (error) {
        if (error instanceof WhatsAppSendFlowError) {
          return jsonResponse(request, error.status, { error: error.message })
        }
        throw error
      }
    }

    if (url.pathname === '/api/ai/outreach' && request.method === 'POST') {
      const input = parseGenerateOutreachInput(await parseBody(request))
      if (!input) return jsonResponse(request, 400, { error: 'Revise os dados da abordagem e tente novamente.' })

      const apiKey = getGeminiApiKey()
      if (!apiKey) return jsonResponse(request, 503, { error: 'A IA ainda não está configurada.' })

      try {
        return jsonResponse(request, 200, { data: await generateLeadOutreach(apiKey, input) })
      } catch (error) {
        if (error instanceof GeminiOutreachError) {
          return jsonResponse(request, error.status, { error: error.message })
        }
        throw error
      }
    }

    if (url.pathname === '/api/site-health' && request.method === 'POST') {
      const body = await parseBody(request)
      const siteUrl = isRecord(body) && typeof body.url === 'string' ? body.url.trim() : ''
      if (!siteUrl || siteUrl.length > 2_000) {
        return jsonResponse(request, 400, { error: 'Informe um endereço de site válido.' })
      }

      const rateLimit = checkRateLimit({ key: `site-health:${user.id}`, limit: 30, windowMs: 60_000 })
      if (!rateLimit.allowed) {
        return jsonResponse(
          request,
          429,
          { error: 'Aguarde um instante antes de verificar mais sites.' },
          { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        )
      }

      return jsonResponse(request, 200, { data: await checkSiteHealth(siteUrl) })
    }

    if (saveMatch && (request.method === 'POST' || request.method === 'DELETE')) {
      if (request.method === 'DELETE') {
        await persistenceStore.removeSavedLead(accessToken, user.id, saveMatch[1])
        return jsonResponse(request, 204, null)
      }

      const body = await parseBody(request)
      const snapshot = isRecord(body) ? parseLeadSnapshot(body.lead, saveMatch[1]) : undefined
      if (isRecord(body) && body.lead !== undefined && !snapshot) {
        return jsonResponse(request, 400, { error: 'Os dados do lead salvos são inválidos.' })
      }

      return jsonResponse(request, 200, {
        data: await persistenceStore.saveLeadState(accessToken, user.id, saveMatch[1], snapshot),
      })
    }

    if (interactionMatch && request.method === 'POST') {
      const input = parseLeadInteractionInput(await parseBody(request))
      if (!input) return jsonResponse(request, 400, { error: 'Informe canal, data e observação da interação.' })

      return jsonResponse(request, 201, {
        data: await persistenceStore.createLeadInteraction(
          accessToken,
          user.id,
          interactionMatch[1],
          input,
        ),
      })
    }

    if (updateMatch && request.method === 'PATCH') {
      const body = await parseBody(request)
      if (!isRecord(body)) return jsonResponse(request, 400, { error: 'O corpo da requisição é inválido.' })
      if (body.status !== undefined && !leadStatuses.includes(body.status as LeadStatus)) {
        return jsonResponse(request, 400, { error: 'Status de lead inválido.' })
      }

      for (const key of ['conversationStage', 'contactName', 'nextAction'] as const) {
        if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 500)) {
          return jsonResponse(request, 400, { error: 'Dados de acompanhamento inválidos.' })
        }
      }
      const changes: Partial<LeadUpdate> = {}
      for (const key of ['conversationStage', 'contactName', 'nextAction'] as const) {
        if (typeof body[key] === 'string') changes[key] = body[key].trim()
      }
      if (body.status !== undefined) changes.status = body.status as LeadStatus
      if (body.notes !== undefined) changes.notes = typeof body.notes === 'string' ? body.notes : ''
      if (body.nextFollowUp !== undefined) {
        changes.nextFollowUp = typeof body.nextFollowUp === 'string' && body.nextFollowUp
          ? body.nextFollowUp
          : ''
      }
      if (body.draftMessage !== undefined) changes.draftMessage = typeof body.draftMessage === 'string' ? body.draftMessage : ''

      if (['whatsappConsentStatus', 'whatsappConsentSource', 'whatsappConsentAt'].some((key) => body[key] !== undefined)) {
        const consentChanges = parseWhatsAppConsentChanges(body)
        if (!consentChanges) {
          return jsonResponse(request, 400, { error: 'Para registrar autorização, informe a origem e uma data válida. Marque apenas consentimento explícito.' })
        }
        Object.assign(changes, consentChanges)
      }

      return jsonResponse(request, 200, {
        data: await persistenceStore.saveLeadState(accessToken, user.id, updateMatch[1], undefined, changes),
      })
    }

    if (url.pathname === '/api/sales' && request.method === 'POST') {
      const input = parseSaleInput(await parseBody(request))
      if (!input) return jsonResponse(request, 400, { error: 'Informe comércio, serviço, valor e data da venda.' })
      return jsonResponse(request, 201, { data: await persistenceStore.createSale(accessToken, user.id, input) })
    }

    if (saleMatch && request.method === 'PATCH') {
      const input = parseUpdateSaleInput(await parseBody(request))
      if (!input) return jsonResponse(request, 400, { error: 'Informe comércio, serviço, valor e data da venda.' })

      const sale = await persistenceStore.updateSale(
        accessToken,
        user.id,
        decodeURIComponent(saleMatch[1]),
        input,
      )
      if (!sale) return jsonResponse(request, 404, { error: 'Venda não encontrada.' })
      return jsonResponse(request, 200, { data: sale })
    }

    if (saleMatch && request.method === 'DELETE') {
      const deleted = await persistenceStore.deleteSale(accessToken, user.id, decodeURIComponent(saleMatch[1]))
      if (!deleted) return jsonResponse(request, 404, { error: 'Venda não encontrada.' })
      return jsonResponse(request, 204, null)
    }

    return jsonResponse(request, 405, { error: 'Método não permitido.' })
  }

  if (request.method === 'GET' && url.pathname === '/api/saved-leads') {
    return jsonResponse(request, 200, {
      data: await persistenceStore.listSavedLeadStates(accessToken, user.id),
    })
  }

  const interactionMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/interactions$/)
  if (request.method === 'GET' && interactionMatch) {
    return jsonResponse(request, 200, {
      data: await persistenceStore.listLeadInteractions(accessToken, user.id, interactionMatch[1]),
    })
  }

  const savedLeadDetailMatch = url.pathname.match(/^\/api\/saved-leads\/([^/]+)$/)
  if (request.method === 'GET' && savedLeadDetailMatch) {
    const savedState = await persistenceStore.getSavedLeadState(accessToken, user.id, savedLeadDetailMatch[1])
    if (!savedState) {
      return jsonResponse(request, 404, { error: 'Este lead não está salvo na sua conta.' })
    }

    if (savedState.lead) {
      return jsonResponse(request, 200, {
        data: mergeSavedLeadState({ ...savedState.lead, status: savedState.status }, savedState),
      })
    }

    const rateLimitResponse = limitGoogleRequest('saved-lead')
    if (rateLimitResponse) return rateLimitResponse

    try {
      const lead = await trackedLeadProvider.findById(savedState.leadId)
      if (!lead) {
        return jsonResponse(request, 404, { error: 'Não foi possível encontrar este negócio no Google agora.' })
      }

      await persistenceStore.refreshSavedLeadSnapshot(accessToken, user.id, lead)

      return jsonResponse(request, 200, { data: mergeSavedLeadState(lead, savedState) })
    } catch (error) {
      return jsonResponse(request, isGoogleApiMonthlyLimitError(error) ? 429 : 503, {
        error: error instanceof Error ? error.message : 'Não foi possível atualizar os dados deste negócio agora.',
      })
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/saved-lead-ids') {
    return jsonResponse(request, 200, {
      data: await persistenceStore.listSavedLeadStates(accessToken, user.id),
    })
  }

  if (request.method === 'GET' && url.pathname === '/api/sales') {
    return jsonResponse(request, 200, { data: await persistenceStore.listSales(accessToken, user.id) })
  }

  if (request.method === 'GET' && url.pathname === '/api/google-api-usage') {
    return jsonResponse(request, 200, { data: await persistenceStore.getGoogleApiUsage(accessToken) })
  }

  if (request.method === 'GET' && url.pathname === '/api/leads') {
    const { opportunity, ...query } = getSearchParams(url)
    if (!query.city) return jsonResponse(request, 400, { error: 'O parâmetro city é obrigatório.' })
    if (query.city.length > 120 || query.segment.length > 120 || (query.pageToken && query.pageToken.length > 24_000)) {
      return jsonResponse(request, 400, { error: 'A localização e o segmento precisam ser mais curtos.' })
    }
    if (opportunity && !opportunityTypes.includes(opportunity as OpportunityType)) {
      return jsonResponse(request, 400, { error: 'O filtro de oportunidade é inválido.' })
    }

    const rateLimitResponse = limitGoogleRequest('search')
    if (rateLimitResponse) return rateLimitResponse

    try {
      const result = await executeSearchLeads(trackedLeadProvider, {
          ...query,
          ...(opportunity ? { opportunity: opportunity as OpportunityType } : {}),
        })
      logInfo('lead_search_completed', {
        requestId: getRequestId(request),
        resultCount: result.data.length,
      })
      return jsonResponse(request, 200, result)
    } catch (error) {
      logError('lead_search_failed', error, {
        requestId: getRequestId(request),
      })
      return jsonResponse(request, isGoogleApiMonthlyLimitError(error) ? 429 : 503, {
        error: error instanceof Error ? error.message : 'Não foi possível consultar os negócios agora.',
      })
    }
  }

  return jsonResponse(request, 404, { error: 'Rota não encontrada.' })
}

export default {
  async fetch(request: Request, environment: WorkerEnvironment) {
    configureRuntimeEnvironment(environment)

    try {
      if (new URL(request.url).pathname.startsWith('/api/')) return await handleApiRequest(request)
      if (environment.ASSETS) return environment.ASSETS.fetch(request)
      return new Response('DigiBusca', { status: 404 })
    } catch (error) {
      if (isAuthTokenError(error)) {
        return jsonResponse(request, 401, { error: 'Sua sessão não é mais válida. Faça login novamente.' })
      }

      if (error instanceof WhatsAppConsentSchemaMissingError) {
        return jsonResponse(request, 503, { error: error.message })
      }

      const url = new URL(request.url)
      logError('api_request_failed', error, {
        method: request.method,
        path: url.pathname,
        requestId: getRequestId(request),
      })
      return jsonResponse(request, 500, { error: 'Não foi possível concluir a operação agora.' })
    }
  },
}
