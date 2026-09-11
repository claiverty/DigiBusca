import { ArrowLeft, Bookmark, ExternalLink, History, MessageCircle, Phone } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { createApproachMessage } from '../lib/approachMessage'
import { hasContactPhone, toWhatsappPhone } from '../lib/phone'
import { createLeadInteraction, getLeadInteractions } from '../services/leadsService'
import { CurrencyInput, currencyCentsToNumber } from './CurrencyInput'
import { DatePicker } from './DatePicker'
import { SaleServiceField } from './SaleServiceField'
import { AiOutreachAssistant } from './AiOutreachAssistant'
import type { Lead, LeadStatus, LeadUpdate } from '../types'
import { interactionChannels, type InteractionChannel, type LeadInteraction } from '../types/interactions'
import type { CreateSaleInput } from '../types/sales'
import './LeadDetail.css'

type LeadDetailProps = {
  lead: Lead
  isSaved: boolean
  onBack: () => void
  onToggleSave: () => Promise<void>
  onUpdateLead: (changes: LeadUpdate) => Promise<void>
  onRegisterSale: (input: Omit<CreateSaleInput, 'businessName' | 'leadId'>) => Promise<void>
}

const leadStatuses: LeadStatus[] = [
  'Novo',
  'Contatado',
  'Respondeu',
  'Proposta',
  'Ganhou',
  'Perdeu',
]

function formatRetrievedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getToday() {
  return new Date().toISOString().slice(0, 10)
}

function formatInteractionDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(
    new Date(`${value}T12:00:00`),
  )
}

