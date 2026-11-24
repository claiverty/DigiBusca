import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { getAdditionalAllowedAppOrigins, getGoogleCalendarOAuthConfig, getGoogleCalendarOAuthStateSecret } from '../config/supabase.js'
import {
  disconnectGoogleCalendarStoredOAuthClient,
  disconnectGoogleCalendarStoredConnection,
  getGoogleCalendarStoredOAuthClient,
  getGoogleCalendarStoredConnection,
  saveGoogleCalendarStoredOAuthClient,
  saveGoogleCalendarStoredConnection,
  GoogleCalendarStorageError,
} from '../data/googleCalendarConnectionStore.js'

const googleOAuthEndpoint = 'https://oauth2.googleapis.com'
const googleCalendarEndpoint = 'https://www.googleapis.com/calendar/v3'
const defaultGoogleCalendarRedirectUri = 'https://whatsapp-api.digiuptech.com.br/api/integrations/google-calendar/callback'
const googleCalendarScopes = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.freebusy',
]

export class GoogleCalendarIntegrationError extends Error {
  constructor(readonly reason: 'not_configured' | 'not_connected' | 'invalid_time' | 'invalid_oauth_client' | 'busy' | 'authorization_expired' | 'provider_unavailable' | 'invalid_state') {
    super(reason)
    this.name = 'GoogleCalendarIntegrationError'
  }
}

type GoogleCalendarState = { userId: string; returnOrigin: string; issuedAt: number; nonce: string }
type CalendarOAuthCallbackResult = { returnOrigin: string; result: 'connected' | 'cancelled' | 'error' }

async function oauthConfig(userId: string) {
  const config = getGoogleCalendarOAuthConfig()
  if (config) return config
  const stateSecret = getGoogleCalendarOAuthStateSecret()
  if (!stateSecret) throw new GoogleCalendarIntegrationError('not_configured')
  let storedClient
  try {
    storedClient = await getGoogleCalendarStoredOAuthClient(userId)
  } catch (error) {
    if (error instanceof GoogleCalendarStorageError && error.reason === 'migration_missing') {
      throw new GoogleCalendarIntegrationError('not_configured')
    }
    throw error
  }
  if (!storedClient) {
    throw new GoogleCalendarIntegrationError('not_configured')
  }
  return {
    clientId: storedClient.clientId,
    clientSecret: storedClient.clientSecret,
    redirectUri: defaultGoogleCalendarRedirectUri,
  }
}

function encodeBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url')
}

function stateSignature(payload: string, signingSecret: Buffer) {
  return createHmac('sha256', signingSecret).update(payload).digest('base64url')
}

function statePayload(userId: string, returnOrigin: string): GoogleCalendarState {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new GoogleCalendarIntegrationError('invalid_state')
  let parsedOrigin: URL
  try {
    parsedOrigin = new URL(returnOrigin)
  } catch {
    throw new GoogleCalendarIntegrationError('invalid_state')
  }
  if (parsedOrigin.origin !== returnOrigin || !getAdditionalAllowedAppOrigins().has(returnOrigin) && !['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'].includes(returnOrigin)) {
    throw new GoogleCalendarIntegrationError('invalid_state')
  }
  return { userId, returnOrigin, issuedAt: Date.now(), nonce: randomBytes(18).toString('base64url') }
}

export async function createGoogleCalendarAuthorizationUrl(userId: string, returnOrigin: string) {
  const config = await oauthConfig(userId)
  const signingSecret = getGoogleCalendarOAuthStateSecret()
  if (!signingSecret) throw new GoogleCalendarIntegrationError('not_configured')
  const state = encodeBase64Url(JSON.stringify(statePayload(userId, returnOrigin)))
  const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authorization.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: googleCalendarScopes.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state: `${state}.${stateSignature(state, signingSecret)}`,
  }).toString()
  return authorization.toString()
}

