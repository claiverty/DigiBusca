import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { executeSearchLeads } from '../application/searchLeads.js'
import { mockLeads } from '../data/mockLeads.js'
import { MockLeadProvider } from '../integrations/mockLeadProvider.js'

const port = Number(process.env.PORT ?? 3001)
const leadProvider = new MockLeadProvider(mockLeads)
const savedLeads = new Map<string, (typeof mockLeads)[number]>()

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': 'http://127.0.0.1:5173',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
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
