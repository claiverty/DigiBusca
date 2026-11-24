import { authenticatedFetch } from './leadsService'

export type WhatsAppEvolutionSetupStatus = {
  integrationEnabled: boolean
  evolutionIntegrationEnabled: boolean
  evolutionConfigured: boolean
  webhookConfigured: boolean
  persistenceConfigured: boolean
  connectionStorageReady: boolean
  automationStorageReady: boolean
  automationRuntimeEnabled: boolean
  digiBuscaAgentRuntimeEnabled: boolean
  digiBuscaAgentStorageReady: boolean
  agentProviders: { google: boolean; anthropic: boolean; openaiCompatible: boolean }
  agentProviderSources?: Record<'google' | 'anthropic' | 'openaiCompatible', 'panel' | 'server' | 'disconnected' | 'none' | 'unavailable'>
  prospectingRuntimeEnabled: boolean
  openBotReplyRuntimeEnabled: boolean
  openBotBridgeConfigured: boolean
  openBotAgentSafetyConfirmed: boolean
  openClawRuntimeEnabled: boolean
  openClawMcpConfigured: boolean
  openClawBridgeConfigured: boolean
  openClawProspectingDispatcherConfigured: boolean
  openClawStorageReady: boolean
  openClawGatewayReady: boolean
}

export type WhatsAppProspectingSettings = {
  enabled: boolean
  dailyNewLeadLimit: number
  timezone: string
  defaultCity: string
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

export type WhatsAppProspectingChatMessage = {
  role: 'assistant' | 'user'
  text: string
  createdAt: string
}

export type WhatsAppDailyProspectingCampaign = {
  id: string
  campaignDate: string
  city?: string
  segment: string
  status: 'awaiting_city' | 'processing' | 'completed' | 'failed'
  searchedCount: number
  savedCount: number
  queuedCount: number
  messages: WhatsAppProspectingChatMessage[]
  errorCode?: string
  updatedAt: string
}

export type WhatsAppProspectingDashboard = {
  settings: WhatsAppProspectingSettings
  dailyCount: number
  queue: WhatsAppProspectingQueueItem[]
  campaign: WhatsAppDailyProspectingCampaign
  localRuntimeEnabled: boolean
  evolutionConfigured: boolean
  openClawProspectingDispatcherReady: boolean
}

export type WhatsAppAutomationProfile = {
  phoneNumberId: string
  businessName: string
  senderIdentity: string
  serviceSummary: string
  approvedFacts: string
  escalationContact: string
  responseMode: 'handoff_only' | 'gemini' | 'openbot' | 'digibot_agent' | 'openclaw'
  openBotAgentId: string
  agentProvider: 'google' | 'anthropic' | 'openai-compatible'
  agentModel: string
  automationEnabled: boolean
  channelApprovedAt: string | null
  contentApprovedAt: string | null
  updatedAt: string
}

export type WhatsAppAutomationProfileInput = Omit<WhatsAppAutomationProfile, 'channelApprovedAt' | 'contentApprovedAt' | 'updatedAt'> & {
  channelApproved: boolean
  contentApproved: boolean
}

export type WhatsAppAgentModelChoice = {
  id: string
  label: string
}

export type WhatsAppAiProviderId = 'google' | 'anthropic' | 'openai-compatible'
export type WhatsAppAiProviderSource = 'panel' | 'server' | 'disconnected' | 'none' | 'unavailable'
export type GoogleCalendarConnectionStatus = {
  configured: boolean
  oauthClientStored?: boolean
  storageReady: boolean
  connected: boolean
  accountEmail?: string
  connectedAt?: string
}
export type WhatsAppAiProviderConnectionResult = {
  provider: WhatsAppAiProviderId
  configured: boolean
  models: WhatsAppAgentModelChoice[]
}

export class WhatsAppAiProviderOperationError extends Error {
  constructor(message: string, public readonly automationPaused: boolean) {
    super(message)
    this.name = 'WhatsAppAiProviderOperationError'
  }
}

export type WhatsAppAgentQualification = Partial<Record<'projectType' | 'objective' | 'priority' | 'timeline' | 'serviceInterest', string>>

export type WhatsAppOpenBotAgentStatus = {
  agentId: string
  agentName: string | null
  connected: boolean
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
    throw new Error('Não foi possível conectar à API WhatsApp pelo domínio do DigiBusca. Verifique se o backend e o túnel Cloudflare estão ativos.')
  }
  const payload = (await response.json().catch(() => null)) as { data?: T; error?: string } | null

  if (!response.ok || payload?.data === undefined) {
    throw new Error(payload?.error ?? 'Não foi possível carregar o WhatsApp.')
  }

  return payload.data
}

