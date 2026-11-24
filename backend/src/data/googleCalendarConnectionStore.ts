import { createWhatsAppWebhookSupabaseClient } from '../config/supabase.js'

export type GoogleCalendarStoredConnection = {
  accountEmail: string
  calendarId: string
  refreshToken: string
  connectedAt: string
}

export type GoogleCalendarStoredOAuthClient = {
  clientId: string
  clientSecret: string
}

export class GoogleCalendarStorageError extends Error {
  constructor(readonly reason: 'migration_missing' | 'storage_unavailable') {
    super(reason)
    this.name = 'GoogleCalendarStorageError'
  }
}

function firstRow<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined
  return value && typeof value === 'object' ? value as T : undefined
}

function throwStorageError(error: { code?: string } | null) {
  if (!error) return
  if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01') {
    throw new GoogleCalendarStorageError('migration_missing')
  }
  throw new GoogleCalendarStorageError('storage_unavailable')
}

export async function getGoogleCalendarStoredConnection(userId: string): Promise<GoogleCalendarStoredConnection | undefined> {
  let result
  try {
    result = await createWhatsAppWebhookSupabaseClient().rpc('get_google_calendar_connection', { p_user_id: userId })
  } catch {
    throw new GoogleCalendarStorageError('storage_unavailable')
  }
  throwStorageError(result.error)
  const row = firstRow<{ account_email: string; calendar_id: string; refresh_token: string | null; connected_at: string }>(result.data)
  if (!row || !row.refresh_token) return undefined
  return {
    accountEmail: row.account_email,
    calendarId: row.calendar_id,
    refreshToken: row.refresh_token,
    connectedAt: row.connected_at,
  }
}

export async function saveGoogleCalendarStoredConnection(input: {
  userId: string
  refreshToken: string
  accountEmail: string
}): Promise<void> {
  let result
  try {
    result = await createWhatsAppWebhookSupabaseClient().rpc('save_google_calendar_connection', {
      p_user_id: input.userId,
      p_refresh_token: input.refreshToken,
      p_account_email: input.accountEmail,
    })
  } catch {
    throw new GoogleCalendarStorageError('storage_unavailable')
  }
  throwStorageError(result.error)
}

export async function disconnectGoogleCalendarStoredConnection(userId: string): Promise<void> {
  let result
  try {
    result = await createWhatsAppWebhookSupabaseClient().rpc('disconnect_google_calendar', { p_user_id: userId })
  } catch {
    throw new GoogleCalendarStorageError('storage_unavailable')
  }
  throwStorageError(result.error)
}

export async function getGoogleCalendarStoredOAuthClient(userId: string): Promise<GoogleCalendarStoredOAuthClient | undefined> {
  let result
  try {
    result = await createWhatsAppWebhookSupabaseClient().rpc('get_google_calendar_oauth_client', { p_user_id: userId })
  } catch {
    throw new GoogleCalendarStorageError('storage_unavailable')
  }
  throwStorageError(result.error)
  const row = firstRow<{ client_id: string; client_secret: string | null }>(result.data)
  if (!row || !row.client_secret) return undefined
  return { clientId: row.client_id, clientSecret: row.client_secret }
}

export async function saveGoogleCalendarStoredOAuthClient(input: {
  userId: string
  clientId: string
  clientSecret: string
}): Promise<void> {
  let result
  try {
    result = await createWhatsAppWebhookSupabaseClient().rpc('save_google_calendar_oauth_client', {
      p_user_id: input.userId,
      p_client_id: input.clientId,
      p_client_secret: input.clientSecret,
    })
  } catch {
    throw new GoogleCalendarStorageError('storage_unavailable')
  }
  throwStorageError(result.error)
}

export async function disconnectGoogleCalendarStoredOAuthClient(userId: string): Promise<void> {
  let result
  try {
    result = await createWhatsAppWebhookSupabaseClient().rpc('disconnect_google_calendar_oauth_client', { p_user_id: userId })
  } catch {
    throw new GoogleCalendarStorageError('storage_unavailable')
  }
  throwStorageError(result.error)
}
