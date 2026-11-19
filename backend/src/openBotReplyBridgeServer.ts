import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'
import {
  clearOpenBotAgentContext,
  getOpenBotDelivery,
  listOpenBotAgents,
  OpenBotAutomationError,
  sendOpenBotAgentMessage,
} from './integrations/openbotAutomationApi.js'

const maxBodyBytes = 32 * 1024
const agentIdPattern = /^[A-Za-z0-9_-]{1,128}$/
const deliveryIdPattern = /^[A-Za-z0-9._:-]{1,200}$/

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(JSON.stringify(value))
}

function authorized(request: IncomingMessage, expectedToken: string) {
  const value = request.headers.authorization
  if (typeof value !== 'string') return false
  const expected = Buffer.from(`Bearer ${expectedToken}`)
  const received = Buffer.from(value)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  let oversized = false
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > maxBodyBytes) {
      oversized = true
      chunks.length = 0
    } else if (!oversized) {
      chunks.push(value)
    }
  }
  if (oversized) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function safeStatus(error: unknown) {
  if (error instanceof OpenBotAutomationError) {
    if ([401, 403, 404, 409, 429].includes(error.status)) return error.status
    return error.status >= 500 ? 502 : 503
  }
  return 503
}

export function startOpenBotReplyBridgeServer() {
  const port = Number(process.env.OPENBOT_REPLY_BRIDGE_PORT ?? 4181)
  const bindHost = process.env.OPENBOT_REPLY_BRIDGE_BIND_HOST?.trim() || '127.0.0.1'
  const agentId = process.env.OPENBOT_REPLY_BRIDGE_AGENT_ID?.trim() ?? ''
  const token = process.env.OPENBOT_REPLY_BRIDGE_TOKEN?.trim() ?? ''
  const localOnly = bindHost === '127.0.0.1'
  const privateOpenBotHost = bindHost === '10.0.4.10' && port === 4181
  if (
    !Number.isInteger(port) || port < 1 || port > 65_535 ||
    (!localOnly && !privateOpenBotHost) ||
    !agentIdPattern.test(agentId) || agentId.startsWith('REPLACE_') || !/^[a-f0-9]{64}$/.test(token)
  ) {
    throw new Error('OpenBot reply bridge configuration is incomplete.')
  }

  const server = createServer(async (request, response) => {
    const expectedHost = `${bindHost}:${port}`
    if (request.headers.origin || request.headers.host !== expectedHost) {
      sendJson(response, 403, { error: 'request_origin_denied' })
      return
    }
    if (!authorized(request, token)) {
      sendJson(response, 401, { error: 'bridge_auth_required' })
      return
    }

    const requestUrl = new URL(request.url ?? '/', `http://${expectedHost}`)
    const requestedAgentId = requestUrl.searchParams.get('agentId')
    if (request.method === 'GET' && requestUrl.pathname === '/v1/agent') {
      if (requestedAgentId !== agentId) {
        sendJson(response, 403, { error: 'agent_not_allowlisted' })
        return
      }
      try {
        const agent = (await listOpenBotAgents()).find((candidate) => candidate.id === agentId)
        sendJson(response, 200, { agentId, agentName: agent?.name ?? null, connected: Boolean(agent) })
      } catch {
        sendJson(response, 200, { agentId, agentName: null, connected: false })
      }
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/messages') {
      const body = await readJson(request)
      if (
        !body || body.agentId !== agentId || typeof body.text !== 'string' ||
        body.text.length === 0 || body.text.length > 24_000 ||
        typeof body.clientMessageId !== 'string' || body.clientMessageId.length < 1 || body.clientMessageId.length > 128
      ) {
        sendJson(response, 400, { error: 'invalid_message_request' })
        return
      }
      try {
        const delivery = await sendOpenBotAgentMessage(agentId, body.text, body.clientMessageId)
        sendJson(response, 202, delivery)
      } catch (error) {
        sendJson(response, safeStatus(error), { error: 'openbot_message_unavailable' })
      }
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/v1/context/clear') {
      const body = await readJson(request)
      if (!body || body.agentId !== agentId) {
        sendJson(response, 400, { error: 'invalid_context_request' })
        return
      }
      try {
        await clearOpenBotAgentContext(agentId)
        sendJson(response, 200, { ok: true })
      } catch (error) {
        sendJson(response, safeStatus(error), { error: 'openbot_context_clear_unavailable' })
      }
      return
    }

    const deliveryMatch = requestUrl.pathname.match(/^\/v1\/deliveries\/([^/]+)$/)
    if (request.method === 'GET' && deliveryMatch) {
      let deliveryId: string
      try {
        deliveryId = decodeURIComponent(deliveryMatch[1] ?? '')
      } catch {
        sendJson(response, 400, { error: 'invalid_delivery_id' })
        return
      }
      if (requestedAgentId !== agentId || !deliveryIdPattern.test(deliveryId)) {
        sendJson(response, 403, { error: 'delivery_not_allowlisted' })
        return
      }
      try {
        sendJson(response, 200, await getOpenBotDelivery(agentId, deliveryId))
      } catch (error) {
        sendJson(response, safeStatus(error), { error: 'openbot_delivery_unavailable' })
      }
      return
    }

    sendJson(response, 404, { error: 'bridge_route_not_found' })
  })

  server.listen(port, bindHost)
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const server = startOpenBotReplyBridgeServer()
    server.on('listening', () => {
      console.info('OpenBot WhatsApp reply bridge listening on its configured private interface.')
    })
    server.on('error', () => {
      console.error('OpenBot WhatsApp reply bridge could not start.')
      process.exitCode = 1
    })
  } catch {
    console.error('OpenBot WhatsApp reply bridge configuration is invalid.')
    process.exitCode = 1
  }
}