async function getGoogleCalendarData<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await whatsAppFetch(`${apiBaseUrl}/integrations/google-calendar${path}`, init)
  } catch {
    throw new Error('Não foi possível conectar ao DigiBusca para consultar o Google Agenda.')
  }
  const payload = (await response.json().catch(() => null)) as { data?: T; error?: string } | null
  if (!response.ok || payload?.data === undefined) {
    throw new Error(payload?.error ?? 'Não foi possível concluir a operação do Google Agenda.')
  }
  return payload.data
}

export function getGoogleCalendarConnectionStatus() {
  return getGoogleCalendarData<GoogleCalendarConnectionStatus>('/status')
}

export function startGoogleCalendarConnection() {
  return getGoogleCalendarData<{ authorizationUrl: string }>('/authorize', { method: 'POST' })
}

export function saveGoogleCalendarOAuthClient(input: { clientId: string; clientSecret: string }) {
  return getGoogleCalendarData<{ configured: boolean }>('/oauth-client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function disconnectGoogleCalendarConnection() {
  return getGoogleCalendarData<{ disconnected: boolean }>('/connection', { method: 'DELETE' })
}

export async function getWhatsAppEvolutionSetupStatus(): Promise<WhatsAppEvolutionSetupStatus> {
  return getWhatsAppData<WhatsAppEvolutionSetupStatus>('/whatsapp/status')
}

export async function getWhatsAppConnections(): Promise<WhatsAppConnection[]> {
  return getWhatsAppData<WhatsAppConnection[]>('/whatsapp/connections')
}

export async function registerOpenClawWhatsAppConnection(): Promise<Pick<WhatsAppConnection, 'phoneNumberId' | 'platformType' | 'connectionState'>> {
  let response: Response
  try {
    response = await whatsAppFetch(`${apiBaseUrl}/whatsapp/connections/openclaw`, { method: 'POST' })
  } catch {
    throw new Error('Não foi possível conectar ao backend para registrar o pareamento do OpenClaw.')
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: Pick<WhatsAppConnection, 'phoneNumberId' | 'platformType' | 'connectionState'>
    error?: string
  } | null
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? 'Não foi possível registrar o pareamento do OpenClaw.')
  }
  return payload.data
}

export async function getWhatsAppProspectingDashboard(): Promise<WhatsAppProspectingDashboard> {
  return getWhatsAppData<WhatsAppProspectingDashboard>('/whatsapp/prospecting')
}

