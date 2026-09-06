import { executeSearchLeads } from '../application/searchLeads.js'
import { authenticateRequest, configureRuntimeEnvironment, type RuntimeEnvironment } from '../config/supabase.js'
import { type Lead, type LeadStatus, type LeadUpdate, opportunityTypes, type OpportunityType } from '../contracts/lead.js'
import type { CreateSaleInput } from '../contracts/sale.js'
import { SupabaseStore } from '../data/supabaseStore.js'
import { GooglePlacesProvider } from '../integrations/googlePlacesProvider.js'

type WorkerEnvironment = RuntimeEnvironment & {
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

const leadStatuses: LeadStatus[] = ['Novo', 'Contatado', 'Respondeu', 'Proposta', 'Ganhou', 'Perdeu']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function mergeSavedLeadState(lead: Lead, state: Awaited<ReturnType<SupabaseStore['getSavedLeadState']>>) {
  if (!state) return lead

  const { leadId: _leadId, ...userState } = state
  return { ...lead, ...userState }
}

function jsonResponse(request: Request, status: number, payload: unknown) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  })
  const origin = request.headers.get('Origin')
  if (origin) headers.set('Access-Control-Allow-Origin', origin)

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

  const authentication = await authenticateRequest(request.headers.get('Authorization') ?? undefined)
  if (!authentication) {
    return jsonResponse(request, 401, { error: 'Faça login para acessar os dados da sua conta.' })
  }

  const { accessToken, user } = authentication

  if (request.method === 'POST' || request.method === 'PATCH' || request.method === 'DELETE') {
    const saveMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/save$/)
    const updateMatch = url.pathname.match(/^\/api\/leads\/([^/]+)$/)

    if (saveMatch && (request.method === 'POST' || request.method === 'DELETE')) {
      if (request.method === 'DELETE') {
        await persistenceStore.removeSavedLead(accessToken, user.id, saveMatch[1])
        return jsonResponse(request, 204, null)
      }

      const lead = await leadProvider.findById(saveMatch[1])
      if (!lead) return jsonResponse(request, 404, { error: 'Lead não encontrado. Faça a busca novamente.' })
      return jsonResponse(request, 200, { data: await persistenceStore.saveLead(accessToken, user.id, lead) })
    }

    if (updateMatch && request.method === 'PATCH') {
      const body = await parseBody(request)
      if (!isRecord(body)) return jsonResponse(request, 400, { error: 'O corpo da requisição é inválido.' })
      if (body.status !== undefined && !leadStatuses.includes(body.status as LeadStatus)) {
        return jsonResponse(request, 400, { error: 'Status de lead inválido.' })
      }

      const changes: Partial<LeadUpdate> = {}
      if (body.status !== undefined) changes.status = body.status as LeadStatus
      if (body.notes !== undefined) changes.notes = typeof body.notes === 'string' ? body.notes : ''
      if (body.nextFollowUp !== undefined) {
        changes.nextFollowUp = typeof body.nextFollowUp === 'string' && body.nextFollowUp
          ? body.nextFollowUp
          : undefined
      }
      if (body.draftMessage !== undefined) changes.draftMessage = typeof body.draftMessage === 'string' ? body.draftMessage : ''

      const currentLead = await leadProvider.findById(updateMatch[1])
      const savedState = await persistenceStore.getSavedLeadState(accessToken, user.id, updateMatch[1])
      const originalLead = currentLead ? mergeSavedLeadState(currentLead, savedState) : undefined
      if (!originalLead) return jsonResponse(request, 404, { error: 'Lead não encontrado.' })

      return jsonResponse(request, 200, {
        data: await persistenceStore.saveLead(accessToken, user.id, { ...originalLead, ...changes }),
      })
    }

    if (url.pathname === '/api/sales' && request.method === 'POST') {
      const input = parseSaleInput(await parseBody(request))
      if (!input) return jsonResponse(request, 400, { error: 'Informe comércio, serviço, valor e data da venda.' })
      return jsonResponse(request, 201, { data: await persistenceStore.createSale(accessToken, user.id, input) })
    }

    return jsonResponse(request, 405, { error: 'Método não permitido.' })
  }

  if (request.method === 'GET' && url.pathname === '/api/saved-leads') {
    const savedStates = await persistenceStore.listSavedLeadStates(accessToken, user.id)
    const savedLeads = (
      await Promise.all(savedStates.map(async (savedState) => {
        try {
          const lead = await leadProvider.findById(savedState.leadId)
          return lead ? mergeSavedLeadState(lead, savedState) : undefined
        } catch {
          return undefined
        }
      }))
    ).filter((lead): lead is NonNullable<typeof lead> => Boolean(lead))
    return jsonResponse(request, 200, { data: savedLeads })
  }

  if (request.method === 'GET' && url.pathname === '/api/sales') {
    return jsonResponse(request, 200, { data: await persistenceStore.listSales(accessToken, user.id) })
  }

  if (request.method === 'GET' && url.pathname === '/api/leads') {
    const { opportunity, ...query } = getSearchParams(url)
    if (!query.city) return jsonResponse(request, 400, { error: 'O parâmetro city é obrigatório.' })
    if (query.city.length > 120 || query.segment.length > 120 || (query.pageToken && query.pageToken.length > 2048)) {
      return jsonResponse(request, 400, { error: 'A localização e o segmento precisam ser mais curtos.' })
    }
    if (opportunity && !opportunityTypes.includes(opportunity as OpportunityType)) {
      return jsonResponse(request, 400, { error: 'O filtro de oportunidade é inválido.' })
    }

    try {
      return jsonResponse(request, 200, {
        ...(await executeSearchLeads(leadProvider, {
          ...query,
          ...(opportunity ? { opportunity: opportunity as OpportunityType } : {}),
        })),
      })
    } catch (error) {
      return jsonResponse(request, 503, {
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

      console.error('DigiBusca API:', error)
      return jsonResponse(request, 500, { error: 'Não foi possível concluir a operação agora.' })
    }
  },
}
