import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import dotenv from 'dotenv'
import { executeSearchLeads } from '../application/searchLeads.js'
import { GooglePlacesProvider } from '../integrations/googlePlacesProvider.js'
import { opportunityTypes, parseLeadSnapshot, type Lead, type LeadStatus, type LeadUpdate, type OpportunityType } from '../contracts/lead.js'
import type { CreateSaleInput } from '../contracts/sale.js'
import { interactionChannels, type CreateLeadInteractionInput } from '../contracts/interaction.js'
import { authenticateRequest, configureRuntimeEnvironment } from '../config/supabase.js'
import { SupabaseStore } from '../data/supabaseStore.js'
import { listCities, listCountries, listStates } from '../integrations/locationCatalog.js'
import { getGeminiApiKey } from '../config/supabase.js'
import { parseGenerateOutreachInput } from '../contracts/aiOutreach.js'
import { GeminiOutreachError } from '../integrations/geminiOutreachProvider.js'
import { generateLeadOutreach } from '../application/generateLeadOutreach.js'
import { checkRateLimit } from './rateLimit.js'
import { createRequestId, logError, logInfo } from '../observability/logger.js'
import { checkSiteHealth } from '../integrations/siteHealth.js'

dotenv.config({ path: process.env.DIGIBUSCA_ENV_FILE ?? 'backend/.env' })
dotenv.config({ path: 'frontend/.env' })
configureRuntimeEnvironment(process.env)

const port = Number(process.env.PORT ?? 3001)
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
const allowedOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

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
    'Content-Type': 'application/json; charset=utf-8',
    'X-Request-Id': requestId,
  })
  response.end(JSON.stringify(payload))
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
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, null)
    return
  }

  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (requestUrl.pathname === '/api/health') {
    sendJson(response, 200, {
      status: 'ok',
      service: 'digibusca-backend',
      searchProvider: leadProvider.isConfigured ? 'google-places' : 'google-places-not-configured',
    })
    return
  }

  const authentication = await authenticateRequest(request.headers.authorization)
  if (!authentication) {
    sendJson(response, 401, { error: 'Faça login para acessar os dados da sua conta.' })
    return
  }

  const { accessToken, user } = authentication
  const trackedLeadProvider = new GooglePlacesProvider(
    undefined,
    (requestType) => persistenceStore.recordGoogleApiCall(accessToken, requestType),
  )
  const interactionMatch = requestUrl.pathname.match(/^\/api\/leads\/([^/]+)\/interactions$/)

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

      const changes: Partial<LeadUpdate> = {}
      if (body.status !== undefined) changes.status = body.status as LeadStatus
      if (body.notes !== undefined) changes.notes = typeof body.notes === 'string' ? body.notes : ''
      if (body.nextFollowUp !== undefined)
        changes.nextFollowUp = typeof body.nextFollowUp === 'string' && body.nextFollowUp
          ? body.nextFollowUp
          : undefined
      if (body.draftMessage !== undefined)
        changes.draftMessage = typeof body.draftMessage === 'string' ? body.draftMessage : ''

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
      sendJson(response, 503, {
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
      (query.pageToken && query.pageToken.length > 2048)
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
      sendJson(response, 503, {
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

server.listen(port, () => {
  logInfo('api_started', { port })
})
