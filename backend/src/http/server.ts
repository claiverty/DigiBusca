import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { executeSearchLeads } from '../application/searchLeads.js'
import { mockLeads } from '../data/mockLeads.js'
import { MockLeadProvider } from '../integrations/mockLeadProvider.js'
import type { LeadStatus, LeadUpdate } from '../contracts/lead.js'
import type { CreateSaleInput } from '../contracts/sale.js'
import { SalesStore } from '../data/salesStore.js'

const port = Number(process.env.PORT ?? 3001)
const leadProvider = new MockLeadProvider(mockLeads)
const savedLeads = new Map<string, (typeof mockLeads)[number]>()
const salesStore = new SalesStore()
const leadStatuses: LeadStatus[] = ['Novo', 'Contatado', 'Respondeu', 'Proposta', 'Ganhou', 'Perdeu']
const allowedOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  const origin = response.req.headers.origin
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : 'http://127.0.0.1:5173',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''

    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
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
  if (typeof businessName !== 'string' || !businessName.trim() || typeof service !== 'string' || !service.trim() || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || typeof soldAt !== 'string' || !soldAt) {
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
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, null)
    return
  }

  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (request.method !== 'GET') {
    const saveMatch = requestUrl.pathname.match(/^\/api\/leads\/([^/]+)\/save$/)
    const updateMatch = requestUrl.pathname.match(/^\/api\/leads\/([^/]+)$/)
    const salesMatch = requestUrl.pathname === '/api/sales'

    if (saveMatch && (request.method === 'POST' || request.method === 'DELETE')) {
      const lead = await leadProvider.findById(saveMatch[1])

      if (!lead) {
        sendJson(response, 404, { error: 'Lead não encontrado.' })
        return
      }

      if (request.method === 'POST') {
        savedLeads.set(lead.id, lead)
        sendJson(response, 200, { data: lead })
        return
      }

      savedLeads.delete(lead.id)
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
      if (body.nextFollowUp !== undefined) changes.nextFollowUp = typeof body.nextFollowUp === 'string' ? body.nextFollowUp : undefined
      if (body.draftMessage !== undefined) changes.draftMessage = typeof body.draftMessage === 'string' ? body.draftMessage : ''

      const updatedLead = await leadProvider.update(updateMatch[1], changes)

      if (!updatedLead) {
        sendJson(response, 404, { error: 'Lead não encontrado.' })
        return
      }

      if (savedLeads.has(updatedLead.id)) {
        savedLeads.set(updatedLead.id, updatedLead)
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

      sendJson(response, 201, { data: salesStore.create(input) })
      return
    }

    sendJson(response, 405, { error: 'Método não permitido.' })
    return
  }

  if (request.url?.startsWith('/api/health')) {
    sendJson(response, 200, { status: 'ok', service: 'digibusca-backend' })
    return
  }

  if (requestUrl.pathname === '/api/saved-leads') {
    sendJson(response, 200, { data: Array.from(savedLeads.values()) })
    return
  }

  if (requestUrl.pathname === '/api/sales') {
    sendJson(response, 200, { data: salesStore.list() })
    return
  }

  if (requestUrl.pathname === '/api/leads') {
    const query = getSearchParams(request)

    if (!query.city) {
      sendJson(response, 400, { error: 'O parâmetro city é obrigatório.' })
      return
    }

    const payload = await executeSearchLeads(leadProvider, query)

    sendJson(response, 200, payload)
    return
  }

  sendJson(response, 404, { error: 'Rota não encontrada.' })
})

server.listen(port, () => {
  console.log(`DigiBusca API em http://127.0.0.1:${port}`)
})
