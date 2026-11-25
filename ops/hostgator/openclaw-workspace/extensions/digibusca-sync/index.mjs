import { createHash, randomInt } from 'node:crypto'
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'

const pluginId = 'digibusca-sync'
const configuredAgentId = process.env.OPENCLAW_CRISTHIAN_AGENT_ID?.trim() || 'main'

function e164(value) {
  if (typeof value !== 'string' || value.includes('@g.us')) return undefined
  const raw = value.split('@')[0]
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return undefined
  return `+${digits}`
}

function channelIsWhatsApp(...sources) {
  const candidates = sources.flatMap((source) => [source?.messageProvider, source?.channel, source?.channelId])
  return candidates.some((value) => typeof value === 'string' && value.toLowerCase() === 'whatsapp')
}

function sessionKeyFrom(...sources) {
  for (const source of sources) {
    if (typeof source?.sessionKey === 'string' && source.sessionKey) return source.sessionKey
  }
  return undefined
}

function agentIdFromSessionKey(sessionKey) {
  return typeof sessionKey === 'string' ? /^agent:([^:]+):/.exec(sessionKey)?.[1] : undefined
}

function inboundTimestampToIso(...values) {
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const milliseconds = value < 1_000_000_000_000 ? value * 1_000 : value
    if (milliseconds < Date.UTC(2000, 0, 1) || milliseconds > Date.now() + 5 * 60_000) continue
    return new Date(milliseconds).toISOString()
  }
  return undefined
}

function outboundMessageIdentity(event, context, recipientE164, content) {
  const messageId = typeof event?.messageId === 'string' ? event.messageId.trim() : ''
  if (messageId) return messageId.slice(0, 240)

  const runId = typeof context?.runId === 'string' && context.runId
    ? context.runId
    : typeof event?.runId === 'string' && event.runId
      ? event.runId
      : undefined
  if (!runId) return undefined

  // OpenClaw may omit a channel message ID. A digest of the stable run and
  // logical payload keeps webhook retries idempotent without inventing IDs.
  const digest = createHash('sha256')
    .update(`${runId}\0${recipientE164}\0${content}`)
    .digest('hex')
    .slice(0, 48)
  return `run-${digest}`
}

function bridgeConfig() {
  const baseUrl = process.env.DIGIBUSCA_BACKEND_URL?.trim().replace(/\/+$/, '')
  const token = process.env.OPENCLAW_BRIDGE_TOKEN?.trim()
  const phoneNumberId = process.env.OPENCLAW_PHONE_NUMBER_ID?.trim()
  const operatorE164 = e164(process.env.OPENCLAW_OPERATOR_E164)
  if (!baseUrl || !token || !phoneNumberId || !operatorE164) return undefined
  return { baseUrl, token, phoneNumberId, operatorE164 }
}

async function postBridge(path, payload, { attempts = 1, timeoutMs = 5_000 } = {}) {
  const config = bridgeConfig()
  if (!config) throw new Error('bridge_not_configured')
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${config.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-digibusca-openclaw-token': config.token,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (response.ok) return response.json()
      lastError = new Error(`bridge_http_${response.status}`)
      if ((response.status < 500 && response.status !== 429) || attempt === attempts - 1) throw lastError
    } catch (error) {
      lastError = error
      const isPermanentHttpError = error instanceof Error && /^bridge_http_(?!429)4\d{2}$/.test(error.message)
      if (isPermanentHttpError || attempt === attempts - 1) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)))
  }
  throw lastError ?? new Error('bridge_request_failed')
}

function blocked() {
  // before_dispatch is a claim hook; claiming without text safely drops the turn.
  return { handled: true }
}

