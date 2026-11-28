import { AlertCircle, CheckCircle2, Clock3, ExternalLink, LoaderCircle, Pause, Play, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SearchPanel, type SearchLocation } from '../components/SearchPanel'
import { getSavedLeads, type SavedLeadState } from '../services/leadsService'
import { resolveWhatsAppProspectingOpening } from '../../../backend/src/domain/whatsappProspectingOpening'
import {
  cancelWhatsAppQueueItem,
  confirmWhatsAppQueueContact,
  enqueueWhatsAppNewLead,
  getWhatsAppProspectingDashboard,
  runWhatsAppDailyProspectingCampaign,
  saveWhatsAppProspectingSettings,
  type WhatsAppProspectingDashboard,
  type WhatsAppProspectingQueueItem,
  type WhatsAppConnection,
} from '../services/whatsappService'
import { AppSelect } from '../components/AppSelect'
import type { Lead } from '../types'
import './WhatsAppProspectingPanel.css'

type QueueFilter = 'all' | 'review' | 'scheduled' | 'sent' | 'problems'

type Props = {
  connections: WhatsAppConnection[]
  onSelectLead: (lead: Lead) => void
}

type LoadState = 'loading' | 'ready' | 'error'

const queueFilterOptions: Array<{ id: QueueFilter; label: string }> = [
  { id: 'review', label: 'Para revisar' },
  { id: 'scheduled', label: 'Agendados' },
  { id: 'sent', label: 'Enviados' },
  { id: 'problems', label: 'Com problema' },
  { id: 'all', label: 'Todos' },
]

function queueStatusLabel(item: WhatsAppProspectingQueueItem) {
  if (item.status === 'review_required') return 'Conferir contato'
  if (item.status === 'queued') return 'Na fila'
  if (item.status === 'sending') return 'Enviando'
  if (item.status === 'sent') {
    if (item.deliveryStatus === 'failed') return 'Falha no envio'
    return item.deliveryStatus === 'sent' ? 'Envio confirmado' : 'Resultado sem confirmação'
  }
  if (item.status === 'unknown') return 'Verificar envio'
  if (item.status === 'failed') return 'Falhou'
  return 'Cancelado'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value))
}

function queueItemTiming(item: WhatsAppProspectingQueueItem) {
  if (item.status === 'sent' && item.deliveryStatus === 'unconfirmed') return `Resultado sem confirmação · ${formatDate(item.createdAt)}`
  if (item.sentAt) return `${item.deliveryStatus === 'failed' ? 'Envio recusado' : 'Envio confirmado pelo OpenClaw'} · ${formatDate(item.sentAt)}`
  if (item.status === 'review_required') return `Aguardando sua conferência · ${formatDate(item.createdAt)}`
  if (item.status === 'queued' || item.status === 'sending') {
    const scheduledAt = Date.parse(item.scheduledAt)
    return Number.isFinite(scheduledAt) && scheduledAt > Date.now()
      ? `Agendado para ${formatDate(item.scheduledAt)}`
      : item.status === 'sending' ? `Despacho em andamento · ${formatDate(item.createdAt)}` : `Aguardando processamento · ${formatDate(item.createdAt)}`
  }
  return `${queueStatusLabel(item)} · ${formatDate(item.createdAt)}`
}

function openClawContactUrl(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return `https://openclaw.digiuptech.com.br/chat/main/whatsapp/direct/${encodeURIComponent(`+${digits}`)}`
}

