import { AlertCircle, CheckCircle2, Clock3, LoaderCircle, MapPin, Pause, Play, RefreshCw, Send, Trash2 } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { getSavedLeads, type SavedLeadState } from '../services/leadsService'
import {
  cancelWhatsAppQueueItem,
  enqueueWhatsAppNewLead,
  getWhatsAppProspectingDashboard,
  runWhatsAppDailyProspectingCampaign,
  saveWhatsAppProspectingSettings,
  type WhatsAppProspectingDashboard,
  type WhatsAppProspectingQueueItem,
  type WhatsAppConnection,
} from '../services/whatsappService'
import './WhatsAppProspectingPanel.css'

type Props = {
  connections: WhatsAppConnection[]
}

type LoadState = 'loading' | 'ready' | 'error'

function queueStatusLabel(item: WhatsAppProspectingQueueItem) {
  if (item.status === 'queued') return 'Na fila'
  if (item.status === 'sending') return 'Enviando'
  if (item.status === 'sent') return 'Enviado'
  if (item.status === 'unknown') return 'Verificar envio'
  if (item.status === 'failed') return 'Falhou'
  return 'Cancelado'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value))
}

function queueErrorLabel(errorCode?: string) {
  if (errorCode === 'provider_rejected') return 'A Evolution API recusou o número ou a mensagem.'
  if (errorCode === 'contact_not_eligible_or_connection_unavailable') return 'Revise autorização, telefone, conexão e status do lead.'
  if (errorCode === 'history_sync_failed') return 'A Evolution aceitou o envio; confira a conversa e o histórico.'
  if (errorCode === 'local_worker_interrupted') return 'O processo local foi interrompido; confira a conversa.'
  return errorCode ? 'Confira a conversa e a conexão antes de tentar novamente.' : undefined
}

