import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, CircleDashed, Inbox, MessageCircle, Pause, Play, QrCode, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import {
  connectWhatsAppEvolution,
  clearWhatsAppScheduleReview,
  getWhatsAppEvolutionPairingStatus,
  getWhatsAppEvolutionSetupStatus,
  getWhatsAppConnections,
  getWhatsAppConversationMessages,
  getWhatsAppConversationQualification,
  getWhatsAppConversations,
  getWhatsAppHumanPendingCount,
  getWhatsAppHumanPendingConversations,
  getWhatsAppAutomationProfile,
  getWhatsAppOpenBotAgentStatus,
  saveWhatsAppAutomationProfile,
  setWhatsAppConversationAutomationPaused,
  type WhatsAppEvolutionSetupStatus,
  type WhatsAppAutomationProfileInput,
  type WhatsAppConnection,
  type WhatsAppAgentQualification,
  type WhatsAppConversation,
  type WhatsAppMessage,
  type WhatsAppOpenBotAgentStatus,
} from '../services/whatsappService'
import { WhatsAppProspectingPanel } from './WhatsAppProspectingPanel'
import './WhatsAppPage.css'

type PageTab = 'inbox' | 'settings' | 'prospecting'
type LoadState = 'loading' | 'ready' | 'error'
const inboxRefreshIntervalMs = 5_000

function mergeInboxConversations(latest: WhatsAppConversation[], pending: WhatsAppConversation[]) {
  const byId = new Map<string, WhatsAppConversation>()
  for (const conversation of [...latest, ...pending]) {
    if (!byId.has(conversation.id)) byId.set(conversation.id, conversation)
  }
  return [...byId.values()].sort((left, right) => {
    const leftTimestamp = Date.parse(left.lastMessageAt ?? left.updatedAt)
    const rightTimestamp = Date.parse(right.lastMessageAt ?? right.updatedAt)
    const recentFirst = (Number.isFinite(rightTimestamp) ? rightTimestamp : 0)
      - (Number.isFinite(leftTimestamp) ? leftTimestamp : 0)
    if (recentFirst !== 0) return recentFirst

    const leftPending = left.automationPauseReason === 'handoff' || left.automationPauseReason === 'handoff_send_failed'
    const rightPending = right.automationPauseReason === 'handoff' || right.automationPauseReason === 'handoff_send_failed'
    if (leftPending !== rightPending) return leftPending ? -1 : 1
    const leftSchedule = left.automationPauseReason === 'schedule_review_required'
    const rightSchedule = right.automationPauseReason === 'schedule_review_required'
    if (leftSchedule !== rightSchedule) return leftSchedule ? -1 : 1
    return 0
  })
}

function newAutomationProfileDraft(phoneNumberId: string): WhatsAppAutomationProfileInput {
  return {
    phoneNumberId,
    businessName: 'DigiUP',
    senderIdentity: 'Cristhian, agente de atendimento da DigiUP.',
    serviceSummary: 'A DigiUP desenvolve sites profissionais e presença digital, sistemas e plataformas sob medida, integrações e APIs, automações com IA, além de manutenção e evolução de sites e sistemas. Atende empresas online em todo o Brasil. O primeiro contato é uma conversa de diagnóstico.',
    approvedFacts: [
      'A DigiUP cria sites profissionais e presença digital, sistemas e plataformas sob medida, soluções de IA e automação, integrações e APIs, além de manutenção, evolução e suporte.',
      'Atende empresas online em todo o Brasil.',
      'O primeiro contato começa com o desafio, o objetivo e o momento do negócio; a DigiUP organiza uma conversa de diagnóstico e indica o caminho adequado.',
      'Escopo, etapas, canais de acompanhamento e prazos dependem de cada projeto e são definidos em proposta. O site não publica preços.',
      'Os valores, prazos, escopo e condições comerciais são definidos conforme cada projeto e precisam ser confirmados antes de informar ao cliente.',
    ].join('\n'),
    escalationContact: 'este mesmo WhatsApp',
    responseMode: 'digibot_agent',
    openBotAgentId: '',
    agentProvider: 'google',
    agentModel: 'gemini-3.8-flash',
    automationEnabled: false,
    channelApproved: false,
    contentApproved: false,
  }
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
  if (message.isPlaceholder) return 'Mensagem enviada. O conteúdo não está disponível no histórico recebido.'
  return `Mensagem ${message.messageType || 'sem texto'} recebida.`
}

