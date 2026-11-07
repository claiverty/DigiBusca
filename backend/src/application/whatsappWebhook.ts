export const whatsappWebhookMaxBodyBytes = 1_000_000

export class WhatsAppWebhookBodyTooLargeError extends Error {
  constructor() {
    super('O corpo do webhook WhatsApp excede o limite permitido.')
    this.name = 'WhatsAppWebhookBodyTooLargeError'
  }
}

export type WhatsAppWebhookMessage = {
  phoneNumberId: string
  providerMessageId: string
  contactWaId: string
  contactName?: string
  occurredAt: string
  direction: 'inbound' | 'outbound'
  source: 'live' | 'history'
  messageType: string
  body?: string
}

export type WhatsAppWebhookStatus = {
  phoneNumberId: string
  providerMessageId: string
  recipientWaId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  occurredAt: string
}

export type WhatsAppWebhookContact = {
  contactWaId: string
  contactName?: string
  action: 'add' | 'remove'
  occurredAt: string
}

export type WhatsAppWebhookEvents = {
  messages: WhatsAppWebhookMessage[]
  statuses: WhatsAppWebhookStatus[]
  contacts: Array<{ phoneNumberId: string; contacts: WhatsAppWebhookContact[] }>
}
