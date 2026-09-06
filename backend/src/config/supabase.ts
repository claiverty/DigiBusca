import { createClient, type User } from '@supabase/supabase-js'

export type RuntimeEnvironment = {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  GOOGLE_MAPS_API_KEY?: string
}

let runtimeEnvironment: RuntimeEnvironment | undefined

function localEnvironment(): RuntimeEnvironment {
  if (typeof process === 'undefined') {
    return {}
  }

  return process.env
}

function environment() {
  return runtimeEnvironment ?? localEnvironment()
}

export function configureRuntimeEnvironment(nextEnvironment: RuntimeEnvironment) {
  runtimeEnvironment = nextEnvironment
}

export function getGoogleMapsApiKey() {
  return environment().GOOGLE_MAPS_API_KEY
}

function getSupabaseConfig() {
  const values = environment()
  return {
    url: values.SUPABASE_URL ?? values.VITE_SUPABASE_URL,
    anonKey: values.SUPABASE_ANON_KEY ?? values.VITE_SUPABASE_ANON_KEY,
  }
}

export function isSupabaseConfigured() {
  const { url, anonKey } = getSupabaseConfig()
  return Boolean(url && anonKey)
}

export type AuthenticatedRequest = {
  accessToken: string
  user: User
}

export function getBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Bearer ')) {
    return undefined
  }

  const token = authorization.slice('Bearer '.length).trim()
  return token || undefined
}

export async function authenticateRequest(
  authorization: string | undefined,
): Promise<AuthenticatedRequest | undefined> {
  const accessToken = getBearerToken(authorization)
  const { url, anonKey } = getSupabaseConfig()
  if (!accessToken || !url || !anonKey) {
    return undefined
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
  const { data, error } = await client.auth.getUser(accessToken)

  if (error || !data.user) {
    return undefined
  }

  return { accessToken, user: data.user }
}

export function createUserSupabaseClient(accessToken: string) {
  const { url, anonKey } = getSupabaseConfig()
  if (!url || !anonKey) {
    throw new Error('Supabase não está configurado no backend.')
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}
