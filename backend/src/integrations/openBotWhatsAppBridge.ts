import { getWhatsAppOpenBotBridgeConfig } from '../config/supabase.js'

export type OpenBotWhatsAppAgentStatus = {
  agentId: string
  agentName: string | null
  connected: boolean
}

export type OpenBotWhatsAppDelivery = {
  id: string
  status: 'queued' | 'starting' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled'
  answer: string | null
}

export class OpenBotWhatsAppBridgeError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
    this.name = 'OpenBotWhatsAppBridgeError'
  }
}

async function requestBridge<T>(path: string, init?: RequestInit): Promise<T> {
  const config = getWhatsAppOpenBotBridgeConfig()
  if (!config) throw new OpenBotWhatsAppBridgeError(503, 'bridge_not_configured')

  let response: Response
  try {
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${config.token}`)
    if (init?.body) headers.set('Content-Type', 'application/json')
    response = await fetch(new URL(path.replace(/^\//, ''), config.baseUrl), {
      ...init,
      headers,
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    throw new OpenBotWhatsAppBridgeError(503, 'bridge_unreachable')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }
  if (!response.ok) {
    const code = typeof payload === 'object' && payload !== null &&
      typeof (payload as Record<string, unknown>).error === 'string'
      ? (payload as Record<string, unknown>).error as string
      : 'bridge_request_failed'
    throw new OpenBotWhatsAppBridgeError(response.status, code)
  }
  return payload as T
}

export async function getOpenBotWhatsAppAgentStatus(agentId: string): Promise<OpenBotWhatsAppAgentStatus> {
  const payload = await requestBridge<unknown>(`v1/agent?agentId=${encodeURIComponent(agentId)}`)
  if (typeof payload !== 'object' || payload === null) {
    throw new OpenBotWhatsAppBridgeError(502, 'bridge_status_invalid')
  }
  const value = payload as Record<string, unknown>
  if (
    value.agentId !== agentId || typeof value.connected !== 'boolean' ||
    (value.agentName !== null && typeof value.agentName !== 'string')
  ) throw new OpenBotWhatsAppBridgeError(502, 'bridge_status_invalid')

  return { agentId, agentName: value.agentName as string | null, connected: value.connected }
}

export async function sendOpenBotWhatsAppMessage(
  agentId: string,
  text: string,
  clientMessageId: string,
): Promise<{ deliveryId: string; agentName: string }> {
  const payload = await requestBridge<unknown>('v1/messages', {
    method: 'POST',
    body: JSON.stringify({ agentId, text, clientMessageId }),
  })
  if (typeof payload !== 'object' || payload === null) {
    throw new OpenBotWhatsAppBridgeError(502, 'bridge_receipt_invalid')
  }
  const value = payload as Record<string, unknown>
  if (typeof value.deliveryId !== 'string' || typeof value.agentName !== 'string') {
    throw new OpenBotWhatsAppBridgeError(502, 'bridge_receipt_invalid')
  }
  return { deliveryId: value.deliveryId, agentName: value.agentName }
}

export async function getOpenBotWhatsAppDelivery(agentId: string, deliveryId: string): Promise<OpenBotWhatsAppDelivery> {
  const payload = await requestBridge(
    `v1/deliveries/${encodeURIComponent(deliveryId)}?agentId=${encodeURIComponent(agentId)}`,
  )
  if (typeof payload !== 'object' || payload === null) {
    throw new OpenBotWhatsAppBridgeError(502, 'bridge_delivery_invalid')
  }
  const value = payload as Record<string, unknown>
  const statuses: OpenBotWhatsAppDelivery['status'][] = ['queued', 'starting', 'running', 'completed', 'failed', 'interrupted', 'cancelled']
  if (
    typeof value.id !== 'string' ||
    !statuses.includes(value.status as OpenBotWhatsAppDelivery['status']) ||
    (value.answer !== null && typeof value.answer !== 'string')
  ) throw new OpenBotWhatsAppBridgeError(502, 'bridge_delivery_invalid')
  return { id: value.id, status: value.status as OpenBotWhatsAppDelivery['status'], answer: value.answer as string | null }
}

export async function clearOpenBotWhatsAppContext(agentId: string) {
  const payload = await requestBridge('v1/context/clear', {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  })
  if (typeof payload !== 'object' || payload === null || (payload as Record<string, unknown>).ok !== true) {
    throw new OpenBotWhatsAppBridgeError(502, 'bridge_context_clear_failed')
  }
}
