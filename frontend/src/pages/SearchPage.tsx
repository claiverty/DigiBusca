import { useEffect, useMemo, useRef, useState } from 'react'
import { LeadCard } from '../components/LeadCard'
import { OpportunityTabs, opportunityFilters } from '../components/OpportunityTabs'
import { ResultsHeader } from '../components/ResultsHeader'
import { SearchPanel, type SearchLocation } from '../components/SearchPanel'
import { searchLeads } from '../services/leadsService'
import type { Lead } from '../types'
import './SearchPage.css'

type SearchPageProps = { onSelectLead: (lead: Lead) => void }

type SearchStatus = 'idle' | 'loading' | 'success' | 'error'
type SearchQuery = { city: string; segment: string }
type SearchCache = {
  countryCode: string
  stateCode: string
  city: string
  segment: string
  activeFilter: (typeof opportunityFilters)[number]
  leads: Lead[]
  total: number
  status: SearchStatus
  searchedLocation: string
  lastQuery: SearchQuery | null
}

const searchCacheKey = 'digibusca:lead-search'

const defaultSearchCache: SearchCache = {
  countryCode: 'BR',
  stateCode: '',
  city: '',
  segment: '',
  activeFilter: 'Todos',
  leads: [],
  total: 0,
  status: 'idle',
  searchedLocation: '',
  lastQuery: null,
}

function getSearchCache(): SearchCache {
  try {
    const saved = window.sessionStorage.getItem(searchCacheKey)
    if (!saved) return defaultSearchCache

    const parsed = JSON.parse(saved) as Partial<SearchCache>
    const hasValidResults = parsed.status === 'success' && Array.isArray(parsed.leads)

    return {
      ...defaultSearchCache,
      countryCode: typeof parsed.countryCode === 'string' ? parsed.countryCode : 'BR',
      stateCode: typeof parsed.stateCode === 'string' ? parsed.stateCode : '',
      city: typeof parsed.city === 'string' ? parsed.city : '',
      segment: typeof parsed.segment === 'string' ? parsed.segment : '',
      activeFilter: opportunityFilters.includes(parsed.activeFilter ?? 'Todos')
        ? (parsed.activeFilter ?? 'Todos')
        : 'Todos',
      leads: hasValidResults ? (parsed.leads ?? []) : [],
      total: hasValidResults && typeof parsed.total === 'number' ? parsed.total : 0,
      status: hasValidResults ? 'success' : 'idle',
      searchedLocation:
        hasValidResults && typeof parsed.searchedLocation === 'string' ? parsed.searchedLocation : '',
      lastQuery:
        parsed.lastQuery &&
        typeof parsed.lastQuery.city === 'string' &&
        typeof parsed.lastQuery.segment === 'string'
          ? parsed.lastQuery
          : null,
    }
  } catch {
    return defaultSearchCache
  }
}

export function SearchPage({ onSelectLead }: SearchPageProps) {
  const [searchCache, setSearchCache] = useState<SearchCache>(getSearchCache)
  const [errorMessage, setErrorMessage] = useState('')
  const lastQuery = useRef<SearchQuery | null>(searchCache.lastQuery)
  const requestId = useRef(0)
  const inFlight = useRef(false)
  const { countryCode, stateCode, city, segment, activeFilter, leads, total, status, searchedLocation } =
    searchCache

  useEffect(() => {
    window.sessionStorage.setItem(
      searchCacheKey,
      JSON.stringify({ ...searchCache, lastQuery: lastQuery.current }),
    )
  }, [searchCache])

  function updateSearchCache(changes: Partial<SearchCache>) {
    setSearchCache((current) => ({ ...current, ...changes }))
  }

  async function loadLeads(location?: SearchLocation) {
    if (inFlight.current) return
    const query = location
      ? {
          city: [location.cityName, location.stateName, location.countryName]
            .filter(Boolean)
            .join(', '),
          segment,
        }
      : lastQuery.current
    if (!query?.segment) return
    lastQuery.current = query
    const currentRequest = ++requestId.current
    inFlight.current = true

    updateSearchCache({ status: 'loading', searchedLocation: query.city, total: 0 })
    setErrorMessage('')

    try {
      const response = await searchLeads(query)
      if (currentRequest !== requestId.current) return
      updateSearchCache({ leads: response.data, total: response.meta.total, status: 'success' })
    } catch (error) {
      if (currentRequest !== requestId.current) return
      updateSearchCache({ status: 'error' })
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível buscar os leads.')
    } finally {
      inFlight.current = false
    }
  }

  function handleCountryChange(nextCountryCode: string) {
    requestId.current += 1
    updateSearchCache({
      countryCode: nextCountryCode,
      stateCode: '',
      city: '',
      status: 'idle',
      searchedLocation: '',
    })
  }

  function handleStateChange(nextStateCode: string) {
    requestId.current += 1
    updateSearchCache({ stateCode: nextStateCode, city: '', status: 'idle', searchedLocation: '' })
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
        isSearching={status === 'loading'}
        onCountryChange={handleCountryChange}
        onStateChange={handleStateChange}
        onCityChange={(nextCity) =>
          updateSearchCache({ city: nextCity, status: 'idle', searchedLocation: '' })
        }
        onSegmentChange={(nextSegment) =>
          updateSearchCache({ segment: nextSegment, status: 'idle', searchedLocation: '' })
        }
        onSearch={(location) => void loadLeads(location)}
      />
      {status !== 'idle' && <ResultsHeader city={searchedLocation} total={total} />}
      {status !== 'idle' && (
        <OpportunityTabs
          activeFilter={activeFilter}
          onFilterChange={(nextFilter) => updateSearchCache({ activeFilter: nextFilter })}
        />
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
