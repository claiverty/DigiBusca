import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, Check, CircleDashed, Inbox, MessageCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  connectWhatsAppEmbeddedSignup,
  getWhatsAppCloudSetupStatus,
  getWhatsAppConnections,
  getWhatsAppConversationMessages,
  getWhatsAppConversations,
  type WhatsAppCloudSetupStatus,
  type WhatsAppConnection,
  type WhatsAppConversation,
  type WhatsAppMessage,
} from '../services/whatsappService'
import './WhatsAppPage.css'

type PageTab = 'inbox' | 'settings'
type LoadState = 'loading' | 'ready' | 'error'

const metaAppUrl = 'https://developers.facebook.com/apps/1787786145843784/use_cases/customize/api-testing-v2/?product_route=whatsapp-business&business_id=2117758865105224&use_case_enum=WHATSAPP_BUSINESS_MESSAGING&selected_tab=api-testing-v2'

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
                <p className="whatsapp-thread-note">Respostas automáticas e envio pelo inbox serão ativados após configurar o número e as regras de atendimento.</p>
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
                      <span className="whatsapp-connected-badge">Conectado</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="whatsapp-settings-note">
              <ShieldCheck size={17} />
              <p>O envio individual continua condicionado a um modelo aprovado e à autorização explícita do contato. A caixa de entrada só será preenchida depois da configuração do webhook.</p>
            </div>

            <div className="whatsapp-settings-actions">
              <button className="secondary-button" type="button" onClick={() => void loadStatus()}>
                <RefreshCw size={15} /> Atualizar status
              </button>
              <a className="text-button" href={metaAppUrl} target="_blank" rel="noreferrer">
                Abrir Meta for Developers <ArrowUpRight size={15} />
              </a>
            </div>
          </section>

          <aside className="panel whatsapp-policy-card">
            <span className="eyebrow">FLUXO DE CONTATO</span>
            <h2>Abordagem aprovada</h2>
            <ol>
              <li>Começar com uma saudação curta e natural.</li>
              <li>Esperar a resposta antes de perguntar sobre marketing.</li>
              <li>Preparar o diagnóstico depois que a pessoa aceitar.</li>
            </ol>
            <p>As mensagens ficam sem envio automático para leads sem autorização registrada.</p>
          </aside>
        </div>
      )}
    </section>
  )
}
