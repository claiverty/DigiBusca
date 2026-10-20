import type { getWhatsAppCloudConfig } from '../config/supabase.js'

type WhatsAppCloudConfig = NonNullable<ReturnType<typeof getWhatsAppCloudConfig>>

export class WhatsAppCloudApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function sendApprovedTemplateMessage(
  config: WhatsAppCloudConfig,
  phone: string,
  message: string,
): Promise<string> {
  let response: Response
  try {
    response = await fetch(
      `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone,
          type: 'template',
          template: {
            name: config.templateName,
            language: { code: config.templateLanguage },
            components: [{
              type: 'body',
              parameters: [{ type: 'text', text: message }],
            }],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    )
  } catch {
    throw new WhatsAppCloudApiError('Não foi possível conectar à API oficial do WhatsApp.', 502)
  }

  if (!response.ok) {
    throw new WhatsAppCloudApiError(
      response.status === 429
        ? 'A Meta limitou temporariamente os envios. Tente novamente mais tarde.'
        : 'A Meta recusou o envio. Confira o número, o template aprovado e as configurações da API.',
      response.status,
    )
  }

  let payload: { messages?: Array<{ id?: string }> }
  try {
    payload = await response.json() as { messages?: Array<{ id?: string }> }
  } catch {
    throw new WhatsAppCloudApiError('A API do WhatsApp retornou uma resposta inválida.', 502)
  }
  const messageId = payload.messages?.[0]?.id
  if (!messageId) throw new WhatsAppCloudApiError('A API não confirmou o envio da mensagem.', 502)
  return messageId
}
