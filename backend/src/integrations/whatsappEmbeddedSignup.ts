export type WhatsAppCoexistencePhone = {
  id: string
  display_phone_number?: string
  verified_name?: string
  is_on_biz_app?: boolean
  platform_type?: string
}

export class WhatsAppEmbeddedSignupError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'WhatsAppEmbeddedSignupError'
  }
}

type EmbeddedSignupConfig = {
  appId: string
  appSecret: string
  graphApiVersion: string
}

type GraphErrorPayload = { error?: { code?: number; type?: string } }

async function readGraphJson<T>(response: Response): Promise<T | undefined> {
  try {
    return await response.json() as T
  } catch {
    return undefined
  }
}

export async function exchangeWhatsAppEmbeddedSignupCode(
  code: string,
  config: EmbeddedSignupConfig,
): Promise<{ accessToken: string; expiresAt?: string }> {
  const url = new URL(`https://graph.facebook.com/${config.graphApiVersion}/oauth/access_token`)
  url.searchParams.set('client_id', config.appId)
  url.searchParams.set('client_secret', config.appSecret)
  url.searchParams.set('code', code)

  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  } catch {
    throw new WhatsAppEmbeddedSignupError('Não foi possível trocar o código da Meta agora.', 502)
  }

  const payload = await readGraphJson<{ access_token?: unknown; expires_in?: unknown } & GraphErrorPayload>(response)
  const accessToken = typeof payload?.access_token === 'string' && payload.access_token.trim()
    ? payload.access_token
    : undefined
  if (!response.ok || !accessToken) {
    throw new WhatsAppEmbeddedSignupError('A Meta não aceitou o código deste Embedded Signup. Reinicie a conexão.', 422)
  }

  const expiresIn = typeof payload?.expires_in === 'number' && Number.isFinite(payload.expires_in) && payload.expires_in > 0
    ? payload.expires_in
    : undefined
  const expiresAt = expiresIn !== undefined
    ? new Date(Date.now() + expiresIn * 1_000).toISOString()
    : undefined
  return { accessToken, ...(expiresAt ? { expiresAt } : {}) }
}

export async function findCoexistencePhoneNumber(
  wabaId: string,
  requestedPhoneNumberId: string | undefined,
  accessToken: string,
  graphApiVersion: string,
): Promise<WhatsAppCoexistencePhone> {
  const url = new URL(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(wabaId)}/phone_numbers`)
  url.searchParams.set('fields', 'id,display_phone_number,verified_name,is_on_biz_app,platform_type')
  url.searchParams.set('limit', '100')

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new WhatsAppEmbeddedSignupError('Não foi possível validar o número retornado pela Meta.', 502)
  }

  const payload = await readGraphJson<{ data?: unknown } & GraphErrorPayload>(response)
  if (!response.ok || !Array.isArray(payload?.data)) {
    throw new WhatsAppEmbeddedSignupError('A Meta não permitiu validar os números desta conta WhatsApp.', 422)
  }

  const phoneNumbers = payload.data.filter((value): value is WhatsAppCoexistencePhone => (
    typeof value === 'object' && value !== null &&
    typeof (value as WhatsAppCoexistencePhone).id === 'string' &&
    /^\d{1,128}$/.test((value as WhatsAppCoexistencePhone).id)
  ))
  const candidates = phoneNumbers.filter((phone) => (
    phone.is_on_biz_app === true &&
    (!requestedPhoneNumberId || phone.id === requestedPhoneNumberId)
  ))

  if (candidates.length !== 1) {
    throw new WhatsAppEmbeddedSignupError(
      candidates.length === 0
        ? 'A Meta não confirmou um número ativo no WhatsApp Business App nesta conta.'
        : 'A Meta retornou mais de um número de coexistência. Reinicie o fluxo e informe o número escolhido.',
      409,
    )
  }
  return candidates[0]
}
