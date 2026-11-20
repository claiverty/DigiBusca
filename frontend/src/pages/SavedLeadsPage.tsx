import { ArrowUpRight, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, Download, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getSavedLeads,
  MAX_BULK_LEAD_IDS,
  type BulkLeadDeleteResult,
  type BulkLeadStatusResult,
  type SavedLeadState,
} from '../services/leadsService'
import { exportLeadsCsv } from '../services/exportLeadsCsv'
import { localDateKey, localDay, isOpenStatus } from '../lib/dates'
import type { Lead, LeadStatus } from '../types'
import { AppSelect } from '../components/AppSelect'
import './SavedLeadsPage.css'

type SavedLeadsPageProps = {
  cachedLeads: Lead[]
  onOpenLead: (leadId: string) => Promise<void>
  onRemoveLead: (leadId: string) => Promise<void>
  onRemoveLeadsBulk: (leadIds: string[]) => Promise<BulkLeadDeleteResult>
  onUpdateLeadsStatusBulk: (leadIds: string[], status: LeadStatus) => Promise<BulkLeadStatusResult>
  onSearch: () => void
}

const statuses: LeadStatus[] = ['Novo', 'Contatado', 'Respondeu', 'Proposta', 'Ganhou', 'Perdeu']

function toLocalDate(value: string) {
  return localDay(value)
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

function isSameDay(first: Date, second: Date) {
  return first.getTime() === second.getTime()
}

export function SavedLeadsPage({
  cachedLeads,
  onOpenLead,
  onRemoveLead,
  onRemoveLeadsBulk,
  onUpdateLeadsStatusBulk,
  onSearch,
}: SavedLeadsPageProps) {
  const [leads, setLeads] = useState<SavedLeadState[]>([])
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(() => new Set())
  const [bulkStatus, setBulkStatus] = useState<LeadStatus>('Contatado')
  const [bulkBusy, setBulkBusy] = useState<'status' | 'delete' | null>(null)
  const [bulkDeleteConfirmation, setBulkDeleteConfirmation] = useState(false)
  const [bulkFeedback, setBulkFeedback] = useState('')
  const [bulkError, setBulkError] = useState('')
  const selectVisibleRef = useRef<HTMLInputElement>(null)
  const statusTabsRef = useRef<HTMLDivElement>(null)
  const [statusTabsOverflow, setStatusTabsOverflow] = useState({ left: false, right: false })
  const [status, setStatus] = useState('loading')
  const [attempt, setAttempt] = useState(0)
  const [searchText, setSearchText] = useState('')
  const [sortOrder, setSortOrder] = useState('followUp')
  const [statusFilter, setStatusFilter] = useState('Todos')
  const [followUpFilter, setFollowUpFilter] = useState('Todos')
  const [openingLeadId, setOpeningLeadId] = useState<string | null>(null)
  const [openingError, setOpeningError] = useState('')
  const [openingErrorLeadId, setOpeningErrorLeadId] = useState<string | null>(null)
  const [pendingRemovalLeadId, setPendingRemovalLeadId] = useState<string | null>(null)
  const [removingLeadId, setRemovingLeadId] = useState<string | null>(null)
  const [removalError, setRemovalError] = useState('')
  const [exportFeedback, setExportFeedback] = useState('')

  const cachedLeadById = useMemo(
    () => new Map([
      ...cachedLeads.map((lead) => [lead.id, lead] as const),
      ...leads.flatMap((savedLead) => savedLead.lead
        ? [[savedLead.leadId, { ...savedLead.lead, status: savedLead.status, notes: savedLead.notes, nextFollowUp: savedLead.nextFollowUp, draftMessage: savedLead.draftMessage, conversationStage: savedLead.conversationStage, contactName: savedLead.contactName, nextAction: savedLead.nextAction } as Lead] as const]
        : []),
    ]),
    [cachedLeads, leads],
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
    const cachedName = cachedLeadById.get(lead.leadId)?.name
    return cachedName ?? 'Empresa indisponível'
  }

  const visibleLeads = useMemo(() => {
    const today = getToday()
    const weekEnd = new Date(today)
    weekEnd.setDate(today.getDate() + 7)
    return leads.filter((lead) => {
      const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
      if (searchText.trim() && !normalize(`${getLeadName(lead)} ${lead.contactName ?? ''} ${cachedLeadById.get(lead.leadId)?.category ?? ''}`).includes(normalize(searchText.trim()))) return false
      if (statusFilter !== 'Todos'  && lead.status !== statusFilter) return false
      if (followUpFilter === 'Todos') return true
      if (!isOpenStatus(lead.status)) return false
      if (followUpFilter === 'Hoje') return lead.nextFollowUp === localDateKey()
      if (followUpFilter === 'Sem agendamento') return !lead.nextFollowUp
      if (!lead.nextFollowUp) return false
      const date = toLocalDate(lead.nextFollowUp)
      return followUpFilter === 'Atrasados'
        ? date < today
        : date >= today && date < weekEnd
    }).sort((a, b) => sortOrder === 'name' ? getLeadName(a).localeCompare(getLeadName(b), 'pt-BR') : sortOrder === 'recent' ? b.updatedAt.localeCompare(a.updatedAt) : (a.nextFollowUp ?? '9999').localeCompare(b.nextFollowUp ?? '9999'))
  }, [leads, statusFilter, followUpFilter, searchText, sortOrder, cachedLeadById])

  const visibleLeadIds = useMemo(() => visibleLeads.map((lead) => lead.leadId), [visibleLeads])
  const visibleLeadIdsKey = visibleLeadIds.join('\0')
  const selectedVisibleCount = visibleLeadIds.reduce(
    (count, leadId) => count + Number(selectedLeadIds.has(leadId)),
    0,
  )
  const allVisibleSelected = visibleLeadIds.length > 0 && selectedVisibleCount === visibleLeadIds.length
  const visibleSelectionExceedsLimit = visibleLeadIds.length > MAX_BULK_LEAD_IDS

  useEffect(() => {
    if (selectVisibleRef.current) {
      selectVisibleRef.current.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected
    }
  }, [selectedVisibleCount, allVisibleSelected])

  useEffect(() => {
    const visibleIds = new Set(visibleLeadIds)
    setSelectedLeadIds((current) => {
      const next = new Set([...current].filter((leadId) => visibleIds.has(leadId)))
      return next.size === current.size ? current : next
    })
    setBulkDeleteConfirmation(false)
  }, [visibleLeadIdsKey])

  function toggleVisibleLead(leadId: string) {
    setSelectedLeadIds((current) => {
      if (!current.has(leadId) && current.size >= MAX_BULK_LEAD_IDS) return current
      const next = new Set(current)
      if (next.has(leadId)) next.delete(leadId)
      else next.add(leadId)
      return next
    })
    setBulkError('')
    setBulkFeedback('')
    setBulkDeleteConfirmation(false)
  }

  function toggleAllVisibleLeads() {
    if (visibleSelectionExceedsLimit) return
    setSelectedLeadIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) visibleLeadIds.forEach((leadId) => next.delete(leadId))
      else visibleLeadIds.forEach((leadId) => next.add(leadId))
      return next
    })
    setBulkError('')
    setBulkFeedback('')
    setBulkDeleteConfirmation(false)
  }

  async function updateSelectedLeadsStatus() {
    const leadIds = visibleLeadIds.filter((leadId) => selectedLeadIds.has(leadId))
    if (!leadIds.length || leadIds.length > MAX_BULK_LEAD_IDS || bulkBusy) return

    setBulkBusy('status')
    setBulkError('')
    setBulkFeedback('')
    try {
      const result = await onUpdateLeadsStatusBulk(leadIds, bulkStatus)
      setLeads((current) => current.map((lead) => result.updatedLeadIds.includes(lead.leadId)
        ? { ...lead, status: bulkStatus }
        : lead))
      setSelectedLeadIds((current) => new Set([...current].filter((leadId) => !result.updatedLeadIds.includes(leadId))))
      setBulkDeleteConfirmation(false)
      setBulkFeedback(result.updatedCount === leadIds.length
        ? `Status atualizado para ${result.updatedCount} lead(s).`
        : result.updatedCount > 0
          ? `Status atualizado para ${result.updatedCount} de ${leadIds.length} lead(s) selecionado(s).`
          : `Nenhum dos ${leadIds.length} lead(s) selecionado(s) foi atualizado.`)
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : 'Não foi possível atualizar os leads selecionados.')
    } finally {
      setBulkBusy(null)
    }
  }

  async function removeSelectedLeads() {
    const leadIds = visibleLeadIds.filter((leadId) => selectedLeadIds.has(leadId))
    if (!leadIds.length || leadIds.length > MAX_BULK_LEAD_IDS || bulkBusy) return

    setBulkBusy('delete')
    setBulkError('')
    setBulkFeedback('')
    try {
      const result = await onRemoveLeadsBulk(leadIds)
      setLeads((current) => current.filter((lead) => !result.deletedLeadIds.includes(lead.leadId)))
      setSelectedLeadIds((current) => new Set([...current].filter((leadId) => !result.deletedLeadIds.includes(leadId))))
      setBulkDeleteConfirmation(false)
      setBulkFeedback(result.deletedCount === leadIds.length
        ? `${result.deletedCount} lead(s) excluído(s).`
        : result.deletedCount > 0
          ? `${result.deletedCount} de ${leadIds.length} lead(s) selecionado(s) excluído(s).`
          : `Nenhum dos ${leadIds.length} lead(s) selecionado(s) foi excluído.`)
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : 'Não foi possível excluir os leads selecionados.')
    } finally {
      setBulkBusy(null)
    }
  }

  const exportableLeads = visibleLeads.flatMap((state) => {
    const lead = cachedLeadById.get(state.leadId)
    return lead ? [{ ...lead, status: state.status, notes: state.notes, nextFollowUp: state.nextFollowUp, conversationStage: state.conversationStage, contactName: state.contactName, nextAction: state.nextAction }] : []
  })

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

  const attentionLeads = useMemo(() => {
    const today = getToday()
    const overdueOrToday = agendaLeads.filter((lead) => {
      const date = toLocalDate(lead.nextFollowUp!)
      return date < today || isSameDay(date, today)
    })
    const upcoming = agendaLeads.filter((lead) => toLocalDate(lead.nextFollowUp!) > today)
    return [...overdueOrToday, ...upcoming].slice(0, 4)
  }, [agendaLeads])

  const unscheduledCount = useMemo(
    () => leads.filter((lead) => !lead.nextFollowUp && lead.status !== 'Ganhou' && lead.status !== 'Perdeu').length,
    [leads],
  )

  const statusCounts = useMemo(
    () => new Map(statuses.map((item) => [item, leads.filter((lead) => lead.status === item).length])),
    [leads],
  )

  useEffect(() => {
    const tabs = statusTabsRef.current
    if (!tabs) return

    function updateOverflow() {
      if (!tabs) return
      const firstTab = tabs.querySelector('button:first-child')
      const lastTab = tabs.querySelector('button:last-child')
      const tabsBounds = tabs.getBoundingClientRect()
      const firstTabBounds = firstTab?.getBoundingClientRect()
      const lastTabBounds = lastTab?.getBoundingClientRect()

      setStatusTabsOverflow({
        left: Boolean(firstTabBounds && firstTabBounds.left < tabsBounds.left - 4),
        right: Boolean(lastTabBounds && lastTabBounds.right > tabsBounds.right + 4),
      })
    }

    updateOverflow()
    tabs.addEventListener('scroll', updateOverflow, { passive: true })
    const resizeObserver = new ResizeObserver(updateOverflow)
    resizeObserver.observe(tabs)

    return () => {
      tabs.removeEventListener('scroll', updateOverflow)
      resizeObserver.disconnect()
    }
  }, [leads.length])

  function scrollStatusTabs(direction: 'left' | 'right') {
    const tabs = statusTabsRef.current
    if (!tabs) return

    tabs.scrollBy({
      left: (direction === 'right' ? 1 : -1) * tabs.clientWidth * 0.7,
      behavior: 'smooth',
    })
  }

  function getFollowUpLabel(lead: SavedLeadState) {
    if (!lead.nextFollowUp) return 'Definir próximo contato'
    const date = toLocalDate(lead.nextFollowUp)
    const today = getToday()
    if (date < today) return `Contato atrasado · ${formatFollowUpDate(lead.nextFollowUp)}`
    if (isSameDay(date, today)) return 'Contato hoje'
    return `Próximo contato · ${formatFollowUpDate(lead.nextFollowUp)}`
  }

  function handleExport() {
    if (exportableLeads.length === 0) return

    exportLeadsCsv(exportableLeads)
    const unavailableCount = visibleLeads.length - exportableLeads.length
    setExportFeedback(
      unavailableCount > 0
        ? `${exportableLeads.length} lead(s) exportado(s); ${unavailableCount} indisponível(is).`
        : `${exportableLeads.length} lead(s) exportado(s).`,
    )
    window.setTimeout(() => setExportFeedback(''), 3_000)
  }

  return (
    <section className="saved-leads-page">
      <header className="page-header saved-leads-header">
        <div>
          <span className="eyebrow">ACOMPANHAMENTO</span>
          <h1>Meus leads</h1>
          <p>Continue suas conversas e acompanhe os próximos contatos.</p>
        </div>
      </header>

      {status === 'ready' && leads.length > 0 && (
        <section className="follow-up-agenda panel" aria-labelledby="agenda-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">PRIORIDADE</span>
              <h2 id="agenda-title">O que pede atenção agora</h2>
            </div>
            <CalendarClock className="section-muted-icon" size={19} aria-hidden="true" />
          </div>
          <div className="lead-priority-summary">
            <span><strong>{agendaLeads.filter((lead) => toLocalDate(lead.nextFollowUp!) < getToday()).length}</strong> atrasado(s)</span>
            <span><strong>{unscheduledCount}</strong> sem próximo contato</span>
          </div>
          {attentionLeads.length > 0 ? (
            <div className="follow-up-agenda-list">
              {attentionLeads.map((lead) => {
              const isOverdue = toLocalDate(lead.nextFollowUp!) < getToday()
              return (
                <button
                  className="agenda-lead"
                  key={lead.leadId}
                  type="button"
                  onClick={() => void openLead(lead.leadId)}
                >
                  <span className={isOverdue ? 'agenda-date overdue' : 'agenda-date'}>
                    {getFollowUpLabel(lead)}
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
          ) : (
            <p className="agenda-empty">Nenhum contato agendado para os próximos dias.</p>
          )}
        </section>
      )}

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
      {status === 'ready' && leads.length === 0 && (
        <div className="data-state">
          <p>Salve uma empresa pela ficha para começar seu acompanhamento.</p>
          <button className="primary-button" type="button" onClick={onSearch}>
            Buscar oportunidades
          </button>
        </div>
      )}
      {status === 'ready' && leads.length > 0 && (
        <section className="saved-leads-directory panel" aria-labelledby="lead-directory-title">
          <header className="saved-leads-directory-heading">
            <div>
              <span className="eyebrow">CARTEIRA</span>
              <div className="saved-leads-title-row">
                <h2 id="lead-directory-title">Todos os leads</h2>
                <p role="status">{visibleLeads.length} de {leads.length} lead(s)</p>
              </div>
            </div>
            <div className="saved-leads-directory-actions">
              <details className="saved-leads-filters">
                <summary>
                  <CalendarClock size={16} aria-hidden="true" />
                  {followUpFilter === 'Todos' ? 'Agendamento' : followUpFilter}
                  <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <div className="saved-leads-filter-options" role="group" aria-label="Filtrar por próximo contato">
                  {['Todos', 'Hoje', 'Atrasados', 'Próximos 7 dias', 'Sem agendamento'].map((option) => (
                    <button
                      className={followUpFilter === option ? 'active' : ''}
                      type="button"
                      key={option}
                      onClick={(event) => {
                        setFollowUpFilter(option)
                        event.currentTarget.closest('details')?.removeAttribute('open')
                      }}
                    >
                      <span>{option === 'Todos' ? 'Todos os agendamentos' : option}</span>
                      {followUpFilter === option && <Check size={15} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </details>
              <button
                className="saved-leads-export"
                type="button"
                onClick={handleExport}
                disabled={exportableLeads.length === 0}
                title="Baixar leads em CSV"
              >
                <Download size={16} aria-hidden="true" />
                Exportar CSV
              </button>
            </div>
          </header>

          {exportFeedback && <p className="saved-leads-export-feedback" role="status">{exportFeedback}</p>}

          <div className="portfolio-controls">
            <label><span>Buscar na carteira</span><input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Empresa, segmento ou pessoa de contato" /></label>
            <label><span>Ordenar por</span><AppSelect
              value={sortOrder}
              ariaLabel="Ordenar leads por"
              onValueChange={setSortOrder}
              options={[
                { value: 'followUp', label: 'Próximo contato' },
                { value: 'recent', label: 'Atualização recente' },
                { value: 'name', label: 'Nome da empresa' },
              ]}
            /></label>
          </div>
          <div className="lead-status-tabs-shell">
            <div className="lead-status-tabs" role="group" aria-label="Filtrar por status" ref={statusTabsRef}>
              {['Todos', ...statuses].map((item) => (
                <button
                  className={statusFilter === item ? 'active' : ''}
                  type="button"
                  key={item}
                  aria-pressed={statusFilter === item}
                  onClick={(event) => {
                    setStatusFilter(item)
                    event.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
                  }}
                >
                  {item}
                  <span>{item === 'Todos' ? leads.length : (statusCounts.get(item as LeadStatus) ?? 0)}</span>
                </button>
              ))}
            </div>
            {statusTabsOverflow.right && (
              <button
                className="status-scroll-cue next"
                type="button"
                aria-label="Ver próximos status"
                onClick={() => scrollStatusTabs('right')}
              >
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            )}
            {statusTabsOverflow.left && (
              <button
                className="status-scroll-cue previous"
                type="button"
                aria-label="Ver status anteriores"
                onClick={() => scrollStatusTabs('left')}
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="saved-leads-bulk-toolbar">
            <label className="saved-leads-select-all">
              <input
                ref={selectVisibleRef}
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisibleLeads}
                disabled={visibleLeadIds.length === 0 || visibleSelectionExceedsLimit || bulkBusy !== null}
              />
              <span>Selecionar todos os leads visíveis</span>
            </label>
            <span className="saved-leads-selection-count" role="status" aria-live="polite">
              {selectedVisibleCount} de {MAX_BULK_LEAD_IDS} selecionado(s)
            </span>
            <p className="saved-leads-bulk-limit">
              Cada operação aceita até {MAX_BULK_LEAD_IDS} leads. {visibleSelectionExceedsLimit
                ? `Há ${visibleLeadIds.length} leads visíveis; marque até ${MAX_BULK_LEAD_IDS} linhas ou use filtros para dividir em grupos.`
                : `Use os filtros para dividir listas maiores em grupos de até ${MAX_BULK_LEAD_IDS}.`}
            </p>
            <div className="saved-leads-bulk-actions">
              <label className="saved-leads-bulk-status">
                <span>Novo status</span>
                <AppSelect
                  ariaLabel="Novo status para leads selecionados"
                  value={bulkStatus}
                  onValueChange={(value) => setBulkStatus(value as LeadStatus)}
                  disabled={selectedVisibleCount === 0 || bulkBusy !== null}
                  size="compact"
                  options={statuses.map((item) => ({ value: item, label: item }))}
                />
              </label>
              <button
                className="saved-leads-bulk-update"
                type="button"
                onClick={() => void updateSelectedLeadsStatus()}
                disabled={selectedVisibleCount === 0 || bulkBusy !== null}
              >
                {bulkBusy === 'status' ? 'Atualizando…' : 'Aplicar status'}
              </button>
              <button
                className="saved-leads-bulk-delete"
                type="button"
                onClick={() => {
                  setBulkDeleteConfirmation(true)
                  setBulkError('')
                  setBulkFeedback('')
                }}
                disabled={selectedVisibleCount === 0 || bulkBusy !== null}
              >
                <Trash2 size={15} aria-hidden="true" />
                Excluir selecionados
              </button>
            </div>
          </div>

          {bulkDeleteConfirmation && selectedVisibleCount > 0 && (
            <div className="saved-leads-bulk-confirm" role="group" aria-label="Confirmar exclusão em lote">
              <div className="saved-leads-bulk-confirm-copy">
                <p>Excluir {selectedVisibleCount} lead(s) selecionado(s)? Esta ação não pode ser desfeita.</p>
                <p>A exclusão também remove da fila de prospecção do WhatsApp os registros associados, inclusive envios já registrados. Mensagens, conversas e vendas serão preservadas.</p>
              </div>
              <button
                className="saved-lead-delete-confirm"
                type="button"
                onClick={() => void removeSelectedLeads()}
                disabled={bulkBusy !== null}
              >
                {bulkBusy === 'delete' ? 'Excluindo…' : 'Confirmar exclusão'}
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => setBulkDeleteConfirmation(false)}
                disabled={bulkBusy !== null}
              >
                Cancelar
              </button>
            </div>
          )}
          {bulkFeedback && <p className="saved-leads-bulk-feedback" role="status">{bulkFeedback}</p>}
          {bulkError && <p className="saved-leads-bulk-error" role="alert">{bulkError}</p>}

          {visibleLeads.length === 0 ? (
            <p className="saved-leads-table-empty">Nenhum lead corresponde aos filtros selecionados.</p>
          ) : (
            <div className="saved-leads-table">
              <div className="saved-leads-table-header" aria-hidden="true">
                <span />
                <span>Empresa</span>
                <span>Status</span>
                <span>Próximo contato</span>
                <span>Ações</span>
              </div>
              <div className="saved-leads-list">
                {visibleLeads.map((lead) => {
                  const cachedLead = cachedLeadById.get(lead.leadId)
                  return (
                    <section
                      className="saved-lead-row"
                      key={lead.leadId}
                      aria-label={`Lead ${getLeadName(lead)}`}
                      onClick={(event) => {
                        const interactiveTarget = (event.target as HTMLElement).closest(
                          'button, input, select, .saved-lead-remove-confirm, .saved-lead-error',
                        )

                        if (
                          interactiveTarget
                          || openingLeadId === lead.leadId
                          || removingLeadId === lead.leadId
                        ) {
                          return
                        }

                        void openLead(lead.leadId)
                      }}
                    >
                      <input
                        className="saved-lead-select"
                        type="checkbox"
                        aria-label={`Selecionar ${getLeadName(lead)}`}
                        checked={selectedLeadIds.has(lead.leadId)}
                        onChange={() => toggleVisibleLead(lead.leadId)}
                        disabled={bulkBusy !== null || removingLeadId === lead.leadId || (!selectedLeadIds.has(lead.leadId) && selectedVisibleCount >= MAX_BULK_LEAD_IDS)}
                      />
                      <button
                        className="saved-lead-company"
                        type="button"
                        onClick={() => void openLead(lead.leadId)}
                        disabled={openingLeadId === lead.leadId || removingLeadId === lead.leadId}
                      >
                        <strong>{getLeadName(lead)}</strong>
                        <small>{lead.nextAction || cachedLead?.category || lead.notes?.trim() || 'Segmento não informado'}</small>
                      </button>
                      <span className="saved-lead-status">{lead.status}</span>
                      <span className={lead.nextFollowUp && toLocalDate(lead.nextFollowUp) < getToday() ? 'saved-lead-follow-up overdue' : 'saved-lead-follow-up'}>
                        {getFollowUpLabel(lead)}
                      </span>
                      <div className="saved-lead-actions">
                        <button
                          className="saved-lead-delete"
                          type="button"
                          aria-label={`Excluir ${getLeadName(lead)}`}
                          title="Excluir lead"
                          onClick={() => setPendingRemovalLeadId(lead.leadId)}
                          disabled={openingLeadId === lead.leadId || removingLeadId === lead.leadId}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                      {openingErrorLeadId === lead.leadId && (
                        <p className="saved-lead-error" role="alert">{openingError}</p>
                      )}
                      {pendingRemovalLeadId === lead.leadId && (
                        <div className="saved-lead-remove-confirm">
                          <span>Excluir este lead salvo?</span>
                          <button
                            className="saved-lead-delete-confirm"
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
                      )}
                    </section>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      )}
    </section>
  )
}
