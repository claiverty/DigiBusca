import { createClient, type User } from '@supabase/supabase-js'
import { isWhatsAppTokenEncryptionKeyValid } from '../integrations/whatsappTokenVault.js'

export type RuntimeEnvironment = {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  GOOGLE_MAPS_API_KEY?: string
  GEMINI_API_KEY?: string
  WHATSAPP_ACCESS_TOKEN?: string
  WHATSAPP_PHONE_NUMBER_ID?: string
  WHATSAPP_GRAPH_API_VERSION?: string
  WHATSAPP_TEMPLATE_NAME?: string
  WHATSAPP_TEMPLATE_LANGUAGE?: string
  WHATSAPP_APP_SECRET?: string
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string
  META_APP_ID?: string
  WHATSAPP_TOKEN_ENCRYPTION_KEY?: string
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

export function getGeminiApiKey() {
  return environment().GEMINI_API_KEY
}

export function getWhatsAppCloudConfig() {
  const values = environment()
  const accessToken = values.WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneNumberId = values.WHATSAPP_PHONE_NUMBER_ID?.trim()
  const graphApiVersion = values.WHATSAPP_GRAPH_API_VERSION?.trim()
  const templateName = values.WHATSAPP_TEMPLATE_NAME?.trim()
  const templateLanguage = values.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'pt_BR'

  if (!accessToken || !phoneNumberId || !graphApiVersion || !templateName) return undefined
  if (!/^v\d+\.\d+$/.test(graphApiVersion)) return undefined

  return { accessToken, phoneNumberId, graphApiVersion, templateName, templateLanguage }
}

export function getWhatsAppCloudSetupStatus() {
  const values = environment()
  const accessTokenConfigured = Boolean(values.WHATSAPP_ACCESS_TOKEN?.trim())
  const phoneNumberConfigured = Boolean(values.WHATSAPP_PHONE_NUMBER_ID?.trim())
  const graphApiVersionConfigured = /^v\d+\.\d+$/.test(values.WHATSAPP_GRAPH_API_VERSION?.trim() ?? '')
  const templateConfigured = Boolean(values.WHATSAPP_TEMPLATE_NAME?.trim())
  const webhookSecretsConfigured = Boolean(
    values.WHATSAPP_APP_SECRET?.trim() && values.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim(),
  )
  const webhookPersistenceConfigured = Boolean(
    (values.SUPABASE_URL ?? values.VITE_SUPABASE_URL)?.trim() &&
    values.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  )
  const embeddedSignupServerReady = Boolean(
    values.META_APP_ID?.trim() &&
    values.WHATSAPP_APP_SECRET?.trim() &&
    isWhatsAppTokenEncryptionKeyValid(values.WHATSAPP_TOKEN_ENCRYPTION_KEY) &&
    graphApiVersionConfigured &&
    webhookPersistenceConfigured,
  )

  return {
    sendReady: accessTokenConfigured && phoneNumberConfigured && graphApiVersionConfigured && templateConfigured,
    webhookReady: webhookSecretsConfigured && webhookPersistenceConfigured,
    accessTokenConfigured,
    phoneNumberConfigured,
    graphApiVersionConfigured,
    templateConfigured,
    embeddedSignupServerReady,
  }
}

export function getWhatsAppEmbeddedSignupServerConfig() {
  const values = environment()
  const graphApiVersion = values.WHATSAPP_GRAPH_API_VERSION?.trim()
  const appId = values.META_APP_ID?.trim()
  const appSecret = values.WHATSAPP_APP_SECRET?.trim()
  const encryptionKey = values.WHATSAPP_TOKEN_ENCRYPTION_KEY?.trim()

  if (
    !appId || !appSecret || !isWhatsAppTokenEncryptionKeyValid(encryptionKey) ||
    !graphApiVersion || !/^v\d+\.\d+$/.test(graphApiVersion)
  ) return undefined

  return { appId, appSecret, encryptionKey: encryptionKey!, graphApiVersion }
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

export function getWhatsAppWebhookSecrets() {
  const values = environment()
  return {
    appSecret: values.WHATSAPP_APP_SECRET?.trim(),
    verifyToken: values.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim(),
  }
}

export function isWhatsAppWebhookPersistenceConfigured() {
  const values = environment()
  const { url } = getSupabaseConfig()
  return Boolean(url?.trim() && values.SUPABASE_SERVICE_ROLE_KEY?.trim())
}

export function createWhatsAppWebhookSupabaseClient() {
  const values = environment()
  const { url } = getSupabaseConfig()
  const serviceRoleKey = values.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) {
    throw new Error('A persistência autenticada do webhook WhatsApp não está configurada.')
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
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