function replyCooldownMs(content) {
  const normalized = content
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Keep urgent requests and clear scheduling confirmations moving quickly.
  if (/\b(urgente|emergencia|nao funciona|parou|sem acesso|preciso agora)\b/.test(normalized)) {
    return randomInt(1_500, 7_001)
  }
  if (/^(sim|confirmo|confirmado|confirmada|pode marcar|pode agendar|fechado|fechou|combinado|pode ser|ok|okay|certo|perfeito|beleza|claro)(\b.*)?$/.test(normalized)) {
    return randomInt(1_500, 7_001)
  }

  // Most replies take a few seconds; a smaller share takes longer, and only
  // a few take around one or two minutes. This applies to inbound replies only.
  const roll = randomInt(0, 100)
  if (roll < 35) return randomInt(3_000, 12_001)
  if (roll < 75) return randomInt(12_000, 30_001)
  if (roll < 95) return randomInt(30_000, 60_001)
  return randomInt(60_000, 120_001)
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default definePluginEntry({
  id: pluginId,
  name: 'DigiBusca Sync',
  description: 'Aplica regras de atendimento e autorização de envio do DigiBusca.',
  register(api) {
    api.on('before_dispatch', async (event, context) => {
      if (!channelIsWhatsApp(event, context)) return
      const config = bridgeConfig()
      if (!config) return blocked()

      const senderE164 = e164(event?.senderId || context?.senderId)
      if (!senderE164) return blocked()

      // Mensagens do titular são comandos ao Cristhian; o bridge só espelha clientes.
      if (senderE164 === config.operatorE164) return

      const sessionKey = sessionKeyFrom(event, context)
      const sessionAgentId = agentIdFromSessionKey(sessionKey)
      const messageId = typeof event?.messageId === 'string' && event.messageId
        ? event.messageId
        : typeof context?.messageId === 'string' && context.messageId
          ? context.messageId
          : undefined
      const occurredAt = inboundTimestampToIso(event?.timestamp) ?? new Date().toISOString()
      const content = typeof event?.content === 'string'
        ? event.content.trim().slice(0, 10_000)
        : typeof event?.body === 'string'
          ? event.body.trim().slice(0, 10_000)
          : ''
      const isGroup = event?.isGroup === true
      if (sessionAgentId && sessionAgentId !== configuredAgentId) return blocked()
      if (isGroup || !sessionKey || !messageId || !content) return blocked()

      try {
        const result = await postBridge('/api/openclaw/inbound', {
          phoneNumberId: config.phoneNumberId,
          senderE164,
          providerMessageId: messageId.slice(0, 240),
          openClawSessionKey: sessionKey.slice(0, 512),
          content,
          messageType: 'text',
          occurredAt,
        })
        if (result?.dispatch !== true) return blocked()

        await wait(replyCooldownMs(content))
        return undefined
      } catch (error) {
        const code = error instanceof Error ? error.message : 'unknown_error'
        console.warn(`[${pluginId}] inbound dispatch blocked (${code})`)
        return blocked()
      }
    }, { timeoutMs: 130_000 })

    api.on('message_sending', async (event, context) => {
      if (!channelIsWhatsApp(context)) return
      const config = bridgeConfig()
      const recipientE164 = e164(event?.to)
      if (!config || !recipientE164 || typeof event?.content !== 'string' || !event.content.trim()) {
        return { cancel: true, cancelReason: `${pluginId}_outbound_identity_unavailable` }
      }
      try {
        const result = await postBridge('/api/openclaw/authorize-outbound', {
          phoneNumberId: config.phoneNumberId,
          recipientE164,
          content: event.content.slice(0, 10_000),
          ...(typeof context?.runId === 'string' ? { openClawRunId: context.runId.slice(0, 240) } : {}),
          ...(typeof context?.sessionKey === 'string' ? { openClawSessionKey: context.sessionKey.slice(0, 512) } : {}),
        })
        if (result?.allowed === true) return
        return { cancel: true, cancelReason: `${pluginId}_outbound_policy_block` }
      } catch {
        return { cancel: true, cancelReason: `${pluginId}_outbound_authorization_unavailable` }
      }
    }, { timeoutMs: 12_000 })

    api.on('message_sent', async (event, context) => {
      if (!channelIsWhatsApp(context)) return
      const config = bridgeConfig()
      const recipientE164 = e164(event?.to)
      if (!config || !recipientE164 || recipientE164 === config.operatorE164) return
      const content = typeof event?.content === 'string' ? event.content.slice(0, 10_000) : ''
      if (!content) return
      const providerMessageId = outboundMessageIdentity(event, context, recipientE164, content)
      if (!providerMessageId) {
        console.warn(`[${pluginId}] outbound result not synchronized (stable message identity unavailable)`)
        return
      }
      try {
        await postBridge('/api/openclaw/outbound', {
          phoneNumberId: config.phoneNumberId,
          recipientE164,
          providerMessageId,
          ...(typeof context?.runId === 'string' ? { openClawRunId: context.runId.slice(0, 240) } : {}),
          ...(typeof context?.sessionKey === 'string' ? { openClawSessionKey: context.sessionKey.slice(0, 512) } : {}),
          content,
          messageType: 'text',
          occurredAt: new Date().toISOString(),
          success: event?.success === true,
        }, { attempts: 3, timeoutMs: 2_000 })
      } catch {
        // O hook é observacional; não registre conteúdo nem credenciais em logs.
      }
    }, { timeoutMs: 12_000 })
  },
})