function verifyOAuthState(state: string, signingSecret: Buffer, allowedOrigins: Set<string>): GoogleCalendarState {
  const [payload, signature, extra] = state.split('.')
  if (!payload || !signature || extra !== undefined) throw new GoogleCalendarIntegrationError('invalid_state')
  const expected = Buffer.from(stateSignature(payload, signingSecret))
  const supplied = Buffer.from(signature)
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new GoogleCalendarIntegrationError('invalid_state')
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<GoogleCalendarState>
    const age = Date.now() - Number(parsed.issuedAt)
    if (
      typeof parsed.userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(parsed.userId) ||
      typeof parsed.returnOrigin !== 'string' || !allowedOrigins.has(parsed.returnOrigin) ||
      !Number.isFinite(age) || age < 0 || age > 10 * 60_000 ||
      typeof parsed.nonce !== 'string' || parsed.nonce.length < 20 || parsed.nonce.length > 128
    ) throw new GoogleCalendarIntegrationError('invalid_state')
    return parsed as GoogleCalendarState
  } catch (error) {
    if (error instanceof GoogleCalendarIntegrationError) throw error
    throw new GoogleCalendarIntegrationError('invalid_state')
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null) as unknown
  return typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
}

async function postForm(url: string, data: URLSearchParams) {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: data,
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw new GoogleCalendarIntegrationError('provider_unavailable')
  }
  const payload = await readJson(response)
  if (!response.ok) throw new GoogleCalendarIntegrationError('provider_unavailable')
  return payload
}

export async function completeGoogleCalendarOAuth(input: {
  code?: string
  state?: string
  oauthError?: string
  allowedOrigins: Set<string>
}): Promise<CalendarOAuthCallbackResult> {
  if (!input.state) throw new GoogleCalendarIntegrationError('invalid_state')
  const signingSecret = getGoogleCalendarOAuthStateSecret()
  if (!signingSecret) throw new GoogleCalendarIntegrationError('not_configured')
  const state = verifyOAuthState(input.state, signingSecret, input.allowedOrigins)
  if (input.oauthError) return { returnOrigin: state.returnOrigin, result: 'cancelled' }
  if (!input.code || input.code.length > 4_096) return { returnOrigin: state.returnOrigin, result: 'error' }

  try {
    const config = await oauthConfig(state.userId)
    const token = await postForm(`${googleOAuthEndpoint}/token`, new URLSearchParams({
      code: input.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }))
    const refreshToken = typeof token.refresh_token === 'string' ? token.refresh_token : ''
    const accessToken = typeof token.access_token === 'string' ? token.access_token : ''
    if (!refreshToken || !accessToken) return { returnOrigin: state.returnOrigin, result: 'error' }

    let userInfoResponse: Response
    try {
      userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      return { returnOrigin: state.returnOrigin, result: 'error' }
    }
    const userInfo = await readJson(userInfoResponse)
    const email = typeof userInfo.email === 'string' ? userInfo.email.trim().toLowerCase() : ''
    if (!userInfoResponse.ok || userInfo.email_verified !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { returnOrigin: state.returnOrigin, result: 'error' }
    }
    await saveGoogleCalendarStoredConnection({ userId: state.userId, refreshToken, accountEmail: email })
    return { returnOrigin: state.returnOrigin, result: 'connected' }
  } catch {
    return { returnOrigin: state.returnOrigin, result: 'error' }
  }
}

export async function getGoogleCalendarConnectionStatus(userId: string) {
  const serverConfigured = Boolean(getGoogleCalendarOAuthConfig())
  try {
    const connection = await getGoogleCalendarStoredConnection(userId)
    const oauthClientStored = Boolean(await getGoogleCalendarStoredOAuthClient(userId))
    return {
      configured: serverConfigured || oauthClientStored,
      oauthClientStored,
      storageReady: true,
      connected: Boolean(connection),
      accountEmail: connection?.accountEmail,
      connectedAt: connection?.connectedAt,
    }
  } catch (error) {
    if (error instanceof GoogleCalendarStorageError && error.reason === 'migration_missing') {
      return { configured: serverConfigured, storageReady: false, connected: false }
    }
    throw error
  }
}

export async function disconnectGoogleCalendar(userId: string) {
  await disconnectGoogleCalendarStoredConnection(userId)
}