export function WhatsAppProspectingPanel({ connections }: Props) {
  const [dashboard, setDashboard] = useState<WhatsAppProspectingDashboard | null>(null)
  const [leads, setLeads] = useState<SavedLeadState[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedPhoneNumberId, setSelectedPhoneNumberId] = useState('')
  const [dailyLimit, setDailyLimit] = useState(20)
  const [busyKey, setBusyKey] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [campaignCity, setCampaignCity] = useState('')
  const [campaignSegment, setCampaignSegment] = useState('')
  const [campaignBusy, setCampaignBusy] = useState(false)

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
      setCampaignCity((current) => current || nextDashboard.settings.defaultCity)
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
        setCampaignCity((current) => current || nextDashboard.settings.defaultCity)
      }).catch(() => undefined)
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [campaignBusy])

  useEffect(() => {
    const readyConnections = connections.filter((connection) => connection.connectionState?.toLowerCase() === 'open')
    setSelectedPhoneNumberId((current) => (
      current && readyConnections.some((connection) => connection.phoneNumberId === current)
        ? current
        : readyConnections[0]?.phoneNumberId ?? ''
    ))
  }, [connections])

  const queuedLeadIds = useMemo(() => new Set(
    (dashboard?.queue ?? [])
      .filter((item) => ['queued', 'sending', 'sent', 'unknown'].includes(item.status))
      .map((item) => item.leadId),
  ), [dashboard?.queue])

  const eligibleLeads = useMemo(() => leads.filter((savedLead) => (
    savedLead.status === 'Novo' &&
    savedLead.whatsappConsentStatus === 'opted_in' &&
    Boolean(savedLead.whatsappConsentSource?.trim()) &&
    Boolean(savedLead.whatsappConsentAt && Number.isFinite(Date.parse(savedLead.whatsappConsentAt))) &&
    Boolean(savedLead.lead?.phone?.trim()) &&
    !queuedLeadIds.has(savedLead.leadId)
  )), [leads, queuedLeadIds])

  async function updateSettings(enabled: boolean, nextLimit = dailyLimit) {
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

  async function queueLead(savedLead: SavedLeadState) {
    if (!selectedPhoneNumberId) {
      setError('Conecte ou selecione um número do WhatsApp Business.')
      return
    }
    const message = (drafts[savedLead.leadId] ?? savedLead.draftMessage ?? '').trim()
    if (!message) {
      setError(`Escreva ou salve uma mensagem para ${savedLead.lead?.name ?? 'este lead'} antes de adicionar à fila.`)
      return
    }
    setBusyKey(savedLead.leadId)
    setError('')
    setNotice('')
    try {
      const item = await enqueueWhatsAppNewLead({
        phoneNumberId: selectedPhoneNumberId,
        leadId: savedLead.leadId,
        message,
      })
      setDashboard((current) => current ? { ...current, queue: [item, ...current.queue] } : current)
      setNotice(`${savedLead.lead?.name ?? 'Lead'} entrou na fila.`)
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : 'Não foi possível adicionar o lead à fila.')
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

  async function submitDailyCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const city = campaignCity.trim()
    if (city.length < 2) {
      setError('Digite a cidade que vamos prospectar hoje.')
      return
    }
    setCampaignBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await runWhatsAppDailyProspectingCampaign({
        city,
        ...(campaignSegment.trim() ? { segment: campaignSegment.trim() } : {}),
        ...(selectedPhoneNumberId ? { phoneNumberId: selectedPhoneNumberId } : {}),
      })
      setDashboard((current) => current ? { ...current, campaign: result.campaign } : current)
      setNotice(`Busca concluída: ${result.searchedCount} encontrados, ${result.savedCount} salvos e ${result.queuedCount} na fila.`)
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
  const runtimeEnabled = dashboard?.localRuntimeEnabled === true
  const evolutionConfigured = dashboard?.evolutionConfigured === true
  const readyConnections = connections.filter((connection) => connection.connectionState?.toLowerCase() === 'open')

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
            <select value={dailyLimit} onChange={(event) => setDailyLimit(Number(event.target.value))} disabled={busyKey === 'settings'}>
              {Array.from({ length: 9 }, (_, index) => index + 17).map((limit) => <option value={limit} key={limit}>{limit} leads</option>)}
            </select>
          </label>
          <button className="secondary-button" type="button" disabled={busyKey === 'settings' || loadState !== 'ready'} onClick={() => void updateSettings(dashboard?.settings.enabled === true, dailyLimit)}>
            {busyKey === 'settings' ? 'Salvando…' : 'Salvar limite'}
          </button>
          <button
            className={`prospecting-toggle${dashboard?.settings.enabled ? ' is-on' : ''}`}
            type="button"
            disabled={busyKey === 'settings' || loadState !== 'ready' || (!dashboard?.settings.enabled && (!runtimeEnabled || !evolutionConfigured || readyConnections.length === 0))}
            onClick={() => void updateSettings(dashboard?.settings.enabled !== true, dailyLimit)}
          >
            {dashboard?.settings.enabled ? <Pause size={16} /> : <Play size={16} />}
            {dashboard?.settings.enabled ? 'Pausar fila' : 'Ativar fila'}
          </button>
          <button className="icon-button prospecting-refresh" type="button" aria-label="Atualizar fila" onClick={() => void reload()}>
            <RefreshCw size={16} className={loadState === 'loading' ? 'is-spinning' : ''} />
          </button>
        </div>

        {!runtimeEnabled && <p className="prospecting-guidance"><AlertCircle size={15} /> O backend ainda precisa de <code>WHATSAPP_PROSPECTING_RUNTIME_ENABLED=true</code> para processar envios.</p>}
        {!evolutionConfigured && <p className="prospecting-guidance"><AlertCircle size={15} /> Configure a URL e a chave da Evolution API no ambiente do backend.</p>}
        {readyConnections.length === 0 && <p className="prospecting-guidance"><AlertCircle size={15} /> Conecte o WhatsApp pela Evolution API na aba Conexão.</p>}
        {readyConnections.length > 1 && (
          <label className="prospecting-phone-field">
            <span>Número de envio</span>
            <select value={selectedPhoneNumberId} onChange={(event) => setSelectedPhoneNumberId(event.target.value)}>
              {readyConnections.map((connection) => <option key={connection.phoneNumberId} value={connection.phoneNumberId}>{connection.displayPhoneNumber || connection.phoneNumberId}</option>)}
            </select>
          </label>
        )}
        <p className="prospecting-policy-note">A fila envia em dias úteis, entre 9h e 14h (horário de São Paulo), até o limite diário selecionado. Os leads retornados pela busca configurada no DigiBusca entram como autorizados; pedidos de descadastro continuam bloqueados.</p>
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
          <form className="prospecting-chat-form" onSubmit={(event) => void submitDailyCampaign(event)}>
            <label>
              <span>Cidade</span>
              <div className="prospecting-chat-input-wrap"><MapPin size={16} /><input value={campaignCity} onChange={(event) => setCampaignCity(event.target.value)} maxLength={120} placeholder="Ex.: Brasília, DF" disabled={campaignBusy} required /></div>
            </label>
            <label>
              <span>Segmento <small>opcional</small></span>
              <input value={campaignSegment} onChange={(event) => setCampaignSegment(event.target.value)} maxLength={120} placeholder="Todos os segmentos" disabled={campaignBusy} />
            </label>
            <button className="prospecting-chat-submit" type="submit" disabled={campaignBusy || loadState !== 'ready'}>
              {campaignBusy ? <LoaderCircle size={16} className="is-spinning" /> : <Send size={15} />}
              {campaignBusy ? 'Pesquisando…' : dashboard?.campaign.status === 'completed' ? 'Prospectar mais hoje' : 'Buscar e preparar contatos'}
            </button>
          </form>
        ) : dashboard?.campaign.status === 'processing' ? (
          <p className="prospecting-chat-hint">A busca está rodando. O DigiBot vai salvar os resultados e preparar os contatos que couberem na fila diária.</p>
        ) : (
          <p className="prospecting-chat-hint">Você pode iniciar outras buscas hoje. Os envios continuam respeitando o limite diário, o horário configurado e os bloqueios de descadastro.</p>
        )}
        <p className="prospecting-chat-policy">A busca considera empresas cujo perfil do Google não informa um site. A cidade de hoje é <strong>{dashboard?.campaign.city ?? 'ainda não escolhida'}</strong>. A fila respeita seu limite, a janela das 9h às 14h e os bloqueios de descadastro.</p>
      </section>

      {(error || notice) && <div className={`prospecting-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}

      <div className="prospecting-layout">
        <section className="panel prospecting-candidates">
          <header className="prospecting-section-heading">
            <div><span className="eyebrow">CONTATOS PRONTOS</span><h3>Leads elegíveis</h3></div>
            <span className="prospecting-count">{eligibleLeads.length}</span>
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
                  <span>Autorizado pela busca DigiBusca</span>
                </div>
                <label>
                  <span>Mensagem inicial</span>
                  <textarea
                    value={drafts[savedLead.leadId] ?? savedLead.draftMessage ?? ''}
                    maxLength={1_024}
                    rows={3}
                    onChange={(event) => setDrafts((current) => ({ ...current, [savedLead.leadId]: event.target.value }))}
                    placeholder="Escreva uma mensagem personalizada para este lead."
                  />
                </label>
                <button className="secondary-button" type="button" disabled={busyKey === savedLead.leadId || !selectedPhoneNumberId} onClick={() => void queueLead(savedLead)}>
                  <Send size={15} /> {busyKey === savedLead.leadId ? 'Adicionando…' : 'Adicionar à fila'}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="panel prospecting-queue">
          <header className="prospecting-section-heading">
            <div><span className="eyebrow">ACOMPANHAMENTO</span><h3>Envios e agendamentos</h3></div>
            <span className="prospecting-count">{dashboard?.queue.length ?? 0}</span>
          </header>
          {loadState === 'loading' && <p className="prospecting-empty">Carregando fila…</p>}
          {loadState === 'ready' && (dashboard?.queue.length ?? 0) === 0 && <p className="prospecting-empty">A fila está vazia.</p>}
          <div className="prospecting-queue-list">
            {(dashboard?.queue ?? []).map((item) => (
              <article className="prospecting-queue-item" key={item.id}>
                <div className="prospecting-queue-item-top">
                  <div><strong>{leadNames.get(item.leadId) ?? item.leadId}</strong><small>{item.recipientPhone}</small></div>
                  <span className={`prospecting-status is-${item.status}`}>{queueStatusLabel(item)}</span>
                </div>
                <p>{item.message}</p>
                <div className="prospecting-queue-meta"><Clock3 size={13} /> {item.sentAt ? `Enviado ${formatDate(item.sentAt)}` : item.status === 'queued' || item.status === 'sending' ? `Na fila desde ${formatDate(item.createdAt)}` : `${queueStatusLabel(item)} · ${formatDate(item.createdAt)}`}</div>
                {queueErrorLabel(item.errorCode) && <small className="prospecting-uncertain">{queueErrorLabel(item.errorCode)}</small>}
                {item.status === 'queued' && <button className="prospecting-cancel" type="button" disabled={busyKey === item.id} onClick={() => void cancelItem(item)}><Trash2 size={14} /> Cancelar</button>}
                {item.status === 'unknown' && <small className="prospecting-uncertain">Confira a conversa antes de tentar novamente para evitar duplicidade.</small>}
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}
