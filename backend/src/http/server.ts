import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mockLeads } from '../data/mockLeads.js'
import type { SearchLeadsResponse } from '../contracts/lead.js'
import { searchLeads } from '../domain/searchLeads.js'

const port = Number(process.env.PORT ?? 3001)

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': 'http://127.0.0.1:5173',
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

const server = createServer((request, response) => {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Método não permitido.' })
    return
  }

  if (request.url?.startsWith('/api/health')) {
    sendJson(response, 200, { status: 'ok', service: 'digibusca-backend' })
    return
  }

  if (request.url?.startsWith('/api/leads')) {
    const query = getSearchParams(request)

    if (!query.city) {
      sendJson(response, 400, { error: 'O parâmetro city é obrigatório.' })
      return
    }

    const data = searchLeads(mockLeads, query)
    const payload: SearchLeadsResponse = {
      data,
      meta: { total: data.length, city: query.city, segment: query.segment },
    }

    sendJson(response, 200, payload)
    return
  }

  sendJson(response, 404, { error: 'Rota não encontrada.' })
})

server.listen(port, () => {
  console.log(`DigiBusca API em http://127.0.0.1:${port}`)
})
