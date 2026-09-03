import { ArrowLeft, Bookmark, ExternalLink, MessageCircle, Phone } from 'lucide-react'
import { useState } from 'react'
import type { Lead } from '../types'
import './LeadDetail.css'

type LeadDetailProps = { lead: Lead; isSaved: boolean; onBack: () => void; onToggleSave: () => Promise<void> }

export function LeadDetail({ lead, isSaved, onBack, onToggleSave }: LeadDetailProps) {
  const [message, setMessage] = useState(`Olá, ${lead.name}! Encontrei o perfil de vocês e percebi uma oportunidade de apresentar melhor o negócio online. Posso te mostrar uma ideia?`)
  const [isSaving, setIsSaving] = useState(false)
  const whatsappLink = `https://wa.me/${lead.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`

  async function handleToggleSave() {
    setIsSaving(true)
    try {
      await onToggleSave()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="detail-view">
      <button className="back-button" type="button" onClick={onBack}><ArrowLeft size={16} /> Voltar para resultados</button>
      <div className="detail-header">
        <div>
          <span className="opportunity-pill">{lead.opportunity}</span>
          <h1>{lead.name}</h1>
          <p>{lead.category} · {lead.address}</p>
        </div>
        <div className="score-large"><strong>{lead.score}%</strong><span>oportunidade</span></div>
      </div>
      <div className="detail-toolbar">
        <button className={`secondary-button${isSaved ? ' saved' : ''}`} type="button" onClick={() => void handleToggleSave()} disabled={isSaving}>
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
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} aria-label="Mensagem de abordagem" />
            <div className="panel-actions">
              <a className="primary-button" href={whatsappLink} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Abrir no WhatsApp</a>
              <button className="secondary-button" type="button">Salvar rascunho</button>
            </div>
          </div>
        </div>
        <aside className="detail-side panel">
          <span className="eyebrow">Informações encontradas</span>
          <dl>
            <div><dt>Telefone</dt><dd>{lead.phone}</dd></div>
            <div><dt>Avaliação</dt><dd>{lead.rating} em 5 ({lead.reviews})</dd></div>
            <div><dt>Site</dt><dd>{lead.website ? <a href={lead.website} target="_blank" rel="noreferrer">Abrir site <ExternalLink size={13} /></a> : 'Não encontrado'}</dd></div>
          </dl>
          <a className="contact-link" href={`tel:${lead.phone}`}><Phone size={16} /> Ligar para a empresa</a>
        </aside>
      </div>
    </section>
  )
}