export function LeadDetail({
  lead,
  isSaved,
  onBack,
  onToggleSave,
  onUpdateLead,
  onRegisterSale,
}: LeadDetailProps) {
  const [message, setMessage] = useState(lead.draftMessage ?? createApproachMessage(lead))
  const [status, setStatus] = useState<LeadStatus>(lead.status)
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [nextFollowUp, setNextFollowUp] = useState(lead.nextFollowUp ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [saleService, setSaleService] = useState('')
  const [saleAmount, setSaleAmount] = useState('')
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10))
  const [saleFeedback, setSaleFeedback] = useState('')
  const [isRegisteringSale, setIsRegisteringSale] = useState(false)
  const [interactions, setInteractions] = useState<LeadInteraction[]>([])
  const [interactionStatus, setInteractionStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [interactionAttempt, setInteractionAttempt] = useState(0)
  const [interactionChannel, setInteractionChannel] = useState<InteractionChannel>('WhatsApp')
  const [interactionDate, setInteractionDate] = useState(getToday())
  const [interactionNotes, setInteractionNotes] = useState('')
  const [interactionOutcome, setInteractionOutcome] = useState('')
  const [interactionFeedback, setInteractionFeedback] = useState('')
  const [isRegisteringInteraction, setIsRegisteringInteraction] = useState(false)
  const hasPhone = hasContactPhone(lead.phone)
  const whatsappPhone = toWhatsappPhone(lead.phone)
  const whatsappLink = hasPhone
    ? `https://wa.me/${whatsappPhone ?? lead.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
    : undefined

  useEffect(() => {
    if (!isSaved) {
      setInteractions([])
      setInteractionStatus('idle')
      return
    }

    let active = true
    setInteractionStatus('loading')
    void getLeadInteractions(lead.id)
      .then((items) => {
        if (!active) return
        setInteractions(items)
        setInteractionStatus('ready')
      })
      .catch(() => {
        if (active) setInteractionStatus('error')
      })

    return () => {
      active = false
    }
  }, [interactionAttempt, isSaved, lead.id])

  async function handleToggleSave() {
    setIsSaving(true)
    try {
      await onToggleSave()
    } catch {
      setFeedback('Não foi possível alterar o lead salvo. Tente novamente.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSaveChanges() {
    setIsSaving(true)
    setFeedback('')

    try {
      await onUpdateLead({
        status,
        notes,
        nextFollowUp,
        draftMessage: message,
      })
      setFeedback('Alterações salvas.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível salvar as alterações.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRegisterSale() {
    const amount = currencyCentsToNumber(saleAmount)
    setSaleFeedback('')

    if (!saleService.trim() || !Number.isFinite(amount) || amount < 0 || !saleDate) {
      setSaleFeedback('Informe serviço, valor e data da venda.')
      return
    }

    setIsRegisteringSale(true)
    try {
      await onRegisterSale({ service: saleService, amount, soldAt: saleDate })
      setSaleService('')
      setSaleAmount('')
      setSaleFeedback('Venda registrada no Financeiro.')
    } catch (error) {
      setSaleFeedback(
        error instanceof Error ? error.message : 'Não foi possível registrar a venda.',
      )
    } finally {
      setIsRegisteringSale(false)
    }
  }

  async function handleRegisterInteraction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInteractionFeedback('')

    if (!interactionNotes.trim() || !interactionDate) {
      setInteractionFeedback('Informe a data e o resumo da interação.')
      return
    }

    setIsRegisteringInteraction(true)
    try {
      const interaction = await createLeadInteraction(lead.id, {
        channel: interactionChannel,
        occurredAt: interactionDate,
        notes: interactionNotes,
        outcome: interactionOutcome,
      })
      setInteractions((current) => [interaction, ...current])
      setInteractionNotes('')
      setInteractionOutcome('')
      setInteractionFeedback('Interação registrada.')
    } catch (error) {
      setInteractionFeedback(
        error instanceof Error ? error.message : 'Não foi possível registrar a interação.',
      )
    } finally {
      setIsRegisteringInteraction(false)
    }
  }

  return (
    <section className="detail-view">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={16} /> Voltar
      </button>
      <div className="detail-header">
        <div>
          <span className="opportunity-pill">{lead.opportunity}</span>
          <h1>{lead.name}</h1>
          <p>
            {lead.category} · {lead.address}
          </p>
        </div>
        <div className="score-large">
          <strong>{lead.score}%</strong>
          <span>oportunidade</span>
        </div>
      </div>
      <div className="detail-toolbar">
        <button
          className={`secondary-button${isSaved ? ' saved' : ''}`}
          type="button"
          onClick={() => void handleToggleSave()}
          disabled={isSaving}
        >
          <Bookmark size={16} fill={isSaved ? 'currentColor' : 'none'} />
          {isSaving ? 'Salvando...' : isSaved ? 'Lead salvo' : 'Salvar lead'}
        </button>
      </div>
      <div className="detail-grid">
        <div className="detail-main">
          <div className="panel">
            <span className="eyebrow">Diagnóstico</span>
            <h2>Uma oportunidade clara de abordagem</h2>
            <p>{lead.diagnosis}</p>
          </div>
          <div className="panel">
            <div className="approach-heading">
              <span className="eyebrow">Abordagem sugerida</span>
              <AiOutreachAssistant lead={lead} onUseMessage={setMessage} />
            </div>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              aria-label="Mensagem de abordagem"
            />
            <div className="panel-actions">
              {whatsappLink ? (
                <a className="primary-button" href={whatsappLink} target="_blank" rel="noreferrer">
                  <MessageCircle size={17} /> Abrir no WhatsApp
                </a>
              ) : (
                <button
                  className="secondary-button"
                  type="button"
                  disabled
                  title="Este perfil não tem telefone público disponível."
                >
                  <MessageCircle size={17} /> WhatsApp indisponível
                </button>
              )}
              <button
                className="secondary-button"
                type="button"
                onClick={() => void handleSaveChanges()}
                disabled={isSaving}
              >
                {isSaving ? 'Salvando...' : 'Salvar rascunho'}
              </button>
            </div>
          </div>
          <div className="panel detail-follow-up">
            <span className="eyebrow">Acompanhamento</span>
            <div className="detail-form-grid">
              <label className="detail-field">
                <span>Status</span>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as LeadStatus)}
                >
                  {leadStatuses.map((leadStatus) => (
                    <option key={leadStatus} value={leadStatus}>
                      {leadStatus}
                    </option>
                  ))}
                </select>
              </label>
              <label className="detail-field">
                <span>Próximo follow-up</span>
                <DatePicker value={nextFollowUp} onChange={setNextFollowUp} />
              </label>
            </div>
            <label className="detail-field">
              <span>Observações</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Registre o contexto da conversa"
                aria-label="Observações do lead"
              />
            </label>
            <div className="panel-actions follow-up-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleSaveChanges()}
                disabled={isSaving}
              >
                {isSaving ? 'Salvando...' : 'Salvar acompanhamento'}
              </button>
              {feedback && (
                <span className="save-feedback" role="status">
                  {feedback}
                </span>
              )}
            </div>
          </div>
          <div className="panel lead-interactions">
            <div className="section-heading">
              <div>
                <span className="eyebrow">HISTÓRICO</span>
                <h2>Interações do lead</h2>
              </div>
              <History size={19} className="section-muted-icon" aria-hidden="true" />
            </div>
            {!isSaved ? (
              <div className="interaction-save-prompt">
                <p>Salve o lead para registrar os contatos e acompanhar a evolução da conversa.</p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void handleToggleSave()}
                  disabled={isSaving}
                >
                  {isSaving ? 'Salvando...' : 'Salvar lead'}
                </button>
              </div>
            ) : (
              <>
                <form className="interaction-form" onSubmit={handleRegisterInteraction}>
                  <div className="detail-form-grid">
                    <label className="detail-field">
                      <span>Canal</span>
                      <select
                        value={interactionChannel}
                        onChange={(event) => setInteractionChannel(event.target.value as InteractionChannel)}
                      >
                        {interactionChannels.map((channel) => (
                          <option key={channel} value={channel}>{channel}</option>
                        ))}
                      </select>
                    </label>
                    <label className="detail-field">
                      <span>Data do contato</span>
                      <DatePicker value={interactionDate} onChange={setInteractionDate} />
                    </label>
                  </div>
                  <label className="detail-field">
                    <span>O que aconteceu?</span>
                    <textarea
                      value={interactionNotes}
                      onChange={(event) => setInteractionNotes(event.target.value)}
                      placeholder="Ex.: Apresentei a ideia e combinei de enviar uma proposta."
                      aria-label="Resumo da interação"
                      maxLength={5_000}
                    />
                  </label>
                  <label className="detail-field">
                    <span>Resultado (opcional)</span>
                    <input
                      value={interactionOutcome}
                      onChange={(event) => setInteractionOutcome(event.target.value)}
                      placeholder="Ex.: Pediu retorno na próxima semana"
                      aria-label="Resultado da interação"
                      maxLength={500}
                    />
                  </label>
                  <div className="panel-actions interaction-actions">
                    <button className="primary-button" type="submit" disabled={isRegisteringInteraction}>
                      {isRegisteringInteraction ? 'Registrando...' : 'Registrar interação'}
                    </button>
                    {interactionFeedback && (
                      <span className="save-feedback" role="status">{interactionFeedback}</span>
                    )}
                  </div>
                </form>
                {interactionStatus === 'loading' && <div className="data-state">Carregando histórico...</div>}
                {interactionStatus === 'error' && (
                  <div className="data-state" role="alert">
                    <p>Não foi possível carregar o histórico.</p>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setInteractionAttempt((value) => value + 1)}
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}
                {interactionStatus === 'ready' && interactions.length === 0 && (
                  <p className="interaction-empty">Nenhuma interação registrada ainda.</p>
                )}
                {interactions.length > 0 && (
                  <div className="interaction-list" aria-label="Interações registradas">
                    {interactions.map((interaction) => (
                      <article className="interaction-row" key={interaction.id}>
                        <div className="interaction-row-heading">
                          <strong>{interaction.channel}</strong>
                          <time dateTime={interaction.occurredAt}>{formatInteractionDate(interaction.occurredAt)}</time>
                        </div>
                        <p>{interaction.notes}</p>
                        {interaction.outcome && <small>Resultado: {interaction.outcome}</small>}
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="panel sale-from-lead">
            <div className="section-heading">
              <div>
                <span className="eyebrow">CONVERSÃO</span>
                <h2>Registrar venda deste lead</h2>
              </div>
            </div>
            <div className="detail-form-grid">
              <label className="detail-field">
                <span>Serviço vendido</span>
                <SaleServiceField value={saleService} onChange={setSaleService} />
              </label>
              <label className="detail-field">
                <span>Valor</span>
                <CurrencyInput value={saleAmount} onChange={setSaleAmount} />
              </label>
            </div>
            <label className="detail-field">
              <span>Data da venda</span>
                <DatePicker value={saleDate} onChange={setSaleDate} />
            </label>
            <div className="panel-actions follow-up-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleRegisterSale()}
                disabled={isRegisteringSale}
              >
                {isRegisteringSale ? 'Registrando...' : 'Registrar venda'}
              </button>
              {saleFeedback && (
                <span className="save-feedback" role="status">
                  {saleFeedback}
                </span>
              )}
            </div>
          </div>
        </div>
        <aside className="detail-side panel">
          <span className="eyebrow">Informações encontradas</span>
          <dl>
            <div>
              <dt>Telefone</dt>
              <dd>{lead.phone}</dd>
            </div>
            <div>
              <dt>Avaliação</dt>
              <dd>
                {lead.rating} em 5 ({lead.reviews})
              </dd>
            </div>
            <div>
              <dt>Site</dt>
              <dd>
                {lead.website ? (
                  <a href={lead.website} target="_blank" rel="noreferrer">
                    Abrir site <ExternalLink size={13} />
                  </a>
                ) : (
                  'Não encontrado'
                )}
              </dd>
            </div>
            {lead.googleMapsUri && (
              <div>
                <dt>Fonte</dt>
                <dd>
                  <a href={lead.googleMapsUri} target="_blank" rel="noreferrer" translate="no">
                    {lead.source} <ExternalLink size={13} />
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt>Consultado</dt>
              <dd>{formatRetrievedAt(lead.retrievedAt)}</dd>
            </div>
          </dl>
          {hasPhone ? (
            <a className="contact-link" href={`tel:${lead.phone}`}>
              <Phone size={16} /> Ligar para a empresa
            </a>
          ) : (
            <span className="contact-link contact-unavailable">
              <Phone size={16} /> Telefone não disponível
            </span>
          )}
        </aside>
      </div>
    </section>
  )
}
