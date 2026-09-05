import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { executeSearchLeads } from '../application/searchLeads.js'
import { GooglePlacesProvider } from '../integrations/googlePlacesProvider.js'
import type { Lead, LeadStatus, LeadUpdate } from '../contracts/lead.js'
import type { CreateSaleInput } from '../contracts/sale.js'
import { authenticateRequest } from '../config/supabase.js'
import { SupabaseStore } from '../data/supabaseStore.js'
import { listCities, listCountries, listStates } from '../integrations/locationCatalog.js'

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

  const { leadId: _leadId, ...userState } = state
  return { ...lead, ...userState }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  const origin = response.req.headers.origin
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin':
      origin && allowedOrigins.has(origin) ? origin : 'http://127.0.0.1:5173',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8',
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

  console.error('DigiBusca API:', error)
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

function getSearchParams(request: IncomingMessage) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  return {
    city: requestUrl.searchParams.get('city')?.trim() ?? '',
    segment: requestUrl.searchParams.get('segment')?.trim() || 'Todos os segmentos',
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

    if (saveMatch && (request.method === 'POST' || request.method === 'DELETE')) {
      if (request.method === 'POST') {
        const lead = await leadProvider.findById(saveMatch[1])

        if (!lead) {
          sendJson(response, 404, { error: 'Lead não encontrado. Faça a busca novamente.' })
          return
        }

        const savedLead = await persistenceStore.saveLead(accessToken, user.id, lead)
        sendJson(response, 200, { data: savedLead })
        return
      }

      await persistenceStore.removeSavedLead(accessToken, user.id, saveMatch[1])
      sendJson(response, 204, null)
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

      const currentLead = await leadProvider.findById(updateMatch[1])
      const savedState = await persistenceStore.getSavedLeadState(
        accessToken,
        user.id,
        updateMatch[1],
      )
      const originalLead = currentLead ? mergeSavedLeadState(currentLead, savedState) : undefined

      if (!originalLead) {
        sendJson(response, 404, { error: 'Lead não encontrado.' })
        return
      }

      const updatedLead = await persistenceStore.saveLead(accessToken, user.id, {
        ...originalLead,
        ...changes,
      })

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

  if (requestUrl.pathname === '/api/saved-leads') {
    const savedStates = await persistenceStore.listSavedLeadStates(accessToken, user.id)
    const savedLeads = (
      await Promise.all(
        savedStates.map(async (savedState) => {
          try {
            const lead = await leadProvider.findById(savedState.leadId)
            return lead ? mergeSavedLeadState(lead, savedState) : undefined
          } catch {
            return undefined
          }
        }),
      )
    ).filter((lead): lead is NonNullable<typeof lead> => Boolean(lead))

    sendJson(response, 200, { data: savedLeads })
    return
  }

  if (requestUrl.pathname === '/api/sales') {
    sendJson(response, 200, { data: await persistenceStore.listSales(accessToken, user.id) })
    return
  }

  if (requestUrl.pathname === '/api/leads') {
    const query = getSearchParams(request)

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

    try {
      const payload = await executeSearchLeads(leadProvider, query)
      sendJson(response, 200, payload)
    } catch (error) {
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
  console.log(`DigiBusca API em http://127.0.0.1:${port}`)
})