export async function runWhatsAppDailyProspectingCampaign(input: { city: string; segment?: string; phoneNumberId?: string }) {
  let response: Response
  try {
    response = await whatsAppFetch(`${apiBaseUrl}/whatsapp/prospecting/campaign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error('Não foi possível conectar ao backend para fazer a busca do dia.')
  }
  const payload = (await response.json().catch(() => null)) as { data?: { campaign: WhatsAppDailyProspectingCampaign; searchedCount: number; savedCount: number; queuedCount: number }; error?: string } | null
  if (!response.ok || !payload?.data) throw new Error(payload?.error ?? 'Não foi possível concluir a busca do dia.')
  return payload.data
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

export async function enqueueWhatsAppNewLead(input: { phoneNumberId: string; leadId: string; message?: string }): Promise<WhatsAppProspectingQueueItem> {
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

export async function getWhatsAppAgentModels(provider: WhatsAppAutomationProfile['agentProvider']): Promise<WhatsAppAgentModelChoice[]> {
  return getWhatsAppData<WhatsAppAgentModelChoice[]>(`/whatsapp/agent-models?provider=${encodeURIComponent(provider)}`)
}

export async function connectWhatsAppAiProvider(input: {
  provider: WhatsAppAiProviderId
  apiKey: string
  baseUrl?: string
}): Promise<WhatsAppAiProviderConnectionResult> {
  let response: Response
  try {
    response = await whatsAppFetch(`${apiBaseUrl}/whatsapp/agent-providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error('Não foi possível conectar ao backend para validar a API do provedor.')
  }
  const payload = (await response.json().catch(() => null)) as { data?: WhatsAppAiProviderConnectionResult; error?: string; automationPaused?: boolean } | null
  if (!response.ok || !payload?.data) throw new WhatsAppAiProviderOperationError(payload?.error ?? 'Não foi possível conectar este provedor de IA.', payload?.automationPaused === true)
  return payload.data
}

export async function migrateWhatsAppAiProvider(provider: WhatsAppAiProviderId): Promise<WhatsAppAiProviderConnectionResult> {
  let response: Response
  try {
    response = await whatsAppFetch(`${apiBaseUrl}/whatsapp/agent-providers/migrate?provider=${encodeURIComponent(provider)}`, { method: 'POST' })
  } catch {
    throw new Error('Não foi possível conectar ao backend para migrar a conexão de IA.')
  }
  const payload = (await response.json().catch(() => null)) as { data?: WhatsAppAiProviderConnectionResult; error?: string; automationPaused?: boolean } | null
  if (!response.ok || !payload?.data) throw new WhatsAppAiProviderOperationError(payload?.error ?? 'Não foi possível migrar a conexão de IA para o painel.', payload?.automationPaused === true)
  return payload.data
}

export async function disconnectWhatsAppAiProvider(provider: WhatsAppAiProviderId): Promise<void> {
  let response: Response
  try {
    response = await whatsAppFetch(`${apiBaseUrl}/whatsapp/agent-providers?provider=${encodeURIComponent(provider)}`, { method: 'DELETE' })
  } catch {
    throw new Error('Não foi possível conectar ao backend para desconectar este provedor.')
  }
  const payload = (await response.json().catch(() => null)) as { error?: string; automationPaused?: boolean } | null
  if (!response.ok) throw new WhatsAppAiProviderOperationError(payload?.error ?? 'Não foi possível desconectar este provedor de IA.', payload?.automationPaused === true)
}

export async function getWhatsAppOpenBotAgentStatus(agentId: string): Promise<WhatsAppOpenBotAgentStatus> {
  return getWhatsAppData<WhatsAppOpenBotAgentStatus>(`/whatsapp/openbot/status?agentId=${encodeURIComponent(agentId)}`)
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

export async function clearWhatsAppScheduleReview(conversationId: string): Promise<void> {
  let response: Response
  try {
    response = await whatsAppFetch(`${apiBaseUrl}/whatsapp/conversations/${encodeURIComponent(conversationId)}/schedule-review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewed: true }),
    })
  } catch {
    throw new Error('Não foi possível atualizar o aviso de agendamento.')
  }
  const payload = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok) throw new Error(payload?.error ?? 'Não foi possível atualizar o aviso de agendamento.')
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
    throw new Error('Não foi possível conectar ao backend do DigiBusca.')
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

export async function getWhatsAppConversationQualification(conversationId: string): Promise<WhatsAppAgentQualification | null> {
  return getWhatsAppData<WhatsAppAgentQualification | null>(`/whatsapp/conversations/${encodeURIComponent(conversationId)}/qualification`)
}
