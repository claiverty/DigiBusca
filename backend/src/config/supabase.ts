import dotenv from 'dotenv'
import { createClient, type User } from '@supabase/supabase-js'

dotenv.config({ path: process.env.DIGIBUSCA_ENV_FILE ?? 'backend/.env' })
dotenv.config({ path: 'frontend/.env' })

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

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
  if (!accessToken || !isSupabaseConfigured) {
    return undefined
  }

  const client = createClient(supabaseUrl as string, supabaseAnonKey as string, {
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
  if (!isSupabaseConfigured) {
    throw new Error('Supabase não está configurado no backend.')
  }

  return createClient(supabaseUrl as string, supabaseAnonKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}
