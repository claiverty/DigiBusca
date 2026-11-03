export type WhatsAppCoexistenceSyncType = 'history' | 'smb_app_state_sync'

export type WhatsAppCoexistenceSyncResult = {
  requestId: string
}

export class WhatsAppCoexistenceSyncProviderError extends Error {
  constructor(
    message: string,
    readonly outcome: 'rejected' | 'unknown',
    readonly httpStatus?: number,
    readonly graphErrorCode?: number,
  ) {
    super(message)
    this.name = 'WhatsAppCoexistenceSyncProviderError'
  }
}

type GraphPayload = {
  request_id?: unknown
  error?: { code?: unknown }
}

export async function requestWhatsAppCoexistenceSync(
  phoneNumberId: string,
  syncType: WhatsAppCoexistenceSyncType,
  accessToken: string,
  graphApiVersion: string,
): Promise<WhatsAppCoexistenceSyncResult> {
  const url = new URL(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(phoneNumberId)}/smb_app_data`)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: syncType }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new WhatsAppCoexistenceSyncProviderError(
      'A Meta não confirmou se recebeu o pedido de sincronização. Não tente novamente sem verificar o estado na Meta.',
      'unknown',
    )
  }

  let payload: GraphPayload | undefined
  try {
    payload = await response.json() as GraphPayload
  } catch {
    payload = undefined
  }

  if (!response.ok) {
    const errorCode = typeof payload?.error?.code === 'number' && Number.isFinite(payload.error.code)
      ? payload.error.code
      : undefined
    throw new WhatsAppCoexistenceSyncProviderError(
      'A Meta recusou o pedido de sincronização. O DigiBusca bloqueou novas tentativas para evitar duplicidade.',
      'rejected',
      response.status,
      errorCode,
    )
  }

  const requestId = typeof payload?.request_id === 'string' && payload.request_id.trim()
    ? payload.request_id.trim()
    : undefined
  if (!requestId || requestId.length > 256) {
    throw new WhatsAppCoexistenceSyncProviderError(
      'A Meta aceitou a conexão, mas não confirmou o identificador da sincronização. Não tente novamente sem verificar o estado na Meta.',
      'unknown',
      response.status,
    )
  }

  return { requestId }
}