function queueErrorLabel(errorCode?: string) {
  if (errorCode === 'provider_rejected') return 'A Evolution API recusou o número ou a mensagem.'
  if (errorCode === 'contact_not_eligible_or_connection_unavailable') return 'Revise autorização, telefone, conexão e status do lead.'
  if (errorCode === 'recipient_not_on_whatsapp') return 'Este telefone não tem uma conta WhatsApp; o sistema não tentou enviar.'
  if (errorCode === 'contact_opted_out') return 'Contato bloqueado porque pediu para não receber mensagens.'
  if (errorCode === 'lead_has_website') return 'Este lead tem site ou não está classificado como “Sem site”; o envio foi bloqueado.'
  if (errorCode === 'lead_no_longer_eligible') return 'O lead mudou ou deixou de atender aos critérios de prospecção; o envio foi cancelado.'
  if (errorCode === 'transport_changed') return 'A conexão do WhatsApp mudou; o envio foi cancelado para evitar sair pelo serviço errado.'
  if (errorCode === 'consent_invalid' || errorCode === 'authorization_invalid') return 'A autorização de contato não está válida; o envio foi bloqueado.'
  if (errorCode === 'phone_invalid_or_changed') return 'O telefone salvo mudou ou está inválido; o envio foi bloqueado.'
  if (errorCode === 'evolution_disconnected' || errorCode === 'evolution_status_unavailable' || errorCode === 'evolution_not_connected') return 'A Evolution estava desconectada ou indisponível no momento do envio.'
  if (errorCode === 'dispatch_context_unavailable') return 'Não foi possível revalidar o lead antes do envio. A fila registrou a falha para revisão.'
  if (errorCode === 'openclaw_dispatch_context_unavailable') return 'Não foi possível revalidar o lead e o pareamento OpenClaw antes do despacho.'
  if (errorCode === 'openclaw_hook_outcome_unknown' || errorCode === 'openclaw_hook_ack_invalid') return 'O OpenClaw pode ter recebido a tarefa, mas não confirmou o despacho. Confira a conversa antes de qualquer nova tentativa.'
  if (errorCode?.startsWith('openclaw_hook_rejected_http_')) return 'O webhook privado do OpenClaw recusou a tarefa. Revise o token, o Gateway e os logs antes de tentar novamente.'
  if (errorCode === 'evolution_prospecting_disabled') return 'Este contato pendente foi cancelado na troca para OpenClaw. Nenhuma nova tentativa será feita pela Evolution.'
  if (errorCode === 'evolution_disabled_outcome_unknown') return 'A Evolution já estava processando este contato na troca. Confira o WhatsApp antes de qualquer nova tentativa.'
  if (errorCode === 'lead_no_longer_eligible_outcome_unknown') return 'Este contato já estava sendo processado quando deixou de atender aos critérios. Confira o WhatsApp antes de qualquer tentativa.'
  if (errorCode === 'history_sync_failed') return 'A Evolution aceitou o envio; confira a conversa e o histórico.'
  if (errorCode === 'local_worker_interrupted') return 'O processo de envio foi interrompido; confira a conversa.'
  const providerStatus = errorCode?.match(/^provider_rejected_http_(\d{3})$/)?.[1]
  if (providerStatus === '400') return 'A Evolution recusou o número ou a mensagem (HTTP 400); o envio não foi aceito.'
  if (providerStatus === '401' || providerStatus === '403') return `A Evolution recusou a chave ou a permissão (HTTP ${providerStatus}); revise a configuração.`
  if (providerStatus === '404') return 'A Evolution não encontrou a instância ou a rota do envio (HTTP 404).'
  if (providerStatus === '429') return 'A Evolution limitou o envio (HTTP 429); revise o ritmo da fila.'
  if (providerStatus) return `A Evolution recusou a operação (HTTP ${providerStatus}).`
  return errorCode ? 'Confira a conversa e a conexão antes de tentar novamente.' : undefined
}

function isRegisteredWhatsAppConnection(connection: WhatsAppConnection) {
  const state = connection.connectionState?.toLowerCase()
  return state === 'open' || (connection.platformType === 'OPENCLAW_WEB' && state === 'registered')
}

