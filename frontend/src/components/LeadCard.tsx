import { ArrowUpRight, MapPin, MessageCircle, Phone, Star } from 'lucide-react'
import type { Lead } from '../types'
import './LeadCard.css'

type LeadCardProps = { lead: Lead; onSelect: (lead: Lead) => void }

export function LeadCard({ lead, onSelect }: LeadCardProps) {
  return (
    <article className="lead-card">
      <div className="lead-card-topline">
        <span className="opportunity-pill">{lead.opportunity}</span>
        <span className="score">{lead.score}% oportunidade</span>
      </div>
      <div className="lead-heading">
        <div>
          <h3>{lead.name}</h3>
          <p>{lead.category}</p>
        </div>
        <button className="icon-button" type="button" aria-label={`Abrir ${lead.name}`} onClick={() => onSelect(lead)}>
          <ArrowUpRight size={18} />
        </button>
      </div>
      <div className="lead-meta">
        <span><MapPin size={15} />{lead.address}</span>
        <span><Phone size={15} />{lead.phone}</span>
        <span><Star size={15} fill="currentColor" />{lead.rating} ({lead.reviews})</span>
      </div>
      <div className="lead-card-footer">
        <span className="diagnosis-preview">{lead.diagnosis}</span>
        <button className="text-button" type="button" onClick={() => onSelect(lead)}>
          Ver ficha <MessageCircle size={15} />
        </button>
      </div>
    </article>
  )
}