export async function saveGoogleCalendarOAuthClient(userId: string, clientId: string, clientSecret: string) {
  const cleanClientId = clientId.trim()
  const cleanClientSecret = clientSecret.trim()
  if (
    cleanClientId.length < 20 || cleanClientId.length > 512 ||
    !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(cleanClientId) ||
    cleanClientSecret.length < 8 || cleanClientSecret.length > 4_096
  ) throw new GoogleCalendarIntegrationError('invalid_oauth_client')
  if (!getGoogleCalendarOAuthStateSecret()) throw new GoogleCalendarIntegrationError('not_configured')
  await saveGoogleCalendarStoredOAuthClient({ userId, clientId: cleanClientId, clientSecret: cleanClientSecret })
}

export async function disconnectGoogleCalendarOAuthClient(userId: string) {
  await disconnectGoogleCalendarStoredOAuthClient(userId)
}

async function getAccessToken(userId: string) {
  const config = await oauthConfig(userId)
  let connection
  try {
    connection = await getGoogleCalendarStoredConnection(userId)
  } catch (error) {
    if (error instanceof GoogleCalendarStorageError && error.reason === 'migration_missing') {
      throw new GoogleCalendarIntegrationError('not_connected')
    }
    throw error
  }
  if (!connection?.refreshToken) throw new GoogleCalendarIntegrationError('not_connected')
  const token = await postForm(`${googleOAuthEndpoint}/token`, new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: connection.refreshToken,
    grant_type: 'refresh_token',
  }))
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new GoogleCalendarIntegrationError('authorization_expired')
  }
  return { accessToken: token.access_token, calendarId: connection.calendarId }
}

async function calendarApi<T extends Record<string, unknown>>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${googleCalendarEndpoint}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw new GoogleCalendarIntegrationError('provider_unavailable')
  }
  const payload = await readJson(response)
  if (response.status === 401 || response.status === 403) throw new GoogleCalendarIntegrationError('authorization_expired')
  if (!response.ok) throw new GoogleCalendarIntegrationError('provider_unavailable')
  return payload as T
}

export function validateGoogleCalendarRange(startAt: string, endAt: string, maximumDays = 7) {
  const offsetDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/
  if (!offsetDateTime.test(startAt) || !offsetDateTime.test(endAt)) throw new GoogleCalendarIntegrationError('invalid_time')
  const start = Date.parse(startAt)
  const end = Date.parse(endAt)
  const now = Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < now + 60_000 || end <= start || end - start > maximumDays * 24 * 60 * 60_000 || start > now + 120 * 24 * 60 * 60_000) {
    throw new GoogleCalendarIntegrationError('invalid_time')
  }
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
}

type BusyInterval = { start: string; end: string }

async function getBusyIntervals(userId: string, startAt: string, endAt: string): Promise<BusyInterval[]> {
  const range = validateGoogleCalendarRange(startAt, endAt, 7)
  const { accessToken, calendarId } = await getAccessToken(userId)
  const result = await calendarApi(accessToken, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify({ timeMin: range.start, timeMax: range.end, items: [{ id: calendarId }] }),
  })
  const calendars = typeof result.calendars === 'object' && result.calendars !== null ? result.calendars as Record<string, unknown> : {}
  const calendar = calendars[calendarId]
  if (!calendar || typeof calendar !== 'object') throw new GoogleCalendarIntegrationError('provider_unavailable')
  const calendarResult = calendar as Record<string, unknown>
  if (Array.isArray(calendarResult.errors) && calendarResult.errors.length > 0) throw new GoogleCalendarIntegrationError('provider_unavailable')
  if (!Array.isArray(calendarResult.busy)) throw new GoogleCalendarIntegrationError('provider_unavailable')
  const busy = calendarResult.busy
  return busy.flatMap((item): BusyInterval[] => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    return typeof value.start === 'string' && typeof value.end === 'string'
      ? [{ start: value.start, end: value.end }]
      : []
  })
}

export async function checkGoogleCalendarAvailability(userId: string, startAt: string, endAt: string) {
  const range = validateGoogleCalendarRange(startAt, endAt, 7)
  const busy = await getBusyIntervals(userId, range.start, range.end)
  return { available: busy.length === 0, busy }
}