export function WhatsAppProspectingPanel({ connections, onSelectLead }: Props) {
  const [dashboard, setDashboard] = useState<WhatsAppProspectingDashboard | null>(null)
  const [leads, setLeads] = useState<SavedLeadState[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedPhoneNumberId, setSelectedPhoneNumberId] = useState('')
  const [dailyLimit, setDailyLimit] = useState(20)
  const [busyKey, setBusyKey] = useState('')
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])
  const [contactReferences, setContactReferences] = useState<Record<string, string>>({})
  const [contactIdentityChecks, setContactIdentityChecks] = useState<Record<string, boolean>>({})
  const [campaignLocation, setCampaignLocation] = useState({ countryCode: 'BR', stateCode: '', city: '' })
  const [campaignSegment, setCampaignSegment] = useState('Todos os segmentos')
  const [campaignBusy, setCampaignBusy] = useState(false)
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all')
  const [sessionManuallyConfirmed, setSessionManuallyConfirmed] = useState(false)

  const reload = useCallback(async () => {
    setLoadState('loading')
    setError('')
    try {
      const [nextDashboard, savedLeads] = await Promise.all([
        getWhatsAppProspectingDashboard(),
        getSavedLeads(),
      ])
      setDashboard(nextDashboard)
      setDailyLimit(nextDashboard.settings.dailyNewLeadLimit)
      setLeads(savedLeads)
      setLoadState('ready')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a fila de prospecção.')
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || campaignBusy) return
      void getWhatsAppProspectingDashboard().then((nextDashboard) => {
        setDashboard(nextDashboard)
        setDailyLimit(nextDashboard.settings.dailyNewLeadLimit)
      }).catch(() => undefined)
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [campaignBusy])

  useEffect(() => {
    const readyConnections = connections.filter((connection) => connection.platformType === 'OPENCLAW_WEB' && isRegisteredWhatsAppConnection(connection))
    setSelectedPhoneNumberId((current) => (
      current && readyConnections.some((connection) => connection.phoneNumberId === current)
        ? current
        : readyConnections[0]?.phoneNumberId ?? ''
    ))
  }, [connections])

  useEffect(() => {
    setSessionManuallyConfirmed(false)
  }, [selectedPhoneNumberId])

  const queuedLeadIds = useMemo(() => new Set(
    (dashboard?.queue ?? [])
      .filter((item) => ['review_required', 'queued', 'sending', 'sent', 'unknown'].includes(item.status))
      .map((item) => item.leadId),
  ), [dashboard?.queue])

  const eligibleLeads = useMemo(() => leads.filter((savedLead) => (
    savedLead.status === 'Novo' &&
    savedLead.lead?.opportunity === 'Sem site' &&
    !savedLead.lead?.website?.trim() &&
    savedLead.whatsappConsentStatus !== 'opted_out' &&
    (
      (savedLead.whatsappConsentStatus === 'opted_in' && Boolean(savedLead.whatsappConsentSource?.trim()) && Boolean(savedLead.whatsappConsentAt && Number.isFinite(Date.parse(savedLead.whatsappConsentAt)))) ||
      (savedLead.whatsappOutboundAuthorizationStatus === 'authorized_by_owner' && Boolean(savedLead.whatsappOutboundAuthorizationSource?.trim()) && Boolean(savedLead.whatsappOutboundAuthorizationAt && Number.isFinite(Date.parse(savedLead.whatsappOutboundAuthorizationAt))))
    ) &&
    Boolean(savedLead.lead?.phone?.trim()) &&
    !queuedLeadIds.has(savedLead.leadId)
  )), [leads, queuedLeadIds])
  const leadDetails = useMemo(() => new Map(leads.map((savedLead) => [savedLead.leadId, savedLead.lead] as const)), [leads])
  const leadRecords = useMemo(() => new Map(leads.map((savedLead) => [savedLead.leadId, savedLead] as const)), [leads])

  async function updateSettings(enabled: boolean, nextLimit = dailyLimit) {
    if (enabled && dashboard?.settings.enabled !== true && !sessionManuallyConfirmed) {
      setError('Confira no OpenClaw se o WhatsApp Web está conectado e confirme essa checagem antes de ativar a fila.')
      return
    }
    setBusyKey('settings')
    setError('')
    setNotice('')
    try {
      const settings = await saveWhatsAppProspectingSettings({ enabled, dailyNewLeadLimit: nextLimit })
      setDashboard((current) => current ? { ...current, settings } : current)
      setNotice(enabled ? 'A fila automática foi ativada.' : 'A fila automática foi pausada.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar as configurações.')
    } finally {
      setBusyKey('')
    }
  }

  function toggleLeadSelection(leadId: string, selected: boolean) {
    setSelectedLeadIds((current) => selected
      ? current.includes(leadId) ? current : [...current, leadId]
      : current.filter((id) => id !== leadId))
  }

  async function queueSelectedLeads() {
    if (!selectedPhoneNumberId) {
      setError('Conecte ou selecione um número do WhatsApp Business.')
      return
    }
    const selected = eligibleLeads.filter((savedLead) => selectedLeadIds.includes(savedLead.leadId))
    if (selected.length === 0) {
      setError('Selecione ao menos um lead para revisar.')
      return
    }
    setBusyKey('selected-bulk')
    setError('')
    setNotice('')
    const added: WhatsAppProspectingQueueItem[] = []
    const failedNames: string[] = []
    try {
      for (const [index, savedLead] of selected.entries()) {
        try {
          const name = savedLead.lead?.name ?? 'Lead sem nome'
          const item = await enqueueWhatsAppNewLead({
            phoneNumberId: selectedPhoneNumberId,
            leadId: savedLead.leadId,
            message: resolveWhatsAppProspectingOpening(name, savedLead.draftMessage, index),
          })
          added.push(item)
        } catch {
          failedNames.push(savedLead.lead?.name ?? savedLead.leadId)
        }
      }
      setDashboard((current) => current ? { ...current, queue: [...added.reverse(), ...current.queue] } : current)
      setSelectedLeadIds([])
      setNotice(`${added.length} contato(s) foram para a revisão. Nenhuma mensagem foi enviada.${failedNames.length ? ` Não entraram: ${failedNames.join(', ')}.` : ''}`)
    } finally {
      setBusyKey('')
    }
  }

  async function cancelItem(item: WhatsAppProspectingQueueItem) {
    setBusyKey(item.id)
    setError('')
    try {
      await cancelWhatsAppQueueItem(item.id)
      setDashboard((current) => current ? {
        ...current,
        queue: current.queue.map((queued) => queued.id === item.id ? { ...queued, status: 'cancelled' } : queued),
      } : current)
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Não foi possível cancelar o contato.')
    } finally {
      setBusyKey('')
    }
  }

  async function confirmContact(item: WhatsAppProspectingQueueItem) {
    const reference = contactReferences[item.id]?.trim() ?? ''
    if (!contactIdentityChecks[item.id]) {
      setError('Confirme um sinal de identidade além do número antes de liberar o contato.')
      return
    }
    if (reference.length < 5) {
      setError('Descreva o sinal de identidade que vincula o perfil ou a pessoa à empresa.')
      return
    }
    setBusyKey(item.id)
    setError('')
    setNotice('')
    try {
      const updated = await confirmWhatsAppQueueContact(item.id, reference)
      setDashboard((current) => current ? {
        ...current,
        queue: current.queue.map((queued) => queued.id === item.id ? updated : queued),
      } : current)
      setContactReferences((current) => ({ ...current, [item.id]: '' }))
      setContactIdentityChecks((current) => ({ ...current, [item.id]: false }))
      setNotice(dashboard?.settings.enabled
        ? 'Conferência registrada. O contato pode ser processado no horário permitido.'
        : 'Conferência registrada. O envio segue pausado até você ativar a fila.')
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Não foi possível confirmar este contato.')
      await reload()
    } finally {
      setBusyKey('')
    }
  }

  async function submitDailyCampaign(location: SearchLocation) {
    if (campaignBusy || loadState !== 'ready') return
    const city = [location.cityName, location.stateName, location.countryName].filter(Boolean).join(', ')
    setCampaignBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await runWhatsAppDailyProspectingCampaign({
        city,
        ...(campaignSegment.trim() ? { segment: campaignSegment.trim() } : {}),
      })
      setDashboard((current) => current ? { ...current, campaign: result.campaign } : current)
      setNotice(`Busca concluída: ${result.searchedCount} encontrados, ${result.savedCount} salvos e ${result.candidateCount} candidatos disponíveis para sua seleção. Nenhuma mensagem foi enfileirada.`)
      await reload()
    } catch (campaignError) {
      const message = campaignError instanceof Error ? campaignError.message : 'Não foi possível concluir a busca de hoje.'
      await reload()
      setError(message)
    } finally {
      setCampaignBusy(false)
    }
  }

  const leadNames = useMemo(() => new Map(leads.map((savedLead) => [savedLead.leadId, savedLead.lead?.name ?? savedLead.leadId] as const)), [leads])
  const selectedEligibleLeads = useMemo(() => eligibleLeads.filter((savedLead) => selectedLeadIds.includes(savedLead.leadId)), [eligibleLeads, selectedLeadIds])
  const allEligibleSelected = eligibleLeads.length > 0 && selectedEligibleLeads.length === eligibleLeads.length
  const openClawDispatcherReady = dashboard?.openClawProspectingDispatcherReady === true
  const readyConnections = connections.filter((connection) => connection.platformType === 'OPENCLAW_WEB' && isRegisteredWhatsAppConnection(connection))
  const prospectingReadyConnections = openClawDispatcherReady ? readyConnections : []
  const selectedConnection = readyConnections.find((connection) => connection.phoneNumberId === selectedPhoneNumberId)
  const selectedConnectionAvailable = Boolean(selectedConnection)
  const queueItems = dashboard?.queue ?? []
  const queueCounts: Record<QueueFilter, number> = {
    all: queueItems.length,
    review: queueItems.filter((item) => item.status === 'review_required').length,
    scheduled: queueItems.filter((item) => item.status === 'queued' || item.status === 'sending').length,
    sent: queueItems.filter((item) => item.status === 'sent' && item.deliveryStatus === 'sent').length,
    problems: queueItems.filter((item) => item.status === 'unknown' || item.status === 'failed' || (item.status === 'sent' && item.deliveryStatus !== 'sent')).length,
  }
  const visibleQueueItems = queueItems.filter((item) => {
    if (queueFilter === 'all') return true
    if (queueFilter === 'review') return item.status === 'review_required'
    if (queueFilter === 'scheduled') return item.status === 'queued' || item.status === 'sending'
    if (queueFilter === 'sent') return item.status === 'sent' && item.deliveryStatus === 'sent'
    return item.status === 'unknown' || item.status === 'failed' || (item.status === 'sent' && item.deliveryStatus !== 'sent')
  }).sort((left, right) => {
    const priority = (item: WhatsAppProspectingQueueItem) => item.status === 'review_required' ? 0
      : item.status === 'unknown' || item.status === 'failed' || item.deliveryStatus === 'failed' ? 1
        : item.status === 'queued' || item.status === 'sending' ? 2
          : item.status === 'sent' ? 3 : 4
    return priority(left) - priority(right) || Date.parse(right.createdAt) - Date.parse(left.createdAt)
  })

  return (
    <section className="whatsapp-prospecting" role="tabpanel" aria-label="Fila de prospecção">
      <section className="panel prospecting-overview">
        <div className="prospecting-overview-copy">
          <span className="eyebrow">NOVOS CONTATOS</span>
          <h2>Fila de prospecção</h2>
          <p>Em dias úteis, os contatos da fila são distribuídos entre 9h e 14h, com intervalo de pelo menos 10 minutos. O total depende da fila elegível e da conexão do WhatsApp.</p>
        </div>
        <div className="prospecting-today-count">
          <strong>{dashboard?.dailyCount ?? '—'}<span> / {dashboard?.settings.dailyNewLeadLimit ?? dailyLimit}</span></strong>
          <small>envios contabilizados hoje</small>
        </div>

        <div className="prospecting-controls">
          <label className="prospecting-limit-field">
            <span>Limite diário</span>
            <AppSelect
              value={String(dailyLimit)}
              onValueChange={(value) => setDailyLimit(Number(value))}
              ariaLabel="Limite diário de novos leads"
              disabled={busyKey === 'settings'}
              size="compact"
              options={Array.from({ length: 9 }, (_, index) => index + 17).map((limit) => ({
                value: String(limit),
                label: `${limit} leads`,
              }))}
            />
          </label>
          <button className="secondary-button" type="button" disabled={busyKey === 'settings' || loadState !== 'ready'} onClick={() => void updateSettings(dashboard?.settings.enabled === true, dailyLimit)}>
            {busyKey === 'settings' ? 'Salvando…' : 'Salvar limite'}
          </button>
          <button
            className={`prospecting-toggle${dashboard?.settings.enabled ? ' is-on' : ''}`}
            type="button"
            disabled={busyKey === 'settings' || loadState !== 'ready' || (!dashboard?.settings.enabled && (prospectingReadyConnections.length === 0 || !sessionManuallyConfirmed))}
            onClick={() => void updateSettings(dashboard?.settings.enabled !== true, dailyLimit)}
          >
            {dashboard?.settings.enabled ? <Pause size={16} /> : <Play size={16} />}
            {dashboard?.settings.enabled ? 'Pausar fila' : 'Ativar fila'}
          </button>
          <button className="icon-button prospecting-refresh" type="button" aria-label="Atualizar fila" onClick={() => void reload()}>
            <RefreshCw size={16} className={loadState === 'loading' ? 'is-spinning' : ''} />
          </button>
        </div>

        {readyConnections.length === 0 && <p className="prospecting-guidance"><AlertCircle size={15} /> Registre o pareamento do WhatsApp Web do OpenClaw na aba Conexão para habilitar a prospecção.</p>}
        {readyConnections.length > 0 && prospectingReadyConnections.length === 0 && <p className="prospecting-guidance"><AlertCircle size={15} /> O dispatcher privado do OpenClaw ainda não está pronto para enviar.</p>}
        {selectedConnection && <p className="prospecting-guidance">A prospecção usa somente o WhatsApp Web do OpenClaw. O DigiBusca ainda não verifica a sessão ativa do Cristhian; confira o canal no OpenClaw antes de liberar envios.</p>}
        {selectedConnection && dashboard?.settings.enabled !== true && (
          <label className="prospecting-session-confirm">
            <input type="checkbox" checked={sessionManuallyConfirmed} onChange={(event) => setSessionManuallyConfirmed(event.target.checked)} />
            <span>Conferi agora no OpenClaw que a sessão do WhatsApp Web está conectada.</span>
          </label>
        )}
        {readyConnections.length > 1 && (
          <label className="prospecting-phone-field">
            <span>Número de envio</span>
            <AppSelect
              value={selectedPhoneNumberId}
              onValueChange={setSelectedPhoneNumberId}
              ariaLabel="Número de envio"
              options={readyConnections.map((connection) => ({
                value: connection.phoneNumberId,
                label: `${connection.displayPhoneNumber || connection.phoneNumberId} · OpenClaw`,
              }))}
              size="compact"
            />
          </label>
        )}
        <p className="prospecting-policy-note">Novos contatos ficam bloqueados até você conferir o perfil no WhatsApp Web do OpenClaw e registrar um sinal independente que ligue a pessoa ou o perfil à empresa. O nome não precisa ser idêntico, mas a coincidência do telefone, sozinha, não confirma quem está usando a linha agora.</p>
      </section>

      <section className="panel prospecting-daily-chat" aria-label="Chat de prospecção do dia">
        <header className="prospecting-chat-heading">
          <div>
            <span className="eyebrow">DIGIBOT · CAMPANHA DIÁRIA</span>
            <h3>Vamos escolher a cidade</h3>
          </div>
          <span className={`prospecting-chat-state is-${dashboard?.campaign.status ?? 'awaiting_city'}`}>
            {dashboard?.campaign.status === 'completed' ? 'Concluída' : dashboard?.campaign.status === 'processing' || campaignBusy ? 'Em andamento' : dashboard?.campaign.status === 'failed' ? 'Precisa tentar de novo' : 'Aguardando cidade'}
          </span>
        </header>
        <div className="prospecting-chat-messages" aria-live="polite">
          {(dashboard?.campaign.messages ?? []).map((message, index) => (
            <div className={`prospecting-chat-message is-${message.role}`} key={`${message.createdAt}-${index}`}>
              <span>{message.role === 'assistant' ? 'DigiBot' : 'Você'}</span>
              <p>{message.text}</p>
            </div>
          ))}
        </div>
        {dashboard?.campaign.status === 'awaiting_city' || dashboard?.campaign.status === 'failed' || dashboard?.campaign.status === 'completed' ? (
          <SearchPanel
            {...campaignLocation}
            segment={campaignSegment}
            segmentOptional
            isSearching={campaignBusy}
            submitDisabled={loadState !== 'ready'}
            submitLabel={dashboard.campaign.status === 'completed' ? 'Prospectar mais hoje' : 'Buscar e preparar contatos'}
            onCountryChange={(countryCode) => setCampaignLocation({ countryCode, stateCode: '', city: '' })}
            onStateChange={(stateCode) => setCampaignLocation((current) => ({ ...current, stateCode, city: '' }))}
            onCityChange={(city) => setCampaignLocation((current) => ({ ...current, city }))}
            onSegmentChange={setCampaignSegment}
            onSearch={(location) => void submitDailyCampaign(location)}
          />
        ) : dashboard?.campaign.status === 'processing' ? (
          <p className="prospecting-chat-hint">A busca está rodando. O DigiBot vai salvar os candidatos e preparar prévias. A busca não cria fila nem envia mensagem; você escolhe os leads depois.</p>
        ) : (
          <p className="prospecting-chat-hint">Você pode iniciar outras buscas hoje. Os envios continuam respeitando o limite diário, o horário configurado e os bloqueios de descadastro.</p>
        )}
        <p className="prospecting-chat-policy">A busca considera empresas cujo perfil do Google não informa um site. A cidade de hoje é <strong>{dashboard?.campaign.city ?? 'ainda não escolhida'}</strong>. Resultados ficam salvos para seleção; só leads escolhidos entram na revisão da fila e nenhum é enviado automaticamente pela busca.</p>
      </section>

      {(error || notice) && <div className={`prospecting-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}

      <div className="prospecting-layout">
        <section className="panel prospecting-candidates">
          <header className="prospecting-section-heading">
            <div><span className="eyebrow">CONTATOS PRONTOS</span><h3>Leads elegíveis</h3></div>
            <div className="prospecting-candidate-actions">
              <span className="prospecting-count">{eligibleLeads.length}</span>
              <button type="button" className="prospecting-select-all" disabled={eligibleLeads.length === 0} onClick={() => setSelectedLeadIds(allEligibleSelected ? [] : eligibleLeads.map((savedLead) => savedLead.leadId))}>
                {allEligibleSelected ? 'Limpar seleção' : 'Selecionar todos'}
              </button>
            </div>
          </header>
          {loadState === 'loading' && <p className="prospecting-empty">Carregando seus leads…</p>}
          {loadState === 'error' && <p className="prospecting-empty is-error">Não foi possível carregar os leads.</p>}
          {loadState === 'ready' && eligibleLeads.length === 0 && (
            <div className="prospecting-empty-state"><CheckCircle2 size={22} /><strong>Nenhum lead elegível agora</strong><span>Salve leads novos retornados pela busca DigiBusca para colocá-los nesta lista.</span></div>
          )}
          <div className="prospecting-lead-list">
            {eligibleLeads.map((savedLead) => (
              <article className="prospecting-lead-card" key={savedLead.leadId}>
                <div className="prospecting-lead-heading">
                  <div><strong>{savedLead.lead?.name ?? 'Lead sem nome'}</strong><small>{savedLead.lead?.category ?? 'Categoria não informada'} · {savedLead.lead?.phone}</small></div>
                  <span>{savedLead.whatsappConsentStatus === 'opted_out' ? 'Descadastro registrado' : savedLead.whatsappConsentStatus === 'opted_in' ? 'Consentimento do contato' : savedLead.whatsappOutboundAuthorizationStatus === 'authorized_by_owner' ? 'Autorização do titular · sem consentimento do contato' : 'Sem autorização registrada'}</span>
                </div>
                <label className="prospecting-lead-select">
                  <input type="checkbox" checked={selectedLeadIds.includes(savedLead.leadId)} onChange={(event) => toggleLeadSelection(savedLead.leadId, event.target.checked)} />
                  <span>Selecionar para revisar</span>
                </label>
                <small>A autorização operacional do titular é diferente do consentimento do destinatário. A seleção só prepara a revisão; não envia.</small>
              </article>
            ))}
          </div>
          {selectedEligibleLeads.length > 0 && (
            <div className="prospecting-selection-review">
              <header><strong>Prévia dos selecionados</strong><span>{selectedEligibleLeads.length} contato(s)</span></header>
              {selectedEligibleLeads.map((savedLead, index) => {
                const name = savedLead.lead?.name ?? 'Lead sem nome'
                const message = resolveWhatsAppProspectingOpening(name, savedLead.draftMessage, index)
                return (
                  <article key={savedLead.leadId}>
                    <div><strong>{name}</strong><span>{savedLead.lead?.phone} · {savedLead.lead?.address}</span></div>
                    <p>{message}</p>
                    {savedLead.lead?.googleMapsUri && <a href={savedLead.lead.googleMapsUri} target="_blank" rel="noopener noreferrer">Abrir ficha do Google Maps</a>}
                  </article>
                )
              })}
              <small>Adicionar à revisão não envia mensagens. Depois será necessário abrir cada chat no OpenClaw e registrar um sinal de identidade além do telefone.</small>
              <button type="button" className="prospecting-chat-submit" disabled={busyKey === 'selected-bulk' || !selectedPhoneNumberId || !selectedConnectionAvailable} onClick={() => void queueSelectedLeads()}>
                {busyKey === 'selected-bulk' ? <LoaderCircle size={16} className="is-spinning" /> : <Send size={15} />}
                {busyKey === 'selected-bulk' ? 'Adicionando…' : 'Adicionar selecionados à revisão'}
              </button>
            </div>
          )}
        </section>

        <section className="panel prospecting-queue">
          <header className="prospecting-section-heading">
            <div><span className="eyebrow">ACOMPANHAMENTO</span><h3>Fila por próxima ação</h3></div>
            <span className="prospecting-count">{queueItems.length}</span>
          </header>
          <p className="prospecting-guidance">“Envio confirmado” significa que o OpenClaw registrou sucesso no envio pelo WhatsApp Web. Esta integração não recebe recibos de entrega ou leitura do destinatário; quando o resultado é incerto, confira a conversa antes de agir.</p>
          <div className="prospecting-queue-filters" role="group" aria-label="Filtrar fila por estado">
            {queueFilterOptions.map((filter) => (
              <button
                key={filter.id}
                className={queueFilter === filter.id ? 'is-active' : ''}
                type="button"
                aria-pressed={queueFilter === filter.id}
                onClick={() => setQueueFilter(filter.id)}
              >
                {filter.label}<span>{queueCounts[filter.id]}</span>
              </button>
            ))}
          </div>
          {loadState === 'loading' && <p className="prospecting-empty">Carregando fila…</p>}
          {loadState === 'ready' && queueItems.length === 0 && <p className="prospecting-empty">A fila está vazia.</p>}
          {loadState === 'ready' && queueItems.length > 0 && visibleQueueItems.length === 0 && <p className="prospecting-empty">Nenhum contato nesta etapa. Escolha outro filtro para ver a fila.</p>}
          <div className="prospecting-queue-list">
          {visibleQueueItems.map((item) => {
            const savedLead = leadRecords.get(item.leadId)
            return (
            <article className={`prospecting-queue-item${item.status === 'review_required' ? ' needs-contact-review' : ''}`} key={item.id}>
              <div className="prospecting-queue-item-top">
                <div><strong>{leadNames.get(item.leadId) ?? item.leadId}</strong><small>+{item.recipientPhone}</small></div>
                <span className={`prospecting-status is-${item.status}`}>{queueStatusLabel(item)}</span>
              </div>
              <p>{item.message}</p>
              <div className="prospecting-queue-meta"><Clock3 size={13} /> {queueItemTiming(item)}</div>
              <div className="prospecting-queue-actions">
                {savedLead?.lead && <button className="text-button" type="button" onClick={() => onSelectLead({ ...savedLead.lead!, status: savedLead.status, notes: savedLead.notes, nextFollowUp: savedLead.nextFollowUp, draftMessage: savedLead.draftMessage, conversationStage: savedLead.conversationStage, contactName: savedLead.contactName, nextAction: savedLead.nextAction })}>Abrir ficha no CRM</button>}
                {item.status !== 'cancelled' && <a className="secondary-button" href={openClawContactUrl(item.recipientPhone)} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> {item.status === 'unknown' ? 'Conferir chat no OpenClaw' : 'Abrir chat no OpenClaw'}</a>}
              </div>
              {item.status === 'review_required' && (
                <div className="prospecting-contact-review">
                  {(() => {
                    const lead = leadDetails.get(item.leadId)
                    return (
                      <div className="prospecting-contact-reference-card">
                        <strong>Referência do Google</strong>
                        <span>{lead?.name ?? leadNames.get(item.leadId) ?? item.leadId}{lead?.category ? ` · ${lead.category}` : ''}</span>
                        {lead?.address && <span>{lead.address}</span>}
                        {lead?.phone && <span>Telefone publicado: {lead.phone}</span>}
                        {lead?.googleMapsUri && <a href={lead.googleMapsUri} target="_blank" rel="noopener noreferrer">Abrir ficha no Google Maps</a>}
                      </div>
                    )
                  })()}
                  <small>O telefone da ficha do Google é uma referência para comparação, mas não basta sozinho: a linha pode ter mudado de titular. Procure também um sinal de identidade, como nome comercial, logo, descrição, endereço ou site no perfil Business, ou uma fonte oficial atual que ligue a pessoa à empresa. Se só houver coincidência do número, cancele.</small>
                  <label className="prospecting-contact-evidence">
                    <span>Qual sinal além do telefone vinculou o perfil ou a pessoa à empresa?</span>
                    <textarea
                      value={contactReferences[item.id] ?? ''}
                      onChange={(event) => setContactReferences((current) => ({ ...current, [item.id]: event.target.value }))}
                      placeholder="Ex.: o perfil Business mostra o nome comercial, o logo e o endereço da ficha do Google"
                      maxLength={500}
                      rows={2}
                    />
                  </label>
                  <label className="prospecting-contact-identity-check">
                    <input
                      type="checkbox"
                      checked={contactIdentityChecks[item.id] ?? false}
                      onChange={(event) => setContactIdentityChecks((current) => ({ ...current, [item.id]: event.target.checked }))}
                    />
                    <span>Confirmei uma evidência de identidade além da coincidência do telefone.</span>
                  </label>
                  <button className="secondary-button" type="button" disabled={busyKey === item.id || !contactIdentityChecks[item.id] || (contactReferences[item.id]?.trim().length ?? 0) < 5} onClick={() => void confirmContact(item)}>{busyKey === item.id ? 'Registrando…' : 'Registrar evidência e liberar'}</button>
                </div>
              )}
              {item.contactVerifiedAt && <small className="prospecting-contact-verified">Identidade conferida: {item.contactVerificationReference} · Conferido em {formatDate(item.contactVerifiedAt)}</small>}
              {queueErrorLabel(item.errorCode) && <small className="prospecting-uncertain">{queueErrorLabel(item.errorCode)}</small>}
              {(item.status === 'review_required' || item.status === 'queued') && <button className="prospecting-cancel" type="button" disabled={busyKey === item.id} onClick={() => void cancelItem(item)}><Trash2 size={14} /> Cancelar</button>}
              {item.status === 'unknown' && <small className="prospecting-uncertain">Confira a conversa antes de tentar novamente para evitar duplicidade.</small>}
            </article>
          )})}
          </div>
        </section>
      </div>
    </section>
  )
}
