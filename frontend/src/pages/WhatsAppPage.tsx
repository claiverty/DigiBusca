import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, Check, CircleDashed, Inbox, MessageCircle, Pause, Play, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  connectWhatsAppEmbeddedSignup,
  getWhatsAppCloudSetupStatus,
  getWhatsAppConnections,
  getWhatsAppConversationMessages,
  getWhatsAppConversations,
  getWhatsAppAutomationProfile,
  requestWhatsAppCoexistenceSync,
  saveWhatsAppAutomationProfile,
  setWhatsAppConversationAutomationPaused,
  type WhatsAppCloudSetupStatus,
  type WhatsAppAutomationProfileInput,
  type WhatsAppConnection,
  type WhatsAppConversation,
  type WhatsAppMessage,
} from '../services/whatsappService'
import './WhatsAppPage.css'

type PageTab = 'inbox' | 'settings'
type LoadState = 'loading' | 'ready' | 'error'

const metaAppUrl = 'https://developers.facebook.com/apps/1787786145843784/use_cases/customize/api-testing-v2/?product_route=whatsapp-business&business_id=2117758865105224&use_case_enum=WHATSAPP_BUSINESS_MESSAGING&selected_tab=api-testing-v2'

function blankAutomationProfile(phoneNumberId: string): WhatsAppAutomationProfileInput {
  return {
    phoneNumberId,
    businessName: '',
    senderIdentity: '',
    serviceSummary: '',
    approvedFacts: '',
    escalationContact: '',
    automationEnabled: false,
    channelApproved: false,
    contentApproved: false,
  }
}

type FacebookLoginResponse = { authResponse?: { code?: string } }
type FacebookSignupSession = { wabaId: string; phoneNumberId?: string }
type FacebookSignupMessage = {
  type?: unknown
  event?: unknown
  data?: unknown
}
type FacebookSdk = {
  init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void
  login(callback: (response: FacebookLoginResponse) => void, options: Record<string, unknown>): void
}

declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

const initializedMetaAppIds = new Set<string>()

function loadFacebookSdk(appId: string, graphApiVersion: string): Promise<FacebookSdk> {
  return new Promise((resolve, reject) => {
    const initialize = () => {
      if (!window.FB) {
        reject(new Error('A Meta não carregou o SDK de login. Tente novamente.'))
        return
      }
      try {
        if (!initializedMetaAppIds.has(appId)) {
          window.FB.init({ appId, cookie: true, xfbml: false, version: graphApiVersion })
          initializedMetaAppIds.add(appId)
        }
        resolve(window.FB)
      } catch {
        reject(new Error('Não foi possível inicializar o login seguro da Meta.'))
      }
    }

    if (window.FB) {
      initialize()
      return
    }

    const previousCallback = window.fbAsyncInit
    window.fbAsyncInit = () => {
      previousCallback?.()
      initialize()
    }
    let script = document.getElementById('facebook-jssdk') as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = 'facebook-jssdk'
      script.async = true
      script.defer = true
      script.crossOrigin = 'anonymous'
      script.src = 'https://connect.facebook.net/pt_BR/sdk.js'
      script.onerror = () => reject(new Error('Não foi possível carregar o login da Meta.'))
      document.head.append(script)
    }
  })
}

function launchWhatsAppBusinessAppSignup(
  sdk: FacebookSdk,
  loginConfigurationId: string,
): Promise<{ code: string } & FacebookSignupSession> {
  return new Promise((resolve, reject) => {
    let code: string | undefined
    let session: FacebookSignupSession | undefined
    let settled = false
    const finish = () => {
      if (!code || !session || settled) return
      settled = true
      cleanup()
      resolve({ code, ...session })
    }
    const fail = (message: string) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(message))
    }
    const onMessage = (event: MessageEvent<unknown>) => {
      let origin: URL
      try {
        origin = new URL(event.origin)
      } catch {
        return
      }
      if (origin.protocol !== 'https:' || !(origin.hostname === 'facebook.com' || origin.hostname.endsWith('.facebook.com'))) return
      let payload = event.data
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload) as unknown } catch { return }
      }
      if (typeof payload !== 'object' || payload === null) return
      const message = payload as FacebookSignupMessage
      if (message.type !== 'WA_EMBEDDED_SIGNUP') return
      if (message.event === 'CANCEL' || message.event === 'ERROR') {
        fail(message.event === 'CANCEL' ? 'A conexão foi cancelada na janela da Meta.' : 'A Meta não concluiu o Embedded Signup.')
        return
      }
      if (message.event !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' || typeof message.data !== 'object' || message.data === null) return
      const data = message.data as Record<string, unknown>
      if (typeof data.waba_id !== 'string' || !/^\d{1,128}$/.test(data.waba_id)) return
      const phoneNumberId = typeof data.phone_number_id === 'string' && /^\d{1,128}$/.test(data.phone_number_id)
        ? data.phone_number_id
        : undefined
      session = { wabaId: data.waba_id, ...(phoneNumberId ? { phoneNumberId } : {}) }
      finish()
    }
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timeout)
    }
    const timeout = window.setTimeout(() => fail('A janela da Meta expirou antes de concluir a conexão.'), 10 * 60_000)
    window.addEventListener('message', onMessage)

    try {
      sdk.login((response) => {
        const authCode = response.authResponse?.code
        if (!authCode) {
          fail('A Meta não retornou o código temporário de autorização. Reinicie a conexão.')
          return
        }
        code = authCode
        finish()
      }, {
        config_id: loginConfigurationId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      })
    } catch {
      fail('Não foi possível abrir o Embedded Signup da Meta.')
    }
  })
}

