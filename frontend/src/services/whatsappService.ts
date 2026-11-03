import { authenticatedFetch } from './leadsService'

export type WhatsAppCloudSetupStatus = {
  sendReady: boolean
  webhookReady: boolean
  accessTokenConfigured: boolean
  phoneNumberConfigured: boolean
  graphApiVersionConfigured: boolean
  templateConfigured: boolean
  embeddedSignupServerReady: boolean
  connectionStorageReady: boolean
  automationStorageReady: boolean
  automationRuntimeEnabled: boolean
}

export type WhatsAppAutomationProfile = {
  phoneNumberId: string
  businessName: string
  senderIdentity: string
  serviceSummary: string
  approvedFacts: string
  escalationContact: string
  automationEnabled: boolean
  channelApprovedAt: string | null
  contentApprovedAt: string | null
  updatedAt: string
}

export type WhatsAppAutomationProfileInput = Omit<WhatsAppAutomationProfile, 'channelApprovedAt' | 'contentApprovedAt' | 'updatedAt'> & {
  channelApproved: boolean
  contentApproved: boolean
}

export type WhatsAppConnection = {
  phoneNumberId: string
  wabaId: string | null
  displayPhoneNumber: string | null
  isOnBizApp: boolean
  platformType: string | null
  historySyncState: Record<string, unknown> | null
  appStateSyncState: Record<string, unknown> | null
  connectedAt: string
}

export type WhatsAppCoexistenceSyncType = 'history' | 'smb_app_state_sync'

export type WhatsAppCoexistenceSyncResult = {
  status: 'accepted'
  syncType: WhatsAppCoexistenceSyncType
  requestedAt: string
  requestId: string
}

export type WhatsAppConversation = {
  id: string
  phoneNumberId: string
  contactWaId: string
  contactName?: string
  lastMessageAt?: string
  lastMessagePreview?: string
  lastMessageDirection?: 'inbound' | 'outbound'
  automationPaused?: boolean
  automationOptedOut?: boolean
  automationPauseReason?: string
  createdAt: string
  updatedAt: string
}

export type WhatsAppMessage = {
  id: string
  providerMessageId: string
  contactWaId: string
  direction: 'inbound' | 'outbound'
  messageType: string
  body?: string
  isPlaceholder: boolean
  occurredAt: string
  createdAt: string
  statuses: Array<{ status: 'sent' | 'delivered' | 'read' | 'failed'; occurredAt: string }>
}

export type WhatsAppPage<T> = {
  data: T[]
  nextCursor?: string
}

const apiBaseUrl = import.meta.env.PROD ? '/api' : (import.meta.env.VITE_API_URL ?? '/api')

async function getWhatsAppData<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await authenticatedFetch(`${apiBaseUrl}${path}`)
  } catch {
    throw new Error('Não foi possível conectar à API do DigiBusca. Verifique se o backend local está ativo e autorizado para esta origem.')
  }
  const payload = (await response.json().catch(() => null)) as { data?: T; error?: string } | null

  if (!response.ok || payload?.data === undefined) {
    throw new Error(payload?.error ?? 'Não foi possível carregar o WhatsApp.')
  }

  return payload.data
}

export async function getWhatsAppCloudSetupStatus(): Promise<WhatsAppCloudSetupStatus> {
  return getWhatsAppData<WhatsAppCloudSetupStatus>('/whatsapp/status')
}

export async function getWhatsAppConnections(): Promise<WhatsAppConnection[]> {
  return getWhatsAppData<WhatsAppConnection[]>('/whatsapp/connections')
}

export async function getWhatsAppAutomationProfile(phoneNumberId: string): Promise<WhatsAppAutomationProfile | null> {
  return getWhatsAppData<WhatsAppAutomationProfile | null>(`/whatsapp/automation?phoneNumberId=${encodeURIComponent(phoneNumberId)}`)
}

export async function saveWhatsAppAutomationProfile(input: WhatsAppAutomationProfileInput): Promise<WhatsAppAutomationProfile> {
  let response: Response
  try {
    response = await authenticatedFetch(`${apiBaseUrl}/whatsapp/automation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error('Não foi possível conectar ao backend para salvar as regras de atendimento.')
  }
  const payload = (await response.json().catch(() => null)) as { data?: WhatsAppAutomationProfile; error?: string } | null
  if (!response.ok || !payload?.data) throw new Error(payload?.error ?? 'Não foi possível salvar as regras de atendimento.')
  return payload.data
}

export async function setWhatsAppConversationAutomationPaused(conversationId: string, paused: boolean): Promise<void> {
  let response: Response
  try {
    response = await authenticatedFetch(`${apiBaseUrl}/whatsapp/conversations/${encodeURIComponent(conversationId)}/automation`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused }),
    })
  } catch {
    throw new Error('Não foi possível atualizar a automação desta conversa.')
  }
  const payload = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok) throw new Error(payload?.error ?? 'Não foi possível atualizar a automação desta conversa.')
}

export async function connectWhatsAppEmbeddedSignup(input: {
  code: string
  wabaId: string
  phoneNumberId?: string
}): Promise<WhatsAppConnection> {
  let response: Response
  try {
    response = await authenticatedFetch(`${apiBaseUrl}/whatsapp/connections/embedded-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error('Não foi possível conectar ao backend para concluir a autorização segura da Meta.')
  }
  const payload = (await response.json().catch(() => null)) as { data?: WhatsAppConnection; error?: string } | null
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? 'Não foi possível concluir a conexão do WhatsApp.')
  }
  return payload.data
}

export async function requestWhatsAppCoexistenceSync(input: {
  phoneNumberId: string
  syncType: WhatsAppCoexistenceSyncType
}): Promise<WhatsAppCoexistenceSyncResult> {
  let response: Response
  const consent = input.syncType === 'history' ? { historyConsent: true } : { contactsConsent: true }
  try {
    response = await authenticatedFetch(`${apiBaseUrl}/whatsapp/connections/coexistence-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, ...consent }),
    })
  } catch {
    throw new Error('Não foi possível conectar ao backend para solicitar a sincronização.')
  }
  const payload = (await response.json().catch(() => null)) as { data?: WhatsAppCoexistenceSyncResult; error?: string } | null
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? 'Não foi possível solicitar a sincronização à Meta.')
  }
  return payload.data
}

export async function getWhatsAppConversations(before?: string): Promise<WhatsAppPage<WhatsAppConversation>> {
  const params = new URLSearchParams({ limit: '50' })
  if (before) params.set('before', before)
  return getWhatsAppData<WhatsAppPage<WhatsAppConversation>>(`/whatsapp/conversations?${params.toString()}`)
}

export async function getWhatsAppConversationMessages(
  conversationId: string,
  before?: string,
): Promise<WhatsAppPage<WhatsAppMessage>> {
  const params = new URLSearchParams({ limit: '50' })
  if (before) params.set('before', before)
  return getWhatsAppData<WhatsAppPage<WhatsAppMessage>>(
    `/whatsapp/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`,
  )
}
