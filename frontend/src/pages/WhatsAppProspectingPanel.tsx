import { AlertCircle, CheckCircle2, Clock3, Pause, Play, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSavedLeads, type SavedLeadState } from '../services/leadsService'
import {
  cancelWhatsAppQueueItem,
  enqueueWhatsAppNewLead,
  getWhatsAppProspectingDashboard,
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
          <p>O DigiBusca envia mensagens de texto pela Evolution API, em horário comercial e com intervalo entre os contatos.</p>
        </div>
        <div className="prospecting-today-count">
          <strong>{dashboard?.dailyCount ?? '—'}<span> / {dashboard?.settings.dailyNewLeadLimit ?? dailyLimit}</span></strong>
          <small>vagas usadas hoje</small>
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

        {!runtimeEnabled && <p className="prospecting-guidance"><AlertCircle size={15} /> O backend local ainda precisa de <code>WHATSAPP_PROSPECTING_RUNTIME_ENABLED=true</code> para processar envios.</p>}
        {!evolutionConfigured && <p className="prospecting-guidance"><AlertCircle size={15} /> Configure a URL e a chave da Evolution API no backend local.</p>}
        {readyConnections.length === 0 && <p className="prospecting-guidance"><AlertCircle size={15} /> Conecte o WhatsApp pela Evolution API na aba Conexão.</p>}
        {readyConnections.length > 1 && (
          <label className="prospecting-phone-field">
            <span>Número de envio</span>
            <select value={selectedPhoneNumberId} onChange={(event) => setSelectedPhoneNumberId(event.target.value)}>
              {readyConnections.map((connection) => <option key={connection.phoneNumberId} value={connection.phoneNumberId}>{connection.displayPhoneNumber || connection.phoneNumberId}</option>)}
            </select>
          </label>
        )}
        <p className="prospecting-policy-note">Só entram na fila leads salvos com consentimento registrado e status Novo. O envio roda de segunda a sexta, entre 9h e 18h, no fuso de São Paulo. Respostas de conversas ativas seguem o controle de automação da aba Conexão.</p>
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
            <div className="prospecting-empty-state"><CheckCircle2 size={22} /><strong>Nenhum lead elegível agora</strong><span>Salve leads novos e registre o consentimento antes de adicioná-los à fila.</span></div>
          )}
          <div className="prospecting-lead-list">
            {eligibleLeads.map((savedLead) => (
              <article className="prospecting-lead-card" key={savedLead.leadId}>
                <div className="prospecting-lead-heading">
                  <div><strong>{savedLead.lead?.name ?? 'Lead sem nome'}</strong><small>{savedLead.lead?.category ?? 'Categoria não informada'} · {savedLead.lead?.phone}</small></div>
                  <span>Autorização registrada</span>
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
