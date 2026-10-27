import {
  getWhatsAppWebhookSecrets,
  isWhatsAppWebhookPersistenceConfigured,
} from '../config/supabase.js'
import { WhatsAppStore } from '../data/whatsappStore.js'
import {
  parseWhatsAppWebhookEvents,
  verifyWhatsAppWebhookSignature,
  matchesWhatsAppWebhookVerifyToken,
  whatsappWebhookMaxBodyBytes,
  WhatsAppWebhookPayloadError,
} from './whatsappWebhook.js'

export class WhatsAppWebhookBodyTooLargeError extends Error {
  constructor() {
    super('O corpo do webhook WhatsApp excede o limite permitido.')
    this.name = 'WhatsAppWebhookBodyTooLargeError'
  }
}

export type WhatsAppWebhookHttpResult = {
  status: number
  contentType: 'application/json; charset=utf-8' | 'text/plain; charset=utf-8'
  body: string
}

function jsonResult(status: number, payload: unknown): WhatsAppWebhookHttpResult {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(payload),
  }
}

export async function handleWhatsAppWebhook(
  method: string,
  url: URL,
  signatureHeader: string | null | undefined,
  readRawBody: () => Promise<Uint8Array>,
): Promise<WhatsAppWebhookHttpResult> {
  const secrets = getWhatsAppWebhookSecrets()

  if (method === 'GET') {
    if (!secrets.verifyToken) return jsonResult(503, { error: 'A verificação do webhook WhatsApp ainda não está configurada.' })

    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (
      mode !== 'subscribe' || !token || token.length > 512 || !challenge || challenge.length > 4_096 ||
      !(await matchesWhatsAppWebhookVerifyToken(token, secrets.verifyToken))
    ) {
      return jsonResult(403, { error: 'A verificação do webhook WhatsApp foi recusada.' })
    }

    return {
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: challenge,
    }
  }

  if (method !== 'POST') return jsonResult(405, { error: 'Método não permitido.' })
  if (!secrets.appSecret) return jsonResult(503, { error: 'A validação do webhook WhatsApp ainda não está configurada.' })
  if (!isWhatsAppWebhookPersistenceConfigured()) {
    return jsonResult(503, { error: 'A persistência segura do webhook WhatsApp ainda não está configurada.' })
  }

  let rawBody: Uint8Array
  try {
    rawBody = await readRawBody()
  } catch (error) {
    if (error instanceof WhatsAppWebhookBodyTooLargeError) return jsonResult(413, { error: error.message })
    return jsonResult(400, { error: 'Não foi possível ler o corpo do webhook WhatsApp.' })
  }

  if (rawBody.byteLength > whatsappWebhookMaxBodyBytes) {
    return jsonResult(413, { error: 'O corpo do webhook WhatsApp excede o limite permitido.' })
  }

  if (!(await verifyWhatsAppWebhookSignature(rawBody, signatureHeader, secrets.appSecret))) {
    return jsonResult(401, { error: 'A assinatura do webhook WhatsApp é inválida.' })
  }

  let events
  try {
    events = parseWhatsAppWebhookEvents(rawBody)
  } catch (error) {
    if (error instanceof WhatsAppWebhookPayloadError) return jsonResult(400, { error: error.message })
    throw error
  }

  try {
    await new WhatsAppStore().persistWebhookEvents(events)
  } catch {
    // Return a retryable response without logging provider payloads or database details.
    return jsonResult(500, { error: 'Não foi possível persistir o evento do webhook WhatsApp.' })
  }

  return jsonResult(200, { status: 'accepted' })
}
