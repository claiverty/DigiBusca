import { ArrowLeft, Bookmark, ExternalLink, MessageCircle, Phone } from 'lucide-react'
import { useState } from 'react'
import { createApproachMessage } from '../lib/approachMessage'
import type { Lead, LeadStatus, LeadUpdate } from '../types'
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
  const whatsappLink = `https://wa.me/${lead.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`

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
    const amount = Number(saleAmount.replace(',', '.'))
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
            <span className="eyebrow">Abordagem sugerida</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              aria-label="Mensagem de abordagem"
            />
            <div className="panel-actions">
              <a className="primary-button" href={whatsappLink} target="_blank" rel="noreferrer">
                <MessageCircle size={17} /> Abrir no WhatsApp
              </a>
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
                <input
                  type="date"
                  value={nextFollowUp}
                  onChange={(event) => setNextFollowUp(event.target.value)}
                />
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
                <input
                  value={saleService}
                  onChange={(event) => setSaleService(event.target.value)}
                  placeholder="Ex.: Site institucional"
                />
              </label>
              <label className="detail-field">
                <span>Valor</span>
                <input
                  inputMode="decimal"
                  value={saleAmount}
                  onChange={(event) => setSaleAmount(event.target.value)}
                  placeholder="R$ 0,00"
                />
              </label>
            </div>
            <label className="detail-field">
              <span>Data da venda</span>
              <input
                type="date"
                value={saleDate}
                onChange={(event) => setSaleDate(event.target.value)}
              />
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
          <a className="contact-link" href={`tel:${lead.phone}`}>
            <Phone size={16} /> Ligar para a empresa
          </a>
        </aside>
      </div>
    </section>
  )
}
