import { useCallback, useEffect, useMemo, useState } from 'react'
import { LeadCard } from '../components/LeadCard'
import { OpportunityTabs, opportunityFilters } from '../components/OpportunityTabs'
import { ResultsHeader } from '../components/ResultsHeader'
import { SearchPanel } from '../components/SearchPanel'
import { searchLeads } from '../services/leadsService'
import type { Lead } from '../types'
import './SearchPage.css'

type SearchPageProps = { onSelectLead: (lead: Lead) => void }

export function SearchPage({ onSelectLead }: SearchPageProps) {
  const [city, setCity] = useState('Formosa, Goiás')
  const [segment, setSegment] = useState('Todos os segmentos')
  const [activeFilter, setActiveFilter] = useState<(typeof opportunityFilters)[number]>('Todos')
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState('')

  const loadLeads = useCallback(async () => {
    setStatus('loading')
    setErrorMessage('')

    try {
      const response = await searchLeads({ city, segment })
      setLeads(response.data)
      setTotal(response.meta.total)
      setStatus('success')
    } catch (error) {
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível buscar os leads.')
    }
  }, [city, segment])

  useEffect(() => {
    void loadLeads()
  }, [])

  const visibleLeads = useMemo(
    () =>
      activeFilter === 'Todos' ? leads : leads.filter((lead) => lead.opportunity === activeFilter),
    [activeFilter, leads],
  )

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">BUSCAR OPORTUNIDADES</span>
          <h1>Encontre empresas que precisam de você.</h1>
          <p>
            Pesquise uma região e encontre negócios com espaço para melhorar sua presença digital.
          </p>
        </div>
        <div className="avatar" aria-label="Conta do usuário">
          C
        </div>
      </header>

      <SearchPanel
        city={city}
        segment={segment}
        onCityChange={setCity}
        onSegmentChange={setSegment}
        onSearch={() => void loadLeads()}
      />
      <ResultsHeader city={city} total={total} />
      <OpportunityTabs activeFilter={activeFilter} onFilterChange={setActiveFilter} />

      <section className="lead-list" aria-label="Lista de leads">
        {status === 'loading' && <div className="data-state">Buscando oportunidades...</div>}
        {status === 'error' && (
          <div className="data-state" role="alert">
            <p>{errorMessage}</p>
            <button className="secondary-button" type="button" onClick={() => void loadLeads()}>
              Tentar novamente
            </button>
          </div>
        )}
        {status === 'success' && visibleLeads.length === 0 && (
          <div className="data-state">Nenhuma oportunidade encontrada para esses filtros.</div>
        )}
        {status === 'success' &&
          visibleLeads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onSelect={onSelectLead} />
          ))}
      </section>
    </>
  )
}
