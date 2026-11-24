import { randomUUID } from 'node:crypto'
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'

const pluginId = 'digibusca-sync'
const configuredAgentId = process.env.OPENCLAW_CRISTHIAN_AGENT_ID?.trim() || 'main'
const pendingInboundByRun = new Map()

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

function runIdFrom(...sources) {
  for (const source of sources) {
    if (typeof source?.runId === 'string' && source.runId) return source.runId
  }
  return undefined
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

function prunePendingInbound() {
  const now = Date.now()
  for (const [runId, entry] of pendingInboundByRun) {
    if (entry.expiresAt <= now) pendingInboundByRun.delete(runId)
  }
  while (pendingInboundByRun.size > 256) {
    const oldestRunId = pendingInboundByRun.keys().next().value
    if (typeof oldestRunId !== 'string') break
    pendingInboundByRun.delete(oldestRunId)
  }
}

function bridgeConfig() {
  const baseUrl = process.env.DIGIBUSCA_BACKEND_URL?.trim().replace(/\/+$/, '')
  const token = process.env.OPENCLAW_BRIDGE_TOKEN?.trim()
  const phoneNumberId = process.env.OPENCLAW_PHONE_NUMBER_ID?.trim()
  const operatorE164 = e164(process.env.OPENCLAW_OPERATOR_E164)
  if (!baseUrl || !token || !phoneNumberId || !operatorE164) return undefined
  return { baseUrl, token, phoneNumberId, operatorE164 }
}

async function postBridge(path, payload) {
  const config = bridgeConfig()
  if (!config) throw new Error('bridge_not_configured')
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-digibusca-openclaw-token': config.token,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`bridge_http_${response.status}`)
  return response.json()
}

function blocked(reason) {
  return { outcome: 'block', reason: `${pluginId}_${reason}` }
}

export default definePluginEntry({
  id: pluginId,
  name: 'DigiBusca Sync',
  description: 'Aplica regras de atendimento e autorização de envio do DigiBusca.',
  register(api) {
    api.on('inbound_claim', (event, context) => {
      if (!channelIsWhatsApp(event, context)) return
      const runId = runIdFrom(event, context)
      if (typeof runId !== 'string' || !runId) return
      const senderE164 = e164(event?.senderId || context?.senderId)
      const operatorE164 = bridgeConfig()?.operatorE164
      if (senderE164 && operatorE164 && senderE164 === operatorE164) return

      const messageId = typeof event?.messageId === 'string' && event.messageId
        ? event.messageId
        : typeof event?.providerUpdate?.messageId === 'string'
          ? event.providerUpdate.messageId
          : undefined
      const occurredAt = inboundTimestampToIso(event?.timestamp, event?.providerUpdate?.messageTimestamp)
      const content = typeof event?.content === 'string' ? event.content.trim().slice(0, 10_000) : ''
      const isGroup = event?.isGroup === true || String(event?.threadId ?? '').includes('@g.us')
      const agentId = context?.agentId ?? event?.agentId
      let reason
      if (agentId !== configuredAgentId) reason = 'unexpected_agent'
      else if (isGroup) reason = 'group_message'
      else if (!senderE164) reason = 'inbound_identity_unavailable'
      else if (!messageId || !occurredAt || !content) reason = 'inbound_message_metadata_unavailable'

      prunePendingInbound()
      pendingInboundByRun.set(runId, {
        ...(senderE164 ? { senderE164 } : {}),
        ...(messageId ? { providerMessageId: messageId.slice(0, 240) } : {}),
        ...(occurredAt ? { occurredAt } : {}),
        ...(content ? { content } : {}),
        ...(reason ? { reason } : {}),
        expiresAt: Date.now() + 2 * 60_000,
      })
    }, { timeoutMs: 2_000 })

    api.on('before_agent_run', async (event, context) => {
      if (!channelIsWhatsApp(event, context)) return
      if (context?.agentId !== configuredAgentId) return blocked('unexpected_agent')

      const config = bridgeConfig()
      const senderE164 = e164(context?.senderId)
      if (!config || !senderE164) return blocked('inbound_identity_unavailable')

      // Mensagens do titular são comandos ao Cristhian; o bridge só espelha clientes.
      if (senderE164 === config.operatorE164) return

      const runId = runIdFrom(event, context) ?? ''
      const inbound = runId ? pendingInboundByRun.get(runId) : undefined
      if (runId) pendingInboundByRun.delete(runId)
      if (!inbound) return blocked('inbound_metadata_unavailable')
      if (inbound.reason) return blocked(inbound.reason)
      if (senderE164 !== inbound.senderE164) return blocked('inbound_identity_mismatch')

      try {
        const result = await postBridge('/api/openclaw/inbound', {
          phoneNumberId: config.phoneNumberId,
          senderE164: inbound.senderE164,
          providerMessageId: inbound.providerMessageId,
          openClawRunId: runId.slice(0, 240),
          ...(typeof context?.sessionKey === 'string' ? { openClawSessionKey: context.sessionKey.slice(0, 512) } : {}),
          content: inbound.content,
          messageType: 'text',
          occurredAt: inbound.occurredAt,
        })
        return result?.dispatch === true ? undefined : blocked('inbound_policy_block')
      } catch {
        return blocked('inbound_bridge_unavailable')
      }
    }, { timeoutMs: 12_000 })

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
      const providerMessageId = typeof event?.messageId === 'string' && event.messageId
        ? event.messageId.slice(0, 240)
        : `hook-${randomUUID()}`
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
        })
      } catch {
        // O hook é observacional; não registre conteúdo nem credenciais em logs.
      }
    }, { timeoutMs: 12_000 })
  },
})
