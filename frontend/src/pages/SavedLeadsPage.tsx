import { ArrowUpRight, CalendarDays, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FilterCombobox } from '../components/FilterCombobox'
import { getSavedLeads, type SavedLeadState } from '../services/leadsService'
import type { Lead } from '../types'
import './SavedLeadsPage.css'

type SavedLeadsPageProps = {
  cachedLeads: Lead[]
  onOpenLead: (leadId: string) => Promise<void>
  onRemoveLead: (leadId: string) => Promise<void>
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

export function SavedLeadsPage({
  cachedLeads,
  onOpenLead,
  onRemoveLead,
  onSearch,
}: SavedLeadsPageProps) {
  const [leads, setLeads] = useState<SavedLeadState[]>([])
  const [status, setStatus] = useState('loading')
  const [attempt, setAttempt] = useState(0)
  const [statusFilter, setStatusFilter] = useState('Todos')
  const [followUpFilter, setFollowUpFilter] = useState('Todos')
  const [openingLeadId, setOpeningLeadId] = useState<string | null>(null)
  const [openingError, setOpeningError] = useState('')
  const [openingErrorLeadId, setOpeningErrorLeadId] = useState<string | null>(null)
  const [pendingRemovalLeadId, setPendingRemovalLeadId] = useState<string | null>(null)
  const [removingLeadId, setRemovingLeadId] = useState<string | null>(null)
  const [removalError, setRemovalError] = useState('')

  const cachedLeadById = useMemo(
    () => new Map(cachedLeads.map((lead) => [lead.id, lead])),
    [cachedLeads],
  )

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

  async function openLead(leadId: string) {
    setOpeningLeadId(leadId)
    setOpeningError('')
    setOpeningErrorLeadId(null)

    try {
      await onOpenLead(leadId)
    } catch (error) {
      setOpeningError(error instanceof Error ? error.message : 'Não foi possível atualizar este lead agora.')
      setOpeningErrorLeadId(leadId)
      setOpeningLeadId(null)
    }
  }

  async function removeLead(leadId: string) {
    setRemovingLeadId(leadId)
    setRemovalError('')

    try {
      await onRemoveLead(leadId)
      setLeads((current) => current.filter((lead) => lead.leadId !== leadId))
      setPendingRemovalLeadId(null)
    } catch (error) {
      setRemovalError(error instanceof Error ? error.message : 'Não foi possível excluir este lead agora.')
    } finally {
      setRemovingLeadId(null)
    }
  }

  function getLeadName(lead: SavedLeadState) {
    return cachedLeadById.get(lead.leadId)?.name ?? 'Lead salvo'
  }

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
                  key={lead.leadId}
                  type="button"
                  onClick={() => void openLead(lead.leadId)}
                >
                  <span className={isOverdue ? 'agenda-date overdue' : 'agenda-date'}>
                    {isOverdue ? 'Atrasado' : formatFollowUpDate(lead.nextFollowUp!)}
                  </span>
                  <span className="agenda-lead-name">
                    <strong>{getLeadName(lead)}</strong>
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
          <FilterCombobox
            id="saved-leads-status"
            label="Status"
            value={statusFilter}
            options={['Todos', ...statuses]}
            onChange={setStatusFilter}
          />
        </label>
        <label>
          Próximo contato
          <FilterCombobox
            id="saved-leads-follow-up"
            label="Próximo contato"
            value={followUpFilter}
            options={['Todos', 'Atrasados', 'Próximos 7 dias', 'Sem agendamento']}
            onChange={setFollowUpFilter}
          />
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
      {removalError && <p className="data-state" role="alert">{removalError}</p>}
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
                <section className="saved-lead-summary panel" key={lead.leadId} aria-label="Lead salvo">
                  <p className="saved-lead-status">
                    {lead.status} · {lead.nextFollowUp
                      ? `Próximo contato: ${toLocalDate(lead.nextFollowUp).toLocaleDateString('pt-BR')}`
                      : 'Sem contato agendado'}
                  </p>
                  <h2>{getLeadName(lead)}</h2>
                  <p>
                    {lead.notes?.trim()
                      || cachedLeadById.get(lead.leadId)?.category
                      || 'Abra a ficha para atualizar os dados da empresa e continuar a abordagem.'}
                  </p>
                  {openingErrorLeadId === lead.leadId && (
                    <p className="saved-lead-error" role="alert">{openingError}</p>
                  )}
                  <div className="saved-lead-actions">
                    <button
                      className="secondary-button saved-lead-open"
                      type="button"
                      onClick={() => void openLead(lead.leadId)}
                      disabled={openingLeadId === lead.leadId || removingLeadId === lead.leadId}
                    >
                      <RefreshCw size={16} aria-hidden="true" />
                      {openingLeadId === lead.leadId ? 'Atualizando...' : 'Abrir e atualizar dados'}
                    </button>
                    {pendingRemovalLeadId === lead.leadId ? (
                      <div className="saved-lead-remove-confirm">
                        <span>Excluir este lead salvo?</span>
                        <button
                          className="saved-lead-delete"
                          type="button"
                          onClick={() => void removeLead(lead.leadId)}
                          disabled={removingLeadId === lead.leadId}
                        >
                          {removingLeadId === lead.leadId ? 'Excluindo...' : 'Excluir'}
                        </button>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setPendingRemovalLeadId(null)}
                          disabled={removingLeadId === lead.leadId}
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        className="saved-lead-delete"
                        type="button"
                        onClick={() => setPendingRemovalLeadId(lead.leadId)}
                        disabled={openingLeadId === lead.leadId || removingLeadId === lead.leadId}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        Excluir lead
                      </button>
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