function SetupRow({ label, configured }: { label: string; configured: boolean }) {
  return (
    <div className="whatsapp-setup-row">
      <span className={`whatsapp-setup-icon${configured ? ' is-ready' : ''}`} aria-hidden="true">
        {configured ? <Check size={15} /> : <CircleDashed size={15} />}
      </span>
      <span>{label}</span>
      <strong className={configured ? 'is-ready' : ''}>{configured ? 'Configurado' : 'Pendente'}</strong>
    </div>
  )
}

function formatWhatsAppDate(value: string | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getMessageFallback(message: WhatsAppMessage) {
  if (message.body?.trim()) return message.body
  if (message.isPlaceholder) return 'Mensagem enviada. O conteúdo não está disponível no histórico recebido pela Meta.'
  return `Mensagem ${message.messageType || 'sem texto'} recebida.`
}

function isCoexistenceSyncWindowOpen(connection: WhatsAppConnection) {
  const connectedAt = Date.parse(connection.connectedAt)
  return Number.isFinite(connectedAt) && Date.now() >= connectedAt && Date.now() - connectedAt <= 24 * 60 * 60 * 1_000
}

function hasCoexistenceSyncRequest(state: Record<string, unknown> | null) {
  return Boolean(state && (
    typeof state.requestStatus === 'string' ||
    typeof state.requestId === 'string' ||
    typeof state.requestedAt === 'string' ||
    typeof state.consentedAt === 'string'
  ))
}

function coexistenceSyncStatusLabel(state: Record<string, unknown> | null, syncType: 'history' | 'smb_app_state_sync') {
  if (!state) return 'Ainda não solicitada'
  const status = state.requestStatus ?? state.status
  if (status === 'requesting') return 'Solicitando à Meta…'
  if (status === 'accepted') return 'Solicitação aceita pela Meta'
  if (status === 'in_progress') {
    const providerState = typeof state.providerState === 'object' && state.providerState !== null
      ? state.providerState as Record<string, unknown>
      : undefined
    const progress = providerState?.progress
    if (syncType === 'history' && progress !== undefined) return `Histórico: ${String(progress).replace(/%$/, '')}% recebido`
    return syncType === 'history' ? 'Recebendo histórico' : 'Recebendo dados de contatos'
  }
  if (status === 'complete') return 'Concluída'
  if (status === 'failed') return 'A Meta reportou falha'
  if (status === 'rejected') {
    return typeof state.graphErrorCode === 'number'
      ? `A Meta recusou o pedido (código ${state.graphErrorCode})`
      : 'A Meta recusou o pedido'
  }
  if (status === 'unknown') return 'Resultado não confirmado; sem nova tentativa'
  return 'Evento de sincronização recebido'
}

export function WhatsAppPage() {
  const [activeTab, setActiveTab] = useState<PageTab>('inbox')
  const [status, setStatus] = useState<WhatsAppCloudSetupStatus | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<WhatsAppMessage[]>([])
  const [inboxState, setInboxState] = useState<LoadState>('loading')
  const [messagesState, setMessagesState] = useState<LoadState>('ready')
  const [inboxError, setInboxError] = useState('')
  const [messagesError, setMessagesError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [connections, setConnections] = useState<WhatsAppConnection[]>([])
  const [connectionsState, setConnectionsState] = useState<LoadState>('loading')
  const [connectionsError, setConnectionsError] = useState('')
  const [connectBusy, setConnectBusy] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [connectNotice, setConnectNotice] = useState('')
  const [syncBusy, setSyncBusy] = useState<Record<string, boolean>>({})
  const [syncError, setSyncError] = useState('')
  const [syncNotice, setSyncNotice] = useState('')
  const [automationPhoneNumberId, setAutomationPhoneNumberId] = useState('')
  const [automationForm, setAutomationForm] = useState<WhatsAppAutomationProfileInput>(blankAutomationProfile(''))
  const [automationPersistedEnabled, setAutomationPersistedEnabled] = useState(false)
  const [automationState, setAutomationState] = useState<LoadState>('ready')
  const [automationBusy, setAutomationBusy] = useState(false)
  const [automationError, setAutomationError] = useState('')
  const [automationNotice, setAutomationNotice] = useState('')
  const [pauseBusy, setPauseBusy] = useState(false)
  const [pauseError, setPauseError] = useState('')

  const metaAppId = import.meta.env.VITE_META_APP_ID?.trim() ?? ''
  const loginConfigurationId = import.meta.env.VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?.trim() ?? ''
  const graphApiVersion = import.meta.env.VITE_WHATSAPP_GRAPH_API_VERSION?.trim() ?? ''
  const publicSignupConfigReady = Boolean(metaAppId && loginConfigurationId && /^v\d+\.\d+$/.test(graphApiVersion))

  const loadStatus = useCallback(async () => {
    setLoadState('loading')

    try {
      setStatus(await getWhatsAppCloudSetupStatus())
      setLoadState('ready')
    } catch {
      setStatus(null)
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    let active = true
    setConnectionsState('loading')
    setConnectionsError('')
    void getWhatsAppConnections()
      .then((items) => {
        if (!active) return
        setConnections(items)
        setAutomationPhoneNumberId((current) => (
          current && items.some((connection) => connection.phoneNumberId === current)
            ? current
            : items[0]?.phoneNumberId ?? ''
        ))
        setConnectionsState('ready')
      })
      .catch((error: unknown) => {
        if (!active) return
        setConnectionsError(error instanceof Error ? error.message : 'Não foi possível carregar as conexões.')
        setConnectionsState('error')
      })
    return () => { active = false }
  }, [refreshKey])

  useEffect(() => {
    let active = true
    if (!automationPhoneNumberId) {
      setAutomationForm(blankAutomationProfile(''))
      setAutomationPersistedEnabled(false)
      setAutomationState('ready')
      return () => { active = false }
    }
    if (status?.automationStorageReady !== true) {
      setAutomationForm(blankAutomationProfile(automationPhoneNumberId))
      setAutomationPersistedEnabled(false)
      setAutomationState('ready')
      return () => { active = false }
    }
    setAutomationState('loading')
    setAutomationError('')
    setAutomationNotice('')
    void getWhatsAppAutomationProfile(automationPhoneNumberId)
      .then((profile) => {
        if (!active) return
        setAutomationPersistedEnabled(profile?.automationEnabled === true)
        setAutomationForm(profile ? {
          phoneNumberId: profile.phoneNumberId,
          businessName: profile.businessName,
          senderIdentity: profile.senderIdentity,
          serviceSummary: profile.serviceSummary,
          approvedFacts: profile.approvedFacts,
          escalationContact: profile.escalationContact,
          automationEnabled: profile.automationEnabled,
          channelApproved: Boolean(profile.channelApprovedAt),
          contentApproved: Boolean(profile.contentApprovedAt),
        } : blankAutomationProfile(automationPhoneNumberId))
        setAutomationState('ready')
      })
      .catch((error: unknown) => {
        if (!active) return
        setAutomationPersistedEnabled(false)
        setAutomationError(error instanceof Error ? error.message : 'Não foi possível carregar as regras da automação.')
        setAutomationState('error')
      })
    return () => { active = false }
  }, [automationPhoneNumberId, status?.automationStorageReady])

  useEffect(() => {
    let active = true
    setInboxState('loading')
    setInboxError('')

    void getWhatsAppConversations()
      .then((page) => {
        if (!active) return
        setConversations(page.data)
        setSelectedConversationId((current) => (
          current && page.data.some((conversation) => conversation.id === current)
            ? current
            : page.data[0]?.id ?? null
        ))
        setInboxState('ready')
      })
      .catch((error: unknown) => {
        if (!active) return
        setInboxError(error instanceof Error ? error.message : 'Não foi possível carregar as conversas.')
        setInboxState('error')
      })

    return () => { active = false }
  }, [refreshKey])

  useEffect(() => {
    let active = true
    if (!selectedConversationId) {
      setMessages([])
      setMessagesState('ready')
      setMessagesError('')
      return () => { active = false }
    }

    setMessagesState('loading')
    setMessagesError('')
    void getWhatsAppConversationMessages(selectedConversationId)
      .then((page) => {
        if (!active) return
        setMessages([...page.data].reverse())
        setMessagesState('ready')
      })
      .catch((error: unknown) => {
        if (!active) return
        setMessagesError(error instanceof Error ? error.message : 'Não foi possível carregar as mensagens.')
        setMessagesState('error')
      })

    return () => { active = false }
  }, [selectedConversationId, refreshKey])

  const sendReady = loadState === 'ready' && status?.sendReady === true
  const connectionReady = connections.some((connection) => connection.isOnBizApp)
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId)

  function updateAutomationContent(key: 'businessName' | 'senderIdentity' | 'serviceSummary' | 'approvedFacts' | 'escalationContact', value: string) {
    setAutomationForm((current) => ({ ...current, [key]: value, contentApproved: false, automationEnabled: false }))
  }

  async function saveAutomationSettings() {
    setAutomationBusy(true)
    setAutomationError('')
    setAutomationNotice('')
    try {
      const saved = await saveWhatsAppAutomationProfile(automationForm)
      setAutomationForm({
        ...automationForm,
        automationEnabled: saved.automationEnabled,
        channelApproved: Boolean(saved.channelApprovedAt),
        contentApproved: Boolean(saved.contentApprovedAt),
      })
      setAutomationPersistedEnabled(saved.automationEnabled)
      setAutomationNotice(saved.automationEnabled
        ? 'Regras salvas. A automação só responderá a novas mensagens recebidas dentro da janela permitida.'
        : 'Rascunho salvo. A automação continua desativada.')
    } catch (error) {
      setAutomationError(error instanceof Error ? error.message : 'Não foi possível salvar as regras da automação.')
    } finally {
      setAutomationBusy(false)
    }
  }

  async function toggleConversationAutomation() {
    if (!selectedConversation) return
    const nextPaused = !selectedConversation.automationPaused
    setPauseBusy(true)
    setPauseError('')
    try {
      await setWhatsAppConversationAutomationPaused(selectedConversation.id, nextPaused)
      setConversations((current) => current.map((conversation) => conversation.id === selectedConversation.id
        ? { ...conversation, automationPaused: nextPaused }
        : conversation))
    } catch (error) {
      setPauseError(error instanceof Error ? error.message : 'Não foi possível alterar a automação desta conversa.')
    } finally {
      setPauseBusy(false)
    }
  }

  async function connectWhatsAppAccount() {
    if (!publicSignupConfigReady) return
    setConnectBusy(true)
    setConnectError('')
    setConnectNotice('')
    try {
      const sdk = await loadFacebookSdk(metaAppId, graphApiVersion)
      const signup = await launchWhatsAppBusinessAppSignup(sdk, loginConfigurationId)
      await connectWhatsAppEmbeddedSignup(signup)
      setConnectNotice('WhatsApp Business conectado. Os dados da conta foram associados ao seu usuário DigiBusca.')
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : 'Não foi possível concluir a conexão do WhatsApp.')
    } finally {
      setConnectBusy(false)
    }
  }

  async function requestConnectionSync(connection: WhatsAppConnection, syncType: 'history' | 'smb_app_state_sync') {
    const label = syncType === 'history' ? 'histórico de conversas' : 'contatos e estado do app'
    const disclosure = syncType === 'history'
      ? 'A Meta poderá transferir ao DigiBusca o histórico de conversas deste número, incluindo o conteúdo de mensagens e dados pessoais. O pedido é opcional e só pode ser feito uma vez dentro da janela inicial de 24 horas.'
      : 'A Meta poderá transferir ao DigiBusca os contatos deste WhatsApp Business, incluindo nomes e números, e atualizações de estado desses contatos. O pedido é opcional e só pode ser feito uma vez dentro da janela inicial de 24 horas.'
    if (!window.confirm(`${disclosure}\n\nSolicitar sincronização de ${label}?`)) return

    const key = `${connection.phoneNumberId}:${syncType}`
    setSyncBusy((current) => ({ ...current, [key]: true }))
    setSyncError('')
    setSyncNotice('')
    try {
      await requestWhatsAppCoexistenceSync({ phoneNumberId: connection.phoneNumberId, syncType })
      setSyncNotice(`Pedido de sincronização de ${label} enviado à Meta.`)
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Não foi possível solicitar a sincronização.')
      setRefreshKey((value) => value + 1)
    } finally {
      setSyncBusy((current) => ({ ...current, [key]: false }))
    }
  }

  return (
    <section className="whatsapp-page">
      <header className="whatsapp-page-header">
        <div>
          <span className="eyebrow">ATENDIMENTO</span>
          <h1>WhatsApp Business</h1>
          <p>Conexão oficial e conversas com seus leads em um só lugar.</p>
        </div>
        <div className="whatsapp-header-actions">
          <span className={`whatsapp-connection-pill${sendReady || connectionReady ? ' is-ready' : ''}`}>
            <span aria-hidden="true" />
            {connectionsState === 'loading' ? 'Verificando conexão' : connectionReady ? 'App e Cloud API conectados' : sendReady ? 'Envio configurado' : 'Configuração pendente'}
          </span>
          <button className="icon-button whatsapp-refresh" type="button" onClick={() => { void loadStatus(); setRefreshKey((value) => value + 1) }} aria-label="Atualizar conexão e conversas" title="Atualizar conexão e conversas">
            <RefreshCw size={16} className={loadState === 'loading' ? 'is-spinning' : ''} />
          </button>
        </div>
      </header>

      {loadState === 'error' && (
        <div className="whatsapp-load-error" role="alert">
          Não foi possível consultar a conexão agora. Atualize para tentar novamente.
        </div>
      )}

      <nav className="whatsapp-tabs" role="tablist" aria-label="Seções do WhatsApp">
        <button type="button" role="tab" aria-selected={activeTab === 'inbox'} className={activeTab === 'inbox' ? 'active' : ''} onClick={() => setActiveTab('inbox')}>
          <Inbox size={16} /> Caixa de entrada
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'settings'} className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>
          <ShieldCheck size={16} /> Conexão
        </button>
      </nav>

      {activeTab === 'inbox' ? (
        <div className="whatsapp-inbox-layout" role="tabpanel">
          <aside className="panel whatsapp-conversation-list" aria-label="Conversas">
            <div className="whatsapp-inbox-heading">
              <div>
                <span className="eyebrow">MENSAGENS</span>
                <h2>Conversas</h2>
              </div>
              <span className="whatsapp-message-count">{conversations.length}</span>
            </div>
            <div className="whatsapp-conversation-items" aria-live="polite">
              {inboxState === 'loading' && <p className="whatsapp-inline-state">Carregando conversas…</p>}
              {inboxState === 'error' && <p className="whatsapp-inline-state is-error" role="alert">{inboxError}</p>}
              {inboxState === 'ready' && conversations.length === 0 && (
                <div className="whatsapp-empty-list">
                  <Inbox size={21} />
                  <strong>Nenhuma conversa recebida</strong>
                  <span>As mensagens aparecerão aqui quando o webhook estiver conectado e chegar uma resposta.</span>
                </div>
              )}
              {conversations.map((conversation) => (
                <button
                  className={`whatsapp-conversation-item${conversation.id === selectedConversationId ? ' is-active' : ''}`}
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedConversationId(conversation.id)}
                  aria-pressed={conversation.id === selectedConversationId}
                >
                  <span className="whatsapp-contact-avatar" aria-hidden="true">
                    {(conversation.contactName || conversation.contactWaId).slice(0, 1).toLocaleUpperCase('pt-BR')}
                  </span>
                  <span className="whatsapp-conversation-copy">
                    <span className="whatsapp-conversation-topline">
                      <strong>{conversation.contactName || conversation.contactWaId}</strong>
                      <time>{formatWhatsAppDate(conversation.lastMessageAt)}</time>
                    </span>
                    <span className="whatsapp-conversation-preview">{conversation.lastMessagePreview || 'Mensagem recebida'}</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className={`panel whatsapp-conversation-view${selectedConversation ? ' has-conversation' : ''}`} aria-label="Painel da conversa">
            {selectedConversation ? (
              <>
                <header className="whatsapp-thread-header">
                  <div className="whatsapp-contact-avatar" aria-hidden="true">
                    {(selectedConversation.contactName || selectedConversation.contactWaId).slice(0, 1).toLocaleUpperCase('pt-BR')}
                  </div>
                  <div>
                    <h2>{selectedConversation.contactName || selectedConversation.contactWaId}</h2>
                    <span>{selectedConversation.contactWaId}</span>
                  </div>
                </header>
                <div className="whatsapp-thread-automation">
                  <span className={selectedConversation.automationPaused ? 'is-paused' : 'is-running'}>
                    {selectedConversation.automationOptedOut ? 'Pedido de parada registrado; automação bloqueada' : selectedConversation.automationPaused ? 'Automação pausada nesta conversa' : 'Automação pode responder se estiver aprovada e ativa'}
                  </span>
                  <button className="secondary-button" type="button" onClick={() => void toggleConversationAutomation()} disabled={pauseBusy || selectedConversation.automationOptedOut === true}>
                    {selectedConversation.automationPaused ? <Play size={14} /> : <Pause size={14} />}
                    {pauseBusy ? 'Atualizando…' : selectedConversation.automationOptedOut ? 'Parada respeitada' : selectedConversation.automationPaused ? 'Retomar automação' : 'Assumir no WhatsApp'}
                  </button>
                </div>
                {pauseError && <p className="whatsapp-connect-state is-error" role="alert">{pauseError}</p>}
                <div className="whatsapp-thread-messages" aria-live="polite">
                  {messagesState === 'loading' && <p className="whatsapp-inline-state">Carregando mensagens…</p>}
                  {messagesState === 'error' && <p className="whatsapp-inline-state is-error" role="alert">{messagesError}</p>}
                  {messagesState === 'ready' && messages.length === 0 && (
                    <p className="whatsapp-inline-state">Ainda não há mensagens nesta conversa.</p>
                  )}
                  {messages.map((message) => {
                    const latestStatus = message.statuses.at(-1)?.status
                    return (
                      <article className={`whatsapp-message-bubble is-${message.direction}`} key={message.id}>
                        <p>{getMessageFallback(message)}</p>
                        <footer>
                          <time>{formatWhatsAppDate(message.occurredAt)}</time>
                          {message.direction === 'outbound' && latestStatus && <span>{latestStatus}</span>}
                        </footer>
                      </article>
                    )
                  })}
                </div>
                <p className="whatsapp-thread-note">A automação só responde a novas mensagens de texto recebidas; “Assumir no WhatsApp” pausa o bot nesta conversa.</p>
              </>
            ) : (
              <div className="whatsapp-conversation-placeholder">
                <div className="whatsapp-placeholder-icon"><MessageCircle size={25} /></div>
                <h2>Seu atendimento começa por aqui</h2>
                <p>Quando o webhook estiver conectado e alguém responder, a conversa ficará disponível nesta tela.</p>
                <button className="text-button" type="button" onClick={() => setActiveTab('settings')}>
                  Ver configuração <ArrowUpRight size={15} />
                </button>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="whatsapp-settings-layout" role="tabpanel">
          <section className="panel whatsapp-settings-card">
            <div className="whatsapp-settings-heading">
              <div className="whatsapp-settings-icon"><MessageCircle size={20} /></div>
              <div>
                <span className="eyebrow">WHATSAPP CLOUD API</span>
                <h2>{sendReady ? 'Pronto para envio individual' : 'Conexão em configuração'}</h2>
                <p>Quando configurado, o token fica somente no servidor e não aparece nesta tela.</p>
              </div>
            </div>

            <div className="whatsapp-setup-list" aria-live="polite">
              <SetupRow label="Token de acesso" configured={loadState === 'ready' && status?.accessTokenConfigured === true} />
              <SetupRow label="ID do número" configured={loadState === 'ready' && status?.phoneNumberConfigured === true} />
              <SetupRow label="Versão da Graph API" configured={loadState === 'ready' && status?.graphApiVersionConfigured === true} />
              <SetupRow label="Modelo de mensagem" configured={loadState === 'ready' && status?.templateConfigured === true} />
              <SetupRow label="Webhook de respostas" configured={loadState === 'ready' && status?.webhookReady === true} />
              <SetupRow label="Backend seguro para Embedded Signup" configured={loadState === 'ready' && status?.embeddedSignupServerReady === true} />
            </div>

            <section className="whatsapp-embedded-signup" aria-labelledby="whatsapp-embedded-signup-title">
              <div>
                <span className="eyebrow">MANTER O APP NO TELEFONE</span>
                <h3 id="whatsapp-embedded-signup-title">Conectar WhatsApp Business</h3>
                <p>O fluxo da Meta vincula o número do WhatsApp Business App à Cloud API em modo de coexistência.</p>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void connectWhatsAppAccount()}
                disabled={!publicSignupConfigReady || status?.embeddedSignupServerReady !== true || status?.connectionStorageReady !== true || connectBusy}
              >
                <ShieldCheck size={15} />
                {connectBusy ? 'Conectando à Meta…' : 'Conectar com a Meta'}
              </button>
              {!loginConfigurationId && <p className="whatsapp-connect-state is-pending">Configuração pendente: defina <code>VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID</code> em <code>frontend/.env</code> e reinicie o frontend.</p>}
              {loginConfigurationId && !metaAppId && <p className="whatsapp-connect-state is-pending">Configuração pendente: defina o App ID público em <code>VITE_META_APP_ID</code>.</p>}
              {loginConfigurationId && metaAppId && !/^v\d+\.\d+$/.test(graphApiVersion) && <p className="whatsapp-connect-state is-pending">Configuração pendente: defina a versão em <code>VITE_WHATSAPP_GRAPH_API_VERSION</code> (por exemplo, a mesma versão configurada no backend).</p>}
              {publicSignupConfigReady && status?.embeddedSignupServerReady === false && <p className="whatsapp-connect-state is-pending">O backend ainda precisa de <code>META_APP_ID</code>, <code>WHATSAPP_APP_SECRET</code>, <code>WHATSAPP_GRAPH_API_VERSION</code>, <code>WHATSAPP_TOKEN_ENCRYPTION_KEY</code> e acesso service role ao Supabase para concluir a conexão com segurança.</p>}
              {publicSignupConfigReady && status?.embeddedSignupServerReady === true && status.connectionStorageReady === false && <p className="whatsapp-connect-state is-pending">Aplique as migrations <code>009_whatsapp_webhook.sql</code> e <code>010_whatsapp_coexistence.sql</code> ao projeto Supabase desta instalação antes de abrir o Embedded Signup.</p>}
              {connectError && <p className="whatsapp-connect-state is-error" role="alert">{connectError}</p>}
              {connectNotice && <p className="whatsapp-connect-state is-ready" role="status">{connectNotice}</p>}
              {connectionsState === 'loading' && <p className="whatsapp-connect-state">Carregando conexões salvas…</p>}
              {connectionsState === 'error' && <p className="whatsapp-connect-state is-error" role="alert">{connectionsError}</p>}
              {connectionsState === 'ready' && connections.length > 0 && (
                <ul className="whatsapp-connected-numbers" aria-label="Números conectados">
                  {connections.map((connection) => (
                    <li key={connection.phoneNumberId}>
                      <span><strong>{connection.displayPhoneNumber || connection.phoneNumberId}</strong><small>{connection.isOnBizApp ? 'WhatsApp Business App + Cloud API' : 'Cloud API'}</small></span>
                      <div className="whatsapp-connected-actions">
                        <span className="whatsapp-connected-badge">Conectado</span>
                        {connection.isOnBizApp && (
                          <details className="whatsapp-sync-details">
                            <summary>Sincronização inicial</summary>
                            <p>Contatos e histórico são opcionais, enviados pela Meta e solicitados separadamente. Cada pedido pode ser feito uma única vez dentro de 24 horas da conexão.</p>
                            <div className="whatsapp-sync-row">
                              <span>
                                <strong>Contatos</strong>
                                <small>{coexistenceSyncStatusLabel(connection.appStateSyncState, 'smb_app_state_sync')}</small>
                                {typeof connection.appStateSyncState?.requestId === 'string' && <small>ID Meta: {connection.appStateSyncState.requestId}</small>}
                              </span>
                              {!hasCoexistenceSyncRequest(connection.appStateSyncState) && isCoexistenceSyncWindowOpen(connection) && (
                                <button type="button" className="secondary-button" disabled={Boolean(syncBusy[`${connection.phoneNumberId}:smb_app_state_sync`])} onClick={() => void requestConnectionSync(connection, 'smb_app_state_sync')}>
                                  {syncBusy[`${connection.phoneNumberId}:smb_app_state_sync`] ? 'Solicitando…' : 'Sincronizar contatos'}
                                </button>
                              )}
                            </div>
                            <div className="whatsapp-sync-row">
                              <span>
                                <strong>Histórico</strong>
                                <small>{coexistenceSyncStatusLabel(connection.historySyncState, 'history')}</small>
                                {typeof connection.historySyncState?.requestId === 'string' && <small>ID Meta: {connection.historySyncState.requestId}</small>}
                              </span>
                              {!hasCoexistenceSyncRequest(connection.historySyncState) && isCoexistenceSyncWindowOpen(connection) && (
                                <button type="button" className="secondary-button" disabled={Boolean(syncBusy[`${connection.phoneNumberId}:history`])} onClick={() => void requestConnectionSync(connection, 'history')}>
                                  {syncBusy[`${connection.phoneNumberId}:history`] ? 'Solicitando…' : 'Solicitar histórico'}
                                </button>
                              )}
                            </div>
                            {!isCoexistenceSyncWindowOpen(connection) && (!hasCoexistenceSyncRequest(connection.appStateSyncState) || !hasCoexistenceSyncRequest(connection.historySyncState)) && <small className="whatsapp-sync-expired">A janela inicial de sincronização encerrou.</small>}
                          </details>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {syncError && <p className="whatsapp-connect-state is-error" role="alert">{syncError}</p>}
              {syncNotice && <p className="whatsapp-connect-state is-ready" role="status">{syncNotice}</p>}
            </section>

            <section className="whatsapp-automation-panel" aria-labelledby="whatsapp-automation-title">
              <div className="whatsapp-automation-heading">
                <div>
                  <span className="eyebrow">ATENDIMENTO POR ETAPAS</span>
                  <h3 id="whatsapp-automation-title">Respostas automáticas</h3>
                  <p>O bot só responde depois de uma mensagem recebida. Ele não inicia prospecção nem dispara a saudação de abertura.</p>
                </div>
                <span className={`whatsapp-automation-pill${automationPersistedEnabled ? ' is-on' : ''}`}>
                  {automationPersistedEnabled ? (automationForm.automationEnabled ? 'Ativada' : 'Ativa até salvar') : automationForm.automationEnabled ? 'Ativação pendente' : 'Desativada'}
                </span>
              </div>

              {connections.length > 1 && (
                <label className="whatsapp-form-field">
                  <span>Número WhatsApp</span>
                  <select value={automationPhoneNumberId} onChange={(event) => setAutomationPhoneNumberId(event.target.value)}>
                    {connections.map((connection) => <option key={connection.phoneNumberId} value={connection.phoneNumberId}>{connection.displayPhoneNumber || connection.phoneNumberId}</option>)}
                  </select>
                </label>
              )}
              {connections.length === 0 && <p className="whatsapp-connect-state is-pending">Conecte um número WhatsApp antes de configurar as respostas automáticas.</p>}
              {status?.automationStorageReady === false && (
                <p className="whatsapp-connect-state is-pending">A estrutura ainda não está no Supabase. Revise e aplique a migration <code>011_whatsapp_reply_automation.sql</code> antes de salvar.</p>
              )}
              {status?.automationRuntimeEnabled === false && (
                <p className="whatsapp-connect-state is-pending">O interruptor global do servidor está desligado. Para disponibilizar ativação, configure <code>WHATSAPP_AUTOMATION_RUNTIME_ENABLED=true</code> após aprovar canal e conteúdo.</p>
              )}
              {automationState === 'loading' && <p className="whatsapp-connect-state">Carregando configuração…</p>}

              <div className="whatsapp-automation-fields">
                <label className="whatsapp-form-field">
                  <span>Nome do negócio</span>
                  <input value={automationForm.businessName} maxLength={120} onChange={(event) => updateAutomationContent('businessName', event.target.value)} placeholder="Nome que a pessoa reconhece" />
                </label>
                <label className="whatsapp-form-field">
                  <span>Como o atendente se apresenta</span>
                  <input value={automationForm.senderIdentity} maxLength={120} onChange={(event) => updateAutomationContent('senderIdentity', event.target.value)} placeholder="Ex.: Seu nome, da sua empresa" />
                </label>
                <label className="whatsapp-form-field is-wide">
                  <span>Serviço e problema que resolve</span>
                  <textarea value={automationForm.serviceSummary} maxLength={1500} rows={3} onChange={(event) => updateAutomationContent('serviceSummary', event.target.value)} placeholder="Descreva a oferta em termos que podem ser repetidos ao lead." />
                </label>
                <label className="whatsapp-form-field is-wide">
                  <span>Fatos e condições comerciais aprovados</span>
                  <textarea value={automationForm.approvedFacts} maxLength={2000} rows={3} onChange={(event) => updateAutomationContent('approvedFacts', event.target.value)} placeholder="Inclua somente escopo, preço, prazo e condições que o bot pode afirmar." />
                </label>
                <label className="whatsapp-form-field is-wide">
                  <span>Contato ou rota de atendimento humano</span>
                  <input value={automationForm.escalationContact} maxLength={180} onChange={(event) => updateAutomationContent('escalationContact', event.target.value)} placeholder="Telefone, e-mail ou instrução de transferência" />
                </label>
              </div>

              <div className="whatsapp-automation-approvals">
                <label className="whatsapp-check-row">
                  <input type="checkbox" checked={automationForm.channelApproved} onChange={(event) => setAutomationForm((current) => ({ ...current, channelApproved: event.target.checked, automationEnabled: event.target.checked && current.contentApproved ? current.automationEnabled : false }))} />
                  <span>Autorizo respostas automáticas neste número, somente após a pessoa nos escrever.</span>
                </label>
                <label className="whatsapp-check-row">
                  <input type="checkbox" checked={automationForm.contentApproved} onChange={(event) => setAutomationForm((current) => ({ ...current, contentApproved: event.target.checked, automationEnabled: event.target.checked && current.channelApproved ? current.automationEnabled : false }))} />
                  <span>Aprovo o conteúdo acima para o bot usar nesta conversa comercial.</span>
                </label>
                <label className="whatsapp-check-row is-enable">
                  <input
                    type="checkbox"
                    checked={automationForm.automationEnabled}
                    disabled={!status?.automationRuntimeEnabled || !automationForm.channelApproved || !automationForm.contentApproved}
                    onChange={(event) => setAutomationForm((current) => ({ ...current, automationEnabled: event.target.checked }))}
                  />
                  <span>Ativar respostas automáticas após salvar as aprovações.</span>
                </label>
              </div>
              <p className="whatsapp-automation-privacy">O texto recente da conversa será enviado ao Gemini para preparar cada resposta. Fora da janela de 24 horas, com recusa, pausa ou falta de dados aprovados, o bot não envia resposta automática; dúvidas fora do escopo são encaminhadas ao contato humano indicado.</p>
              {automationError && <p className="whatsapp-connect-state is-error" role="alert">{automationError}</p>}
              {automationNotice && <p className="whatsapp-connect-state is-ready" role="status">{automationNotice}</p>}
              <div className="whatsapp-automation-actions">
                <button className="secondary-button" type="button" onClick={() => void saveAutomationSettings()} disabled={automationBusy || !automationPhoneNumberId || automationState === 'loading' || status?.automationStorageReady !== true || (automationForm.automationEnabled && (!status?.automationRuntimeEnabled || !automationForm.channelApproved || !automationForm.contentApproved || !automationForm.businessName.trim() || !automationForm.senderIdentity.trim() || !automationForm.serviceSummary.trim() || !automationForm.escalationContact.trim()))}>
                  <ShieldCheck size={15} />
                  {automationBusy ? 'Salvando…' : 'Salvar regras'}
                </button>
              </div>
            </section>

            <div className="whatsapp-settings-actions">
              <button className="secondary-button" type="button" onClick={() => void loadStatus()}>
                <RefreshCw size={15} /> Atualizar status
              </button>
              <a className="text-button" href={metaAppUrl} target="_blank" rel="noreferrer">
                Abrir Meta for Developers <ArrowUpRight size={15} />
              </a>
            </div>
          </section>

        </div>
      )}
    </section>
  )
}
