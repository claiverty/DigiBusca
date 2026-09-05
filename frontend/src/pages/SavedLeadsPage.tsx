import { ArrowUpRight, CalendarDays, Download } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { LeadCard } from '../components/LeadCard'
import { exportLeadsCsv } from '../services/exportLeadsCsv'
import { getSavedLeads } from '../services/leadsService'
import type { Lead } from '../types'
import './SavedLeadsPage.css'

type SavedLeadsPageProps = {
  onSelectLead: (lead: Lead) => void
  onSearch: () => void
}

const statuses = ['Novo', 'Contatado', 'Respondeu', 'Proposta', 'Ganhou', 'Perdeu']

function toLocalDate(value: string) {
  return new Date(`${value}T12:00:00`)
}

function getToday() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

function formatFollowUpDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  })
    .format(toLocalDate(value))
    .replace('.', '')
}

export function SavedLeadsPage({ onSelectLead, onSearch }: SavedLeadsPageProps) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [status, setStatus] = useState('loading')
  const [attempt, setAttempt] = useState(0)
  const [statusFilter, setStatusFilter] = useState('Todos')
  const [followUpFilter, setFollowUpFilter] = useState('Todos')

  useEffect(() => {
    let active = true
    setStatus('loading')
    void getSavedLeads()
      .then((data) => {
        if (!active) return
        setLeads(data)
        setStatus('ready')
      })
      .catch(() => {
        if (active) setStatus('error')
      })
    return () => {
      active = false
    }
  }, [attempt])

  const visibleLeads = useMemo(() => {
    const today = getToday()
    const weekEnd = new Date(today)
    weekEnd.setDate(today.getDate() + 7)
    return leads.filter((lead) => {
      if (statusFilter !== 'Todos' && lead.status !== statusFilter) return false
      if (followUpFilter === 'Todos') return true
      if (followUpFilter === 'Sem agendamento') return !lead.nextFollowUp
      if (!lead.nextFollowUp) return false
      const date = toLocalDate(lead.nextFollowUp)
      return followUpFilter === 'Atrasados'
        ? date < today
        : date >= today && date < weekEnd
    })
  }, [leads, statusFilter, followUpFilter])

  const agendaLeads = useMemo(() => {
    const today = getToday()
    const weekEnd = new Date(today)
    weekEnd.setDate(today.getDate() + 7)

    return leads
      .filter((lead) => {
        if (!lead.nextFollowUp || lead.status === 'Ganhou' || lead.status === 'Perdeu') return false
        return toLocalDate(lead.nextFollowUp) < weekEnd
      })
      .sort((first, second) => first.nextFollowUp!.localeCompare(second.nextFollowUp!))
  }, [leads])

  return (
    <section className="saved-leads-page">
      <header className="page-header saved-leads-header">
        <div>
          <span className="eyebrow">ACOMPANHAMENTO</span>
          <h1>Meus leads</h1>
          <p>Continue suas conversas e acompanhe os próximos contatos.</p>
        </div>
        {status === 'ready' && leads.length > 0 && (
          <button className="secondary-button saved-leads-export" type="button" onClick={() => exportLeadsCsv(leads)}>
            <Download size={16} aria-hidden="true" /> Exportar CSV
          </button>
        )}
      </header>

      {status === 'ready' && agendaLeads.length > 0 && (
        <section className="follow-up-agenda panel" aria-labelledby="agenda-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">PRÓXIMOS 7 DIAS</span>
              <h2 id="agenda-title">Sua agenda de contatos</h2>
            </div>
            <CalendarDays className="section-muted-icon" size={19} aria-hidden="true" />
          </div>
          <div className="follow-up-agenda-list">
            {agendaLeads.map((lead) => {
              const isOverdue = toLocalDate(lead.nextFollowUp!) < getToday()
              return (
                <button
                  className="agenda-lead"
                  key={lead.id}
                  type="button"
                  onClick={() => onSelectLead(lead)}
                >
                  <span className={isOverdue ? 'agenda-date overdue' : 'agenda-date'}>
                    {isOverdue ? 'Atrasado' : formatFollowUpDate(lead.nextFollowUp!)}
                  </span>
                  <span className="agenda-lead-name">
                    <strong>{lead.name}</strong>
                    <small>{lead.status}</small>
                  </span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </section>
      )}

      <div className="saved-leads-filters panel">
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option>Todos</option>
            {statuses.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Próximo contato
          <select value={followUpFilter} onChange={(event) => setFollowUpFilter(event.target.value)}>
            <option>Todos</option>
            <option>Atrasados</option>
            <option>Próximos 7 dias</option>
            <option>Sem agendamento</option>
          </select>
        </label>
      </div>

      {status === 'loading' && <p className="data-state">Carregando seus leads...</p>}
      {status === 'error' && (
        <div className="data-state" role="alert">
          <p>Não foi possível carregar seus leads.</p>
          <button className="secondary-button" onClick={() => setAttempt((value) => value + 1)}>
            Tentar novamente
          </button>
        </div>
      )}
      {status === 'ready' && (
        <>
          <p className="muted" role="status">
            {visibleLeads.length} lead(s) encontrado(s)
          </p>
          {leads.length === 0 ? (
            <div className="data-state">
              <p>Salve uma empresa pela ficha para começar seu acompanhamento.</p>
              <button className="primary-button" type="button" onClick={onSearch}>
                Buscar oportunidades
              </button>
            </div>
          ) : visibleLeads.length === 0 ? (
            <p className="data-state">Nenhum lead corresponde aos filtros selecionados.</p>
          ) : (
            <div className="saved-leads-list">
              {visibleLeads.map((lead) => (
                <section key={lead.id} aria-label={lead.name}>
                  <p className="saved-lead-status">
                    {lead.status} · {lead.nextFollowUp
                      ? `Próximo contato: ${toLocalDate(lead.nextFollowUp).toLocaleDateString('pt-BR')}`
                      : 'Sem contato agendado'}
                  </p>
                  <LeadCard lead={lead} onSelect={onSelectLead} />
                </section>
              ))}
            </div>
          )}
          {visibleLeads.length > 0 && (
            <p className="places-attribution">Dados de lugares: Google Maps</p>
          )}
        </>
      )}
    </section>
  )
}