export function WhatsAppPage({ initialTab = 'inbox' }: { initialTab?: PageTab }) {
  const [activeTab, setActiveTab] = useState<PageTab>(initialTab)
  const [status, setStatus] = useState<WhatsAppEvolutionSetupStatus | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([])
  const [humanPendingCount, setHumanPendingCount] = useState(0)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<WhatsAppMessage[]>([])
  const threadMessagesRef = useRef<HTMLDivElement | null>(null)
  const loadedThreadConversationIdRef = useRef<string | null>(null)
  const lastScrolledConversationIdRef = useRef<string | null>(null)
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
  const [connectQrCode, setConnectQrCode] = useState('')
  const qrActive = Boolean(connectQrCode)
  const [automationPhoneNumberId, setAutomationPhoneNumberId] = useState('')
  const [automationForm, setAutomationForm] = useState<WhatsAppAutomationProfileInput>(newAutomationProfileDraft(''))
  const [automationPersistedEnabled, setAutomationPersistedEnabled] = useState(false)
  const [automationPersistedResponseMode, setAutomationPersistedResponseMode] = useState<'handoff_only' | 'gemini' | 'openbot' | 'digibot_agent'>('handoff_only')
  const [automationPersistedOpenBotAgentId, setAutomationPersistedOpenBotAgentId] = useState('')
  const [automationPersistedAgentProvider, setAutomationPersistedAgentProvider] = useState<'google' | 'anthropic' | 'openai-compatible'>('google')
  const [automationPersistedAgentModel, setAutomationPersistedAgentModel] = useState('gemini-3.8-flash')
  const [conversationQualification, setConversationQualification] = useState<WhatsAppAgentQualification | null>(null)
  const [openBotAgentStatus, setOpenBotAgentStatus] = useState<WhatsAppOpenBotAgentStatus | null>(null)
  const [openBotAgentCheckBusy, setOpenBotAgentCheckBusy] = useState(false)
  const [automationProfileSaved, setAutomationProfileSaved] = useState(false)
  const [automationState, setAutomationState] = useState<LoadState>('ready')
  const [automationBusy, setAutomationBusy] = useState(false)
  const [automationError, setAutomationError] = useState('')
  const [automationNotice, setAutomationNotice] = useState('')
  const [pauseBusy, setPauseBusy] = useState(false)
  const [pauseError, setPauseError] = useState('')
  const loadStatus = useCallback(async () => {
    setLoadState('loading')

    try {
      setStatus(await getWhatsAppEvolutionSetupStatus())
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
        if (items.some((connection) => connection.connectionState?.toLowerCase() === 'open')) {
          setConnectQrCode('')
          setConnectNotice('WhatsApp conectado à Evolution API.')
        }
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
    if (!qrActive) return
    let active = true
    let timer: number
    const refreshQr = async () => {
      try {
        const result = await getWhatsAppEvolutionPairingStatus()
        if (!active) return
        if (result.state.toLowerCase() === 'open') {
          setConnectQrCode('')
          setConnectNotice('WhatsApp conectado à Evolution API.')
          setRefreshKey((value) => value + 1)
          return
        }
        if (result.state.toLowerCase() !== 'connecting' || !result.qrCode) {
          setConnectQrCode('')
          setConnectNotice('O QR Code expirou. Gere um novo para tentar novamente.')
          return
        }
        setConnectQrCode(result.qrCode)
        timer = window.setTimeout(() => void refreshQr(), 3_000)
      } catch {
        if (!active) return
        setConnectQrCode('')
        setConnectError('Não foi possível atualizar o QR Code. Gere um novo para tentar novamente.')
      }
    }
    timer = window.setTimeout(() => void refreshQr(), 3_000)
    return () => { active = false; window.clearTimeout(timer) }
  }, [qrActive])

  useEffect(() => {
    let active = true
    if (!automationPhoneNumberId) {
      setAutomationForm(newAutomationProfileDraft(''))
      setAutomationPersistedEnabled(false)
      setAutomationPersistedResponseMode('handoff_only')
      setAutomationPersistedOpenBotAgentId('')
      setOpenBotAgentStatus(null)
      setAutomationProfileSaved(false)
      setAutomationState('ready')
      return () => { active = false }
    }
    if (status?.automationStorageReady !== true) {
      setAutomationForm(newAutomationProfileDraft(automationPhoneNumberId))
      setAutomationPersistedEnabled(false)
      setAutomationPersistedResponseMode('handoff_only')
      setAutomationPersistedOpenBotAgentId('')
      setOpenBotAgentStatus(null)
      setAutomationProfileSaved(false)
      setAutomationState('ready')
      return () => { active = false }
    }
    setAutomationState('loading')
    setAutomationProfileSaved(false)
    setAutomationError('')
    setAutomationNotice('')
    void getWhatsAppAutomationProfile(automationPhoneNumberId)
      .then((profile) => {
        if (!active) return
        setAutomationPersistedEnabled(profile?.automationEnabled === true)
        setAutomationPersistedResponseMode(profile?.responseMode ?? 'handoff_only')
        setAutomationPersistedOpenBotAgentId(profile?.openBotAgentId ?? '')
        setAutomationPersistedAgentProvider(profile?.agentProvider ?? 'google')
        setAutomationPersistedAgentModel(profile?.agentModel ?? 'gemini-3.8-flash')
        setOpenBotAgentStatus(null)
        setAutomationProfileSaved(Boolean(profile))
        setAutomationForm(profile ? {
          phoneNumberId: profile.phoneNumberId,
          businessName: profile.businessName,
          senderIdentity: profile.senderIdentity,
          serviceSummary: profile.serviceSummary,
          approvedFacts: profile.approvedFacts,
          escalationContact: profile.escalationContact,
          responseMode: profile.responseMode,
          openBotAgentId: profile.openBotAgentId,
          agentProvider: profile.agentProvider,
          agentModel: profile.agentModel,
          automationEnabled: profile.automationEnabled,
          channelApproved: Boolean(profile.channelApprovedAt),
          contentApproved: Boolean(profile.contentApprovedAt),
        } : newAutomationProfileDraft(automationPhoneNumberId))
        setAutomationState('ready')
      })
      .catch((error: unknown) => {
        if (!active) return
        setAutomationPersistedEnabled(false)
        setAutomationPersistedResponseMode('handoff_only')
        setAutomationPersistedOpenBotAgentId('')
        setAutomationPersistedAgentProvider('google')
        setAutomationPersistedAgentModel('gemini-3.8-flash')
        setOpenBotAgentStatus(null)
        setAutomationProfileSaved(false)
        setAutomationError(error instanceof Error ? error.message : 'Não foi possível carregar as regras da automação.')
        setAutomationState('error')
      })
    return () => { active = false }
  }, [automationPhoneNumberId, status?.automationStorageReady])

  useEffect(() => {
    let active = true
    setInboxState('loading')
    setInboxError('')

    void Promise.all([
      getWhatsAppConversations(),
      getWhatsAppHumanPendingConversations().catch(() => []),
    ])
      .then(([page, pending]) => {
        if (!active) return
        const items = mergeInboxConversations(Array.isArray(page?.data) ? page.data : [], pending)
        setConversations(items)
        setSelectedConversationId((current) => (
          current && items.some((conversation) => conversation.id === current)
            ? current
            : items[0]?.id ?? null
        ))
        setInboxState('ready')
      })
      .catch((error: unknown) => {
        if (!active) return
        setInboxError(error instanceof Error ? error.message : 'Não foi possível carregar as conversas.')
        setInboxState('error')
      })
    void getWhatsAppHumanPendingCount()
      .then((count) => {
        if (active) setHumanPendingCount(count)
      })
      .catch(() => undefined)

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
        loadedThreadConversationIdRef.current = selectedConversationId
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

  useEffect(() => {
    let active = true
    setConversationQualification(null)
    if (!selectedConversationId) return () => { active = false }
    void getWhatsAppConversationQualification(selectedConversationId)
      .then((qualification) => {
        if (active) setConversationQualification(qualification)
      })
      .catch(() => {
        if (active) setConversationQualification(null)
      })
    return () => { active = false }
  }, [selectedConversationId, refreshKey])

  useEffect(() => {
    if (activeTab !== 'inbox') return
    let active = true
    let refreshInProgress = false

    const refreshInbox = async () => {
      if (!active || refreshInProgress || document.visibilityState === 'hidden') return
      refreshInProgress = true
      try {
        await Promise.all([
          getWhatsAppConversations()
            .then(async (page) => {
              if (!active) return
              const pending = await getWhatsAppHumanPendingConversations().catch(() => [])
              const items = mergeInboxConversations(Array.isArray(page?.data) ? page.data : [], pending)
              setConversations(items)
              setSelectedConversationId((current) => (
                current && items.some((conversation) => conversation.id === current)
                  ? current
                  : items[0]?.id ?? null
              ))
              setInboxError('')
              setInboxState('ready')
            })
            .catch((error: unknown) => {
              if (!active) return
              setInboxError(error instanceof Error ? error.message : 'Não foi possível atualizar as conversas.')
              setInboxState('error')
            }),
          getWhatsAppHumanPendingCount()
            .then((count) => {
              if (active) setHumanPendingCount(count)
            })
            .catch(() => undefined),
          selectedConversationId
            ? getWhatsAppConversationMessages(selectedConversationId)
              .then((page) => {
                if (!active) return
                loadedThreadConversationIdRef.current = selectedConversationId
                setMessages([...page.data].reverse())
                setMessagesError('')
                setMessagesState('ready')
              })
              .catch((error: unknown) => {
                if (!active) return
                setMessagesError(error instanceof Error ? error.message : 'Não foi possível atualizar as mensagens.')
                setMessagesState('error')
              })
            : Promise.resolve(),
        ])
      } finally {
        refreshInProgress = false
      }
    }

    const interval = window.setInterval(() => { void refreshInbox() }, inboxRefreshIntervalMs)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshInbox()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [activeTab, selectedConversationId])

  const sendReady = loadState === 'ready' && status?.evolutionConfigured === true
  const connectionReady = connections.some((connection) => connection.connectionState?.toLowerCase() === 'open')
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId)

  useLayoutEffect(() => {
    if (!selectedConversationId) {
      lastScrolledConversationIdRef.current = null
      return
    }
    const container = threadMessagesRef.current
    if (!container) return
    if (lastScrolledConversationIdRef.current !== selectedConversationId) {
      if (loadedThreadConversationIdRef.current !== selectedConversationId) return
      container.scrollTop = container.scrollHeight
      lastScrolledConversationIdRef.current = selectedConversationId
      return
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    if (distanceFromBottom < 96) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }, [messages.at(-1)?.id, messagesState, selectedConversationId])

  function updateAutomationContent(key: 'businessName' | 'senderIdentity' | 'serviceSummary' | 'approvedFacts' | 'escalationContact', value: string) {
    setAutomationForm((current) => ({ ...current, [key]: value, contentApproved: false, automationEnabled: false }))
  }

  async function checkOpenBotAgent() {
    const agentId = automationForm.openBotAgentId.trim()
    if (!agentId) {
      setAutomationError('Informe o ID do agente dedicado Cristhian antes de verificar.')
      return
    }
    setOpenBotAgentCheckBusy(true)
    setAutomationError('')
    setAutomationNotice('')
    try {
      const result = await getWhatsAppOpenBotAgentStatus(agentId)
      setOpenBotAgentStatus(result)
      if (!result.connected) setAutomationError('O agente não está disponível na bridge privada da Local scripts API.')
    } catch (error) {
      setOpenBotAgentStatus(null)
      setAutomationError(error instanceof Error ? error.message : 'Não foi possível verificar o agente OpenBot.')
    } finally {
      setOpenBotAgentCheckBusy(false)
    }
  }

  async function saveAutomationSettings() {
    const responseModeChanged = automationProfileSaved && automationPersistedResponseMode !== automationForm.responseMode
    const openBotAgentChanged = automationProfileSaved && automationPersistedOpenBotAgentId !== automationForm.openBotAgentId
    const agentProviderChanged = automationProfileSaved && automationPersistedAgentProvider !== automationForm.agentProvider
    const agentModelChanged = automationProfileSaved && automationPersistedAgentModel !== automationForm.agentModel
    setAutomationBusy(true)
    setAutomationError('')
    setAutomationNotice('')
    try {
      const saved = await saveWhatsAppAutomationProfile(automationForm)
      setAutomationForm({
        ...automationForm,
        responseMode: saved.responseMode,
        openBotAgentId: saved.openBotAgentId,
        agentProvider: saved.agentProvider,
        agentModel: saved.agentModel,
        automationEnabled: saved.automationEnabled,
        channelApproved: Boolean(saved.channelApprovedAt),
        contentApproved: Boolean(saved.contentApprovedAt),
      })
      setAutomationPersistedEnabled(saved.automationEnabled)
      setAutomationPersistedResponseMode(saved.responseMode)
      setAutomationPersistedOpenBotAgentId(saved.openBotAgentId)
      setAutomationPersistedAgentProvider(saved.agentProvider)
      setAutomationPersistedAgentModel(saved.agentModel)
      setAutomationProfileSaved(true)
      setAutomationNotice(saved.automationEnabled
        ? 'Regras salvas. A automação só responderá a novas mensagens recebidas dentro da janela permitida.'
        : responseModeChanged || openBotAgentChanged || agentProviderChanged || agentModelChanged
          ? 'Modo atualizado. As respostas foram pausadas e a aprovação do conteúdo precisa ser feita novamente antes de ativar.'
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

  async function clearScheduleReview() {
    if (!selectedConversation) return
    setPauseBusy(true)
    setPauseError('')
    try {
      await clearWhatsAppScheduleReview(selectedConversation.id)
      setConversations((current) => current.map((conversation) => conversation.id === selectedConversation.id
        ? { ...conversation, automationPauseReason: undefined }
        : conversation))
    } catch (error) {
      setPauseError(error instanceof Error ? error.message : 'Não foi possível atualizar o aviso de agendamento.')
    } finally {
      setPauseBusy(false)
    }
  }

  async function connectWhatsAppAccount() {
    setConnectBusy(true)
    setConnectError('')
    setConnectNotice('')
    try {
      const result = await connectWhatsAppEvolution()
      setConnectQrCode(result.qrCode ?? '')
      setConnectNotice(result.qrCode
        ? 'Leia o QR Code no WhatsApp do celular: Aparelhos conectados → Conectar aparelho.'
        : result.state.toLowerCase() === 'open' ? 'WhatsApp conectado à Evolution API.' : 'Instância Evolution iniciada. Atualize o estado em alguns segundos.')
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : 'Não foi possível concluir a conexão do WhatsApp.')
    } finally {
      setConnectBusy(false)
    }
  }

  const openBotCanEnable = Boolean(
    status?.openBotReplyRuntimeEnabled &&
    status.openBotBridgeConfigured &&
    status.openBotAgentSafetyConfirmed &&
    openBotAgentStatus?.connected &&
    openBotAgentStatus.agentId === automationForm.openBotAgentId.trim(),
  )
  const digiBuscaAgentProviderConfigured = automationForm.agentProvider === 'google'
    ? status?.agentProviders?.google === true
    : automationForm.agentProvider === 'anthropic'
      ? status?.agentProviders?.anthropic === true
      : status?.agentProviders?.openaiCompatible === true
  const digiBuscaAgentCanEnable = Boolean(
    status?.digiBuscaAgentRuntimeEnabled && status.digiBuscaAgentStorageReady && digiBuscaAgentProviderConfigured,
  )

  return (
    <section className="whatsapp-page">
      <header className="whatsapp-page-header">
        <div>
          <span className="eyebrow">ATENDIMENTO</span>
          <h1>WhatsApp Business</h1>
          <p>Conecte pela Evolution API e acompanhe as conversas com seus leads em um só lugar.</p>
        </div>
        <div className="whatsapp-header-actions">
          <span className={`whatsapp-connection-pill${sendReady || connectionReady ? ' is-ready' : ''}`}>
            <span aria-hidden="true" />
            {connectionsState === 'loading' ? 'Verificando conexão' : connectionReady ? 'Evolution conectada' : sendReady ? 'Evolution configurada' : 'Configuração pendente'}
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
        <button type="button" role="tab" aria-selected={activeTab === 'prospecting'} className={activeTab === 'prospecting' ? 'active' : ''} onClick={() => setActiveTab('prospecting')}>
          <Send size={16} /> Prospecção
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
            {humanPendingCount > 0 && (
              <p className="whatsapp-inbox-handoff-alert" role="status">
                {humanPendingCount === 1 ? '1 conversa precisa da sua resposta.' : `${humanPendingCount} conversas precisam da sua resposta.`}
              </p>
            )}
            {conversations.some((conversation) => conversation.automationPauseReason === 'schedule_review_required') && (
              <p className="whatsapp-inbox-scheduling-alert" role="status">
                {conversations.filter((conversation) => conversation.automationPauseReason === 'schedule_review_required').length === 1
                  ? '1 pedido de agenda precisa da sua conferência.'
                  : `${conversations.filter((conversation) => conversation.automationPauseReason === 'schedule_review_required').length} pedidos de agenda precisam da sua conferência.`}
              </p>
            )}
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
                    {(conversation.automationPauseReason === 'handoff' || conversation.automationPauseReason === 'handoff_send_failed' || conversation.automationPauseReason === 'provider_unavailable' || conversation.automationPauseReason === 'schedule_review_required') && (
                      <span className="whatsapp-conversation-handoff">
                        {conversation.automationPauseReason === 'schedule_review_required' ? 'Pedido de agenda' : conversation.automationPauseReason === 'provider_unavailable' ? 'Gemini indisponível; tentar novamente' : conversation.automationPauseReason === 'handoff_send_failed' ? 'Falha de envio anterior' : 'Atendimento humano pendente'}
                      </span>
                    )}
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
                    {selectedConversation.automationOptedOut ? 'Pedido de parada registrado; automação bloqueada' : selectedConversation.automationPauseReason === 'schedule_review_required' ? 'Pedido de agenda para conferir; automação continua ativa' : selectedConversation.automationPauseReason === 'provider_unavailable' ? 'Gemini temporariamente indisponível; resposta pendente' : selectedConversation.automationPauseReason === 'handoff_send_failed' ? 'Falha de envio anterior; automação pausada' : selectedConversation.automationPauseReason === 'handoff' ? 'Atendimento humano pendente; automação pausada' : selectedConversation.automationPaused ? 'Automação pausada nesta conversa' : 'Automação pode responder se estiver aprovada e ativa'}
                  </span>
                  {selectedConversation.automationPauseReason === 'schedule_review_required' && !selectedConversation.automationPaused ? (
                    <button className="secondary-button" type="button" onClick={() => void clearScheduleReview()} disabled={pauseBusy}>
                      <Check size={14} />
                      {pauseBusy ? 'Atualizando…' : 'Marcar como conferido'}
                    </button>
                  ) : (
                    <button className="secondary-button" type="button" onClick={() => void toggleConversationAutomation()} disabled={pauseBusy || selectedConversation.automationOptedOut === true}>
                      {selectedConversation.automationPaused ? <Play size={14} /> : <Pause size={14} />}
                      {pauseBusy ? 'Atualizando…' : selectedConversation.automationOptedOut ? 'Parada respeitada' : selectedConversation.automationPauseReason === 'provider_unavailable' ? 'Tentar resposta novamente' : selectedConversation.automationPaused ? 'Retomar automação' : 'Assumir no WhatsApp'}
                    </button>
                  )}
                </div>
                {selectedConversation.automationPauseReason === 'schedule_review_required' && (
                  <p className="whatsapp-thread-note is-scheduling" role="status">O Cristhian continua atendendo e já pediu para conferir a agenda. Verifique a disponibilidade e confirme o horário no WhatsApp; depois marque este aviso como conferido.</p>
                )}
                {selectedConversation.automationPauseReason === 'handoff' && (
                  <p className="whatsapp-thread-note" role="status">A automação foi pausada para esta conversa. Revise o histórico e responda manualmente pelo WhatsApp conectado; retome a automação quando estiver pronto.</p>
                )}
                {selectedConversation.automationPauseReason === 'provider_unavailable' && (
                  <p className="whatsapp-thread-note" role="alert">O Gemini não respondeu após três tentativas. Use “Tentar resposta novamente” para responder à última mensagem pendente. Uma nova mensagem também libera uma nova tentativa.</p>
                )}
                {selectedConversation.automationPauseReason === 'handoff_send_failed' && (
                  <p className="whatsapp-thread-note" role="alert">Uma tentativa de envio anterior falhou. A automação permanece pausada; confira o WhatsApp conectado e responda por lá.</p>
                )}
                {conversationQualification && Object.keys(conversationQualification).length > 0 && (
                  <aside className="whatsapp-agent-summary" aria-label="Informações de projeto identificadas pelo Cristhian">
                    <span className="eyebrow">RESUMO DO PROJETO</span>
                    {([
                      ['projectType', 'Projeto'], ['objective', 'Objetivo'], ['priority', 'Prioridade'],
                      ['timeline', 'Prazo mencionado'], ['serviceInterest', 'Serviço de interesse'],
                    ] as const).filter(([key]) => conversationQualification[key]).map(([key, label]) => (
                      <p key={key}><strong>{label}:</strong> {conversationQualification[key]}</p>
                    ))}
                    <small>Dados registrados a partir de mensagens recebidas do lead.</small>
                  </aside>
                )}
                {pauseError && <p className="whatsapp-connect-state is-error" role="alert">{pauseError}</p>}
                <div className="whatsapp-thread-messages" aria-live="polite" ref={threadMessagesRef}>
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
                <p className="whatsapp-thread-note">As mensagens atualizam automaticamente a cada 5 segundos enquanto a aba estiver aberta. “Assumir no WhatsApp” pausa o bot nesta conversa.</p>
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
      ) : activeTab === 'settings' ? (
        <div className="whatsapp-settings-layout" role="tabpanel">
          <section className="panel whatsapp-settings-card">
            <div className="whatsapp-settings-heading">
              <div className="whatsapp-settings-icon"><MessageCircle size={20} /></div>
              <div>
                <span className="eyebrow">EVOLUTION API · WHATSAPP WEB</span>
                <h2>{connectionReady ? 'WhatsApp conectado' : 'Conectar pelo QR Code'}</h2>
                <p>A sessão é mantida pela Evolution API no servidor de WhatsApp conectado à sua conta DigiBusca.</p>
              </div>
            </div>

            <div className="whatsapp-setup-list" aria-live="polite">
              <SetupRow label="Evolution API configurada" configured={loadState === 'ready' && status?.evolutionConfigured === true} />
              <SetupRow label="Webhook local protegido" configured={loadState === 'ready' && status?.webhookConfigured === true} />
              <SetupRow label="Chave de serviço Supabase" configured={loadState === 'ready' && status?.persistenceConfigured === true} />
              <SetupRow label="Armazenamento de conexões" configured={loadState === 'ready' && status?.connectionStorageReady === true} />
            </div>

            <section className="whatsapp-embedded-signup" aria-labelledby="whatsapp-evolution-title">
              <div>
                <span className="eyebrow">PAREAMENTO PELO CELULAR</span>
                <h3 id="whatsapp-evolution-title">Conectar WhatsApp</h3>
                <p>No celular, abra WhatsApp → Aparelhos conectados → Conectar aparelho e leia o QR Code.</p>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void connectWhatsAppAccount()}
                disabled={status?.integrationEnabled !== true || !status?.evolutionConfigured || status?.connectionStorageReady !== true || connectBusy}
              >
                <QrCode size={15} />
                {connectBusy ? 'Preparando QR Code…' : connectionReady ? 'Atualizar conexão' : 'Gerar QR Code'}
              </button>
              {loadState === 'ready' && status?.integrationEnabled === false && <p className="whatsapp-connect-state is-pending">Ative <code>WHATSAPP_INTEGRATION_ENABLED=true</code> em <code>backend/.env</code> para liberar as rotas de conexão. As automações continuam desligadas pelos runtimes separados.</p>}
              {loadState === 'ready' && status?.evolutionConfigured === false && <p className="whatsapp-connect-state is-pending">Configure <code>EVOLUTION_API_URL</code>, <code>EVOLUTION_API_KEY</code>, <code>EVOLUTION_WEBHOOK_SECRET</code> e <code>EVOLUTION_WEBHOOK_URL</code> em <code>backend/.env</code>.</p>}
              {status?.persistenceConfigured === false && <p className="whatsapp-connect-state is-pending">Configure <code>SUPABASE_SERVICE_ROLE_KEY</code> em <code>backend/.env</code> para salvar a conexão e as mensagens recebidas.</p>}
              {status?.persistenceConfigured === true && status.connectionStorageReady === false && <p className="whatsapp-connect-state is-pending">Aplique as migrations <code>009_whatsapp_webhook.sql</code> e <code>010_whatsapp_coexistence.sql</code> no Supabase antes do pareamento.</p>}
              {connectError && <p className="whatsapp-connect-state is-error" role="alert">{connectError}</p>}
              {connectNotice && <p className="whatsapp-connect-state is-ready" role="status">{connectNotice}</p>}
              {connectQrCode && <div className="whatsapp-evolution-qr"><img src={connectQrCode} alt="QR Code para conectar o WhatsApp" /><span>Aguarde a confirmação do pareamento nesta tela.</span></div>}
              {connectionsState === 'loading' && <p className="whatsapp-connect-state">Carregando estado da instância…</p>}
              {connectionsState === 'error' && <p className="whatsapp-connect-state is-error" role="alert">{connectionsError}</p>}
              {connectionsState === 'ready' && connections.length > 0 && (
                <ul className="whatsapp-connected-numbers" aria-label="Instâncias Evolution">
                  {connections.map((connection) => (
                    <li key={connection.phoneNumberId}>
                      <span><strong>{connection.displayPhoneNumber || connection.phoneNumberId}</strong><small>Evolution API · {connection.connectionState || 'estado desconhecido'}</small></span>
                      <span className={`whatsapp-connected-badge${connection.connectionState?.toLowerCase() === 'open' ? '' : ' is-pending'}`}>{connection.connectionState?.toLowerCase() === 'open' ? 'Conectado' : 'Aguardando conexão'}</span>
                    </li>
                  ))}
                </ul>
              )}
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
                <p className="whatsapp-connect-state is-pending">A estrutura de atendimento ainda não está completa no Supabase. Aplique as migrations <code>011_whatsapp_reply_automation.sql</code>, <code>014_whatsapp_automation_response_mode.sql</code>, <code>016_whatsapp_openbot_replies.sql</code> e <code>019_digibot_agent_runtime.sql</code> antes de salvar.</p>
              )}
              {status?.automationRuntimeEnabled === false && (
                <p className="whatsapp-connect-state is-pending">O interruptor global do servidor está desligado. Para disponibilizar ativação, configure <code>WHATSAPP_AUTOMATION_RUNTIME_ENABLED=true</code> após aprovar canal e conteúdo.</p>
              )}
              {automationState === 'loading' && <p className="whatsapp-connect-state">Carregando configuração…</p>}

              {automationState === 'ready' && !automationProfileSaved && (
                <p className="whatsapp-connect-state is-pending">Rascunho inicial baseado no site público da DigiUP. Ele não inclui preços; revise os fatos e a rota humana antes de aprovar. As aprovações deste rascunho começam desligadas.</p>
              )}

              <div className="whatsapp-automation-fields">
                <label className="whatsapp-form-field is-wide">
                  <span>Como o bot deve operar</span>
                  <select
                    value={automationForm.responseMode}
                    onChange={(event) => {
                      const responseMode = event.target.value as WhatsAppAutomationProfileInput['responseMode']
                      setAutomationForm((current) => ({ ...current, responseMode, contentApproved: false, automationEnabled: false }))
                      setOpenBotAgentStatus(null)
                    }}
                  >
                    <option value="handoff_only">Somente atendimento humano</option>
                    <option value="digibot_agent">Agente Cristhian gerenciado pelo DigiBusca</option>
                    <option value="gemini">Responder com Gemini dentro dos fatos aprovados</option>
                    <option value="openbot">Responder com o agente OpenBot Cristhian</option>
                  </select>
                  <small>{automationForm.responseMode === 'handoff_only'
                    ? 'O texto da conversa não é enviado ao Gemini. Quando precisar de você, a conversa pausa e aparece como atendimento humano pendente na caixa de entrada; o lead não recebe aviso de transferência.'
                    : automationForm.responseMode === 'openbot'
                      ? 'O agente dedicado redige a resposta em JSON com os fatos aprovados e o histórico recente sanitizado. O backend aplica as validações e é o único componente que pode enviar pela Evolution.'
                      : automationForm.responseMode === 'digibot_agent'
                        ? 'O Cristhian roda no backend do DigiBusca, usa o histórico recente e fatos aprovados, pode registrar dados do projeto que o lead declarou e pedir sua entrada quando necessário. A chave do provedor fica somente na VPS; no Google, Gemini 3.5 Flash assume se o modelo principal falhar.'
                        : 'O Gemini recebe o histórico recente para responder com base nos fatos aprovados. Pedidos comerciais sem condições aprovadas, pedidos de atendimento humano e assuntos sensíveis ficam pendentes para você, sem aviso de transferência ao lead.'}</small>
                </label>
                {automationForm.responseMode === 'digibot_agent' && (
                  <div className="whatsapp-form-field is-wide">
                    <strong>Agente Cristhian · runtime do DigiBusca</strong>
                    <label htmlFor="whatsapp-agent-provider">Provedor configurado no backend</label>
                    <select
                      id="whatsapp-agent-provider"
                      value={automationForm.agentProvider}
                      onChange={(event) => setAutomationForm((current) => ({ ...current, agentProvider: event.target.value as WhatsAppAutomationProfileInput['agentProvider'], contentApproved: false, automationEnabled: false }))}
                    >
                      <option value="google">Google Gemini {status?.agentProviders?.google ? '· configurado' : '· sem chave no backend'}</option>
                      <option value="anthropic">Anthropic {status?.agentProviders?.anthropic ? '· configurado' : '· sem chave no backend'}</option>
                      <option value="openai-compatible">OpenAI compatível {status?.agentProviders?.openaiCompatible ? '· configurado' : '· sem chave/base URL no backend'}</option>
                    </select>
                    <label htmlFor="whatsapp-agent-model">Modelo</label>
                    <input
                      id="whatsapp-agent-model"
                      value={automationForm.agentModel}
                      maxLength={128}
                      autoComplete="off"
                      onChange={(event) => setAutomationForm((current) => ({ ...current, agentModel: event.target.value.trim(), contentApproved: false, automationEnabled: false }))}
                      placeholder="Ex.: gemini-3.8-flash"
                    />
                    {!status?.digiBuscaAgentStorageReady && <small>Aplique <code>019_digibot_agent_runtime.sql</code> para salvar qualificações do projeto.</small>}
                    {!status?.digiBuscaAgentRuntimeEnabled && <small>O runtime está desligado no servidor. Configure <code>WHATSAPP_DIGIBOT_AGENT_RUNTIME_ENABLED=true</code> depois de revisar a configuração.</small>}
                    {!digiBuscaAgentProviderConfigured && <small>Este provedor não tem credenciais completas na VPS. As chaves nunca são enviadas ao navegador.</small>}
                  </div>
                )}
                {automationForm.responseMode === 'openbot' && (
                  <div className="whatsapp-form-field is-wide">
                    <label htmlFor="whatsapp-openbot-agent-id">Agent ID dedicado Cristhian</label>
                    <input
                      id="whatsapp-openbot-agent-id"
                      value={automationForm.openBotAgentId}
                      maxLength={128}
                      autoComplete="off"
                      onChange={(event) => {
                        setAutomationForm((current) => ({ ...current, openBotAgentId: event.target.value.trim(), contentApproved: false, automationEnabled: false }))
                        setOpenBotAgentStatus(null)
                      }}
                      placeholder="ID fixo do agente autorizado"
                    />
                    <button className="secondary-button" type="button" onClick={() => void checkOpenBotAgent()} disabled={openBotAgentCheckBusy || !automationForm.openBotAgentId.trim()}>
                      {openBotAgentCheckBusy ? 'Verificando…' : 'Verificar agente'}
                    </button>
                    {openBotAgentStatus && <small role="status">{openBotAgentStatus.connected ? `Conectado: ${openBotAgentStatus.agentName ?? 'agente sem nome'}` : 'Agente não conectado ou fora da allowlist da bridge.'}</small>}
                    {!status?.openBotReplyRuntimeEnabled && <small>Indisponível por padrão. Exige bridge privada local, agente allowlisted e confirmação operacional de isolamento.</small>}
                    <small>A API não comprova as ferramentas, memória persistente ou arquivos acessíveis ao agente. Configure-o sem ferramentas de Evolution, WhatsApp, prospecção ou envio e não monte credenciais do backend no serviço OpenBot.</small>
                  </div>
                )}
                <label className="whatsapp-form-field">
                  <span>Nome do negócio</span>
                  <input value={automationForm.businessName} maxLength={120} onChange={(event) => updateAutomationContent('businessName', event.target.value)} placeholder="Nome que a pessoa reconhece" />
                </label>
                <label className="whatsapp-form-field">
                  <span>Como o atendente se apresenta</span>
                  <input value={automationForm.senderIdentity} maxLength={120} onChange={(event) => updateAutomationContent('senderIdentity', event.target.value)} placeholder="Ex.: Cristhian, agente de atendimento da DigiUP" />
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
                  <span>{automationForm.responseMode === 'handoff_only'
                    ? 'Aprovo a pausa da automação e o aviso interno de atendimento humano pendente.'
                    : automationForm.responseMode === 'openbot'
                      ? 'Aprovo o envio dos fatos e do histórico recente sanitizado ao agente OpenBot dedicado para redigir respostas.'
                      : automationForm.responseMode === 'digibot_agent'
                        ? 'Aprovo o envio do histórico recente sanitizado ao agente Cristhian do DigiBusca e o registro das informações de projeto declaradas pelo lead.'
                        : 'Aprovo os fatos acima e o envio das mensagens recentes ao Gemini para preparar respostas.'}</span>
                </label>
                <label className="whatsapp-check-row is-enable">
                  <input
                    type="checkbox"
                    checked={automationForm.automationEnabled}
                    disabled={!status?.automationRuntimeEnabled || !automationForm.channelApproved || !automationForm.contentApproved || (automationForm.responseMode === 'openbot' && !openBotCanEnable) || (automationForm.responseMode === 'digibot_agent' && !digiBuscaAgentCanEnable) || (automationProfileSaved && (automationPersistedResponseMode !== automationForm.responseMode || automationPersistedOpenBotAgentId !== automationForm.openBotAgentId || automationPersistedAgentProvider !== automationForm.agentProvider || automationPersistedAgentModel !== automationForm.agentModel))}
                    onChange={(event) => setAutomationForm((current) => ({ ...current, automationEnabled: event.target.checked }))}
                  />
                  <span>Ativar respostas automáticas após salvar as aprovações.</span>
                </label>
              </div>
              {automationPersistedEnabled && (automationPersistedResponseMode !== automationForm.responseMode || automationPersistedOpenBotAgentId !== automationForm.openBotAgentId || automationPersistedAgentProvider !== automationForm.agentProvider || automationPersistedAgentModel !== automationForm.agentModel) && (
                <p className="whatsapp-connect-state is-pending" role="alert">
                  A mudança de modo ou agente está somente no rascunho. Salvar pausa as respostas e exige nova aprovação do conteúdo.
                </p>
              )}
              <p className="whatsapp-automation-privacy">{automationForm.responseMode === 'handoff_only'
                ? 'Neste modo, o bot não usa Gemini. Quando uma conversa precisar de atendimento humano, ela pausa e fica marcada na caixa de entrada para você responder pelo WhatsApp conectado; o lead não recebe um aviso de transferência.'
                : automationForm.responseMode === 'openbot'
                  ? 'No modo OpenBot, só o agente dedicado recebe o histórico recente sanitizado. As conversas são processadas uma por vez para o agente; contexto não confirmado como isolado mantém o runtime desativado. Opt-out, pedidos humanos, conteúdo, consentimento e envio continuam sob controle do backend.'
                  : automationForm.responseMode === 'digibot_agent'
                    ? 'O runtime DigiBusca usa provedores configurados na VPS. Ferramentas são limitadas a registrar qualificações verificáveis com citações do lead (por até 90 dias) e sinalizar atendimento humano; o agente não envia mensagens nem chama serviços externos diretamente. O backend continua validando consentimento, descadastro, janela de 24 horas e envio pela Evolution.'
                    : 'No modo Gemini, o histórico recente é enviado ao modelo para preparar respostas. Pedidos para falar com uma pessoa, condições comerciais não aprovadas e assuntos sensíveis pausam a automação e ficam marcados na caixa de entrada, sem aviso de transferência ao lead.'}</p>
              {automationError && <p className="whatsapp-connect-state is-error" role="alert">{automationError}</p>}
              {automationNotice && <p className="whatsapp-connect-state is-ready" role="status">{automationNotice}</p>}
              <div className="whatsapp-automation-actions">
                <button className="secondary-button" type="button" onClick={() => void saveAutomationSettings()} disabled={automationBusy || !automationPhoneNumberId || automationState === 'loading' || status?.automationStorageReady !== true || (automationForm.automationEnabled && (!status?.automationRuntimeEnabled || !automationForm.channelApproved || !automationForm.contentApproved || !automationForm.businessName.trim() || !automationForm.senderIdentity.trim() || !automationForm.serviceSummary.trim() || !automationForm.escalationContact.trim() || (automationForm.responseMode === 'openbot' && !openBotCanEnable) || (automationForm.responseMode === 'digibot_agent' && !digiBuscaAgentCanEnable)))}>
                  <ShieldCheck size={15} />
                  {automationBusy ? 'Salvando…' : 'Salvar regras'}
                </button>
              </div>
            </section>

            <div className="whatsapp-settings-actions">
              <button className="secondary-button" type="button" onClick={() => { void loadStatus(); setRefreshKey((value) => value + 1) }}>
                <RefreshCw size={15} /> Atualizar status
              </button>
            </div>
          </section>

        </div>
      ) : (
        <WhatsAppProspectingPanel connections={connections} />
      )}
    </section>
  )
}
