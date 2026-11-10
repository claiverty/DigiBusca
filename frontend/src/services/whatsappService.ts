import { authenticatedFetch } from './leadsService'

export type WhatsAppEvolutionSetupStatus = {
  integrationEnabled: boolean
  evolutionConfigured: boolean
  webhookConfigured: boolean
  persistenceConfigured: boolean
  connectionStorageReady: boolean
  automationStorageReady: boolean
  automationRuntimeEnabled: boolean
  prospectingRuntimeEnabled: boolean
}

export type WhatsAppProspectingSettings = {
  enabled: boolean
  dailyNewLeadLimit: number
  timezone: string
  nextNewLeadAt?: string
}

export type WhatsAppProspectingQueueItem = {
  id: string
  leadId: string
  phoneNumberId: string
  recipientPhone: string
  message: string
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'unknown' | 'cancelled'
  scheduledAt: string
  claimedAt?: string
  sentAt?: string
  providerMessageId?: string
  errorCode?: string
  createdAt: string
}

export type WhatsAppProspectingDashboard = {
  settings: WhatsAppProspectingSettings
  dailyCount: number
  queue: WhatsAppProspectingQueueItem[]
  localRuntimeEnabled: boolean
  evolutionConfigured: boolean
}

export type WhatsAppAutomationProfile = {
  phoneNumberId: string
  businessName: string
  senderIdentity: string
  serviceSummary: string
  approvedFacts: string
  escalationContact: string
  responseMode: 'handoff_only' | 'gemini'
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
  displayPhoneNumber: string | null
  platformType: string | null
  connectedAt: string
  connectionState?: string
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

const apiBaseUrl = import.meta.env.PROD
  ? '/api'
  : import.meta.env.VITE_WHATSAPP_LOCAL_API_URL?.trim() || '/api'

function whatsAppFetch(input: string, init: RequestInit = {}) {
  return authenticatedFetch(input, { ...init, cache: 'no-store' })
}

async function getWhatsAppData<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await whatsAppFetch(`${apiBaseUrl}${path}`)
  } catch {
    throw new Error('Não foi possível conectar à API WhatsApp pelo domínio do DigiBusca. Verifique se o backend do Mac e o túnel Cloudflare estão ativos.')
  }
  const payload = (await response.json().catch(() => null)) as { data?: T; error?: string } | null

  if (!response.ok || payload?.data === undefined) {
    throw new Error(payload?.error ?? 'Não foi possível carregar o WhatsApp.')
  }

  return payload.data
}

export async function getWhatsAppEvolutionSetupStatus(): Promise<WhatsAppEvolutionSetupStatus> {
  return getWhatsAppData<WhatsAppEvolutionSetupStatus>('/whatsapp/status')
}

export async function getWhatsAppConnections(): Promise<WhatsAppConnection[]> {
  return getWhatsAppData<WhatsAppConnection[]>('/whatsapp/connections')
}

export async function getWhatsAppProspectingDashboard(): Promise<WhatsAppProspectingDashboard> {
  return getWhatsAppData<WhatsAppProspectingDashboard>('/whatsapp/prospecting')
}

export async function saveWhatsAppProspectingSettings(input: Pick<WhatsAppProspectingSettings, 'enabled' | 'dailyNewLeadLimit'>): Promise<WhatsAppProspectingSettings> {
  let response: Response
  try {
    response = await whatsAppFetch(`${apiBaseUrl}/whatsapp/prospecting/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error('Não foi possível conectar ao backend para salvar a fila de prospecção.')
  }
  const payload = (await response.json().catch(() => null)) as { data?: WhatsAppProspectingSettings; error?: string } | null
  if (!response.ok || !payload?.data) throw new Error(payload?.error ?? 'Não foi possível salvar as configurações de prospecção.')
  return payload.data
}

export async function enqueueWhatsAppNewLead(input: { phoneNumberId: string; leadId: string; message: string }): Promise<WhatsAppProspectingQueueItem> {
  let response: Response
  try {
    response = await whatsAppFetch(`${apiBaseUrl}/whatsapp/prospecting/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error('Não foi possível conectar ao backend para adicionar este lead à fila.')
  }
  const payload = (await response.json().catch(() => null)) as { data?: WhatsAppProspectingQueueItem; error?: string } | null
  if (!response.ok || !payload?.data) throw new Error(payload?.error ?? 'Não foi possível adicionar este lead à fila.')
  return payload.data
}

export async function cancelWhatsAppQueueItem(queueId: string): Promise<void> {
  let response: Response
  try {
    response = await whatsAppFetch(`${apiBaseUrl}/whatsapp/prospecting/queue/${encodeURIComponent(queueId)}`, { method: 'DELETE' })
  } catch {
    throw new Error('Não foi possível conectar ao backend para cancelar este contato.')
  }
  const payload = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok) throw new Error(payload?.error ?? 'Não foi possível cancelar este contato.')
}

export async function getWhatsAppAutomationProfile(phoneNumberId: string): Promise<WhatsAppAutomationProfile | null> {
  return getWhatsAppData<WhatsAppAutomationProfile | null>(`/whatsapp/automation?phoneNumberId=${encodeURIComponent(phoneNumberId)}`)
}

export async function saveWhatsAppAutomationProfile(input: WhatsAppAutomationProfileInput): Promise<WhatsAppAutomationProfile> {
  let response: Response
  try {
    response = await whatsAppFetch(`${apiBaseUrl}/whatsapp/automation`, {
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
    response = await whatsAppFetch(`${apiBaseUrl}/whatsapp/conversations/${encodeURIComponent(conversationId)}/automation`, {
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

export type WhatsAppEvolutionConnectionResult = {
  instanceName: string
  state: string
  qrCode?: string
}

export async function getWhatsAppEvolutionPairingStatus(): Promise<WhatsAppEvolutionConnectionResult> {
  const response = await whatsAppFetch(`${apiBaseUrl}/whatsapp/connections/evolution/qr`)
  const payload = (await response.json().catch(() => null)) as { data?: WhatsAppEvolutionConnectionResult; error?: string } | null
  if (!response.ok || !payload?.data) throw new Error(payload?.error ?? 'Não foi possível atualizar o QR Code.')
  return payload.data
}

export async function connectWhatsAppEvolution(): Promise<WhatsAppEvolutionConnectionResult> {
  let response: Response
  try {
    response = await whatsAppFetch(`${apiBaseUrl}/whatsapp/connections/evolution`, {
      method: 'POST',
    })
  } catch {
    throw new Error('Não foi possível conectar ao backend local do DigiBusca.')
  }
  const payload = (await response.json().catch(() => null)) as { data?: WhatsAppEvolutionConnectionResult; error?: string } | null
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? 'Não foi possível iniciar o pareamento com a Evolution API.')
  }
  return payload.data
}

export async function getWhatsAppConversations(before?: string): Promise<WhatsAppPage<WhatsAppConversation>> {
  const params = new URLSearchParams({ limit: '50' })
  if (before) params.set('before', before)
  return getWhatsAppData<WhatsAppPage<WhatsAppConversation>>(`/whatsapp/conversations?${params.toString()}`)
}

export async function getWhatsAppHumanPendingCount(): Promise<number> {
  return getWhatsAppData<number>('/whatsapp/conversations/pending-count')
}

export async function getWhatsAppHumanPendingConversations(): Promise<WhatsAppConversation[]> {
  return getWhatsAppData<WhatsAppConversation[]>('/whatsapp/conversations/pending')
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