export async function createGoogleMeetEvent(input: {
  userId: string
  contactName: string
  contactPhone: string
  startAt: string
  durationMinutes: number
  projectSummary: string
}) {
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 15 || input.durationMinutes > 180) {
    throw new GoogleCalendarIntegrationError('invalid_time')
  }
  const name = input.contactName.trim().slice(0, 120)
  const phone = input.contactPhone.trim()
  const project = input.projectSummary.trim().slice(0, 600)
  if (!name || !/^\+[1-9]\d{7,14}$/.test(phone) || !project) throw new GoogleCalendarIntegrationError('invalid_time')
  const startMillis = Date.parse(input.startAt)
  if (!Number.isFinite(startMillis)) throw new GoogleCalendarIntegrationError('invalid_time')
  const startAt = new Date(startMillis).toISOString()
  const endAt = new Date(startMillis + input.durationMinutes * 60_000).toISOString()
  const availability = await checkGoogleCalendarAvailability(input.userId, startAt, endAt)
  if (!availability.available) return { created: false as const, reason: 'busy' as const, busy: availability.busy }

  const { accessToken, calendarId } = await getAccessToken(input.userId)
  const stableEventId = `digibusca${createHash('sha256').update(`${input.userId}:${phone}:${startAt}`).digest('hex').slice(0, 40)}`
  const eventRequest = {
    id: stableEventId,
    summary: `Conversa DigiUP com ${name}`.slice(0, 200),
    description: [
      'Reunião agendada pelo Cristhian no WhatsApp.',
      `Contato: ${name}`,
      `WhatsApp: ${phone}`,
      `Projeto: ${project}`,
    ].join('\n'),
    visibility: 'private',
    start: { dateTime: startAt, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: endAt, timeZone: 'America/Sao_Paulo' },
    conferenceData: {
      createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
    },
    extendedProperties: { private: { managedBy: 'digibusca', contactPhone: phone } },
  }
  let event: Record<string, unknown>
  let alreadyExists = false
  try {
    event = await calendarApi(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`, {
      method: 'POST',
      body: JSON.stringify(eventRequest),
    })
  } catch (error) {
    if (!(error instanceof GoogleCalendarIntegrationError) || error.reason !== 'provider_unavailable') throw error
    const existing = await calendarApi(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(stableEventId)}`).catch(() => undefined)
    if (!existing) throw error
    event = existing
    alreadyExists = true
  }
  const extractMeetUrl = (value: Record<string, unknown>) => {
    const conferenceData = typeof value.conferenceData === 'object' && value.conferenceData !== null
      ? value.conferenceData as Record<string, unknown>
      : {}
    const entryPoints = Array.isArray(conferenceData.entryPoints) ? conferenceData.entryPoints : []
    const videoEntry = entryPoints.find((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).entryPointType === 'video') as Record<string, unknown> | undefined
    return typeof videoEntry?.uri === 'string' && /^https:\/\/meet\.google\.com\/[a-z0-9-]+$/i.test(videoEntry.uri)
      ? videoEntry.uri
      : typeof value.hangoutLink === 'string' && /^https:\/\/meet\.google\.com\/[a-z0-9-]+$/i.test(value.hangoutLink)
        ? value.hangoutLink
        : undefined
  }
  let meetUrl = extractMeetUrl(event)
  for (let attempt = 0; !meetUrl && attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700))
    const refreshed = await calendarApi(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(stableEventId)}`).catch(() => undefined)
    if (refreshed) {
      event = refreshed
      meetUrl = extractMeetUrl(event)
    }
  }
  return {
    created: true as const,
    alreadyExists,
    eventId: typeof event.id === 'string' ? event.id : stableEventId,
    title: typeof event.summary === 'string' ? event.summary : eventRequest.summary,
    startAt: typeof (event.start as Record<string, unknown> | undefined)?.dateTime === 'string' ? (event.start as Record<string, unknown>).dateTime as string : startAt,
    endAt: typeof (event.end as Record<string, unknown> | undefined)?.dateTime === 'string' ? (event.end as Record<string, unknown>).dateTime as string : endAt,
    ...(meetUrl ? { meetUrl } : { meetPending: true }),
  }
}
