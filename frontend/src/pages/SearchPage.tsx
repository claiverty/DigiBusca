import { useCallback, useMemo, useState } from 'react'
import { LeadCard } from '../components/LeadCard'
import { OpportunityTabs, opportunityFilters } from '../components/OpportunityTabs'
import { ResultsHeader } from '../components/ResultsHeader'
import { SearchPanel, type SearchLocation } from '../components/SearchPanel'
import { searchLeads } from '../services/leadsService'
import type { Lead } from '../types'
import './SearchPage.css'

type SearchPageProps = { onSelectLead: (lead: Lead) => void }

export function SearchPage({ onSelectLead }: SearchPageProps) {
  const [countryCode, setCountryCode] = useState('BR')
  const [stateCode, setStateCode] = useState('')
  const [city, setCity] = useState('')
  const [segment, setSegment] = useState('')
  const [activeFilter, setActiveFilter] = useState<(typeof opportunityFilters)[number]>('Todos')
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [searchedLocation, setSearchedLocation] = useState('')

  const loadLeads = useCallback(async (location?: SearchLocation) => {
    if (!location || !segment) {
      setStatus('idle')
      setLeads([])
      setTotal(0)
      return
    }

    const locationQuery = [location.cityName, location.stateName, location.countryName]
      .filter(Boolean)
      .join(', ')

    setStatus('loading')
    setErrorMessage('')

    try {
      const response = await searchLeads({ city: locationQuery, segment })
      setLeads(response.data)
      setTotal(response.meta.total)
      setSearchedLocation(locationQuery)
      setStatus('success')
    } catch (error) {
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível buscar os leads.')
    }
  }, [segment])

  function handleCountryChange(nextCountryCode: string) {
    setCountryCode(nextCountryCode)
    setStateCode('')
    setCity('')
    setStatus('idle')
    setSearchedLocation('')
  }

  function handleStateChange(nextStateCode: string) {
    setStateCode(nextStateCode)
    setCity('')
    setStatus('idle')
    setSearchedLocation('')
  }

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
        countryCode={countryCode}
        stateCode={stateCode}
        city={city}
        segment={segment}
        onCountryChange={handleCountryChange}
        onStateChange={handleStateChange}
        onCityChange={setCity}
        onSegmentChange={setSegment}
        onSearch={(location) => void loadLeads(location)}
      />
      {status !== 'idle' && <ResultsHeader city={searchedLocation} total={total} />}
      {status !== 'idle' && (
        <OpportunityTabs activeFilter={activeFilter} onFilterChange={setActiveFilter} />
      )}

      <section className="lead-list" aria-label="Lista de leads">
        {status === 'idle' && (
          <div className="data-state">Informe uma cidade e escolha um segmento para começar.</div>
        )}
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
      {status === 'success' && (
        <p className="places-attribution" translate="no">
          Dados de lugares: Google Maps
        </p>
      )}
    </>
  )
}
