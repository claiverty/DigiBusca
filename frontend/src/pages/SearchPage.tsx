import { useEffect, useRef, useState } from 'react'
import { LeadCard } from '../components/LeadCard'
import { ResultsHeader } from '../components/ResultsHeader'
import { SearchPanel, type SearchLocation } from '../components/SearchPanel'
import { searchLeads } from '../services/leadsService'
import type { Lead, OpportunityType } from '../types'
import './SearchPage.css'

type SearchPageProps = { onSelectLead: (lead: Lead) => void }

type SearchStatus = 'idle' | 'loading' | 'success' | 'error'
type SearchQuery = { city: string; segment: string; opportunity?: OpportunityType }
type SearchCache = {
  countryCode: string
  stateCode: string
  city: string
  segment: string
  opportunity: '' | OpportunityType
  pages: Lead[][]
  currentPage: number
  status: SearchStatus
  searchedLocation: string
  lastQuery: SearchQuery | null
  nextPageToken?: string
}

const searchCacheKey = 'digibusca:lead-search'

const defaultSearchCache: SearchCache = {
  countryCode: 'BR',
  stateCode: '',
  city: '',
  segment: '',
  opportunity: '',
  pages: [],
  currentPage: 1,
  status: 'idle',
  searchedLocation: '',
  lastQuery: null,
}

function getSearchCache(): SearchCache {
  try {
    const saved = window.sessionStorage.getItem(searchCacheKey)
    if (!saved) return defaultSearchCache

    const parsed = JSON.parse(saved) as Partial<SearchCache> & { leads?: Lead[] }
    const pages = Array.isArray(parsed.pages)
      ? parsed.pages.filter((page): page is Lead[] => Array.isArray(page))
      : Array.isArray(parsed.leads)
        ? [parsed.leads]
        : []
    const hasValidResults = parsed.status === 'success' && pages.length > 0

    return {
      ...defaultSearchCache,
      countryCode: typeof parsed.countryCode === 'string' ? parsed.countryCode : 'BR',
      stateCode: typeof parsed.stateCode === 'string' ? parsed.stateCode : '',
      city: typeof parsed.city === 'string' ? parsed.city : '',
      segment: typeof parsed.segment === 'string' ? parsed.segment : '',
      opportunity:
        parsed.opportunity === 'Sem site' ||
        parsed.opportunity === 'Perfil incompleto' ||
        parsed.opportunity === 'Site identificado'
          ? parsed.opportunity
          : '',
      pages: hasValidResults ? pages : [],
      currentPage:
        hasValidResults &&
        typeof parsed.currentPage === 'number' &&
        parsed.currentPage >= 1 &&
        parsed.currentPage <= pages.length
          ? parsed.currentPage
          : 1,
      status: hasValidResults ? 'success' : 'idle',
      searchedLocation:
        hasValidResults && typeof parsed.searchedLocation === 'string' ? parsed.searchedLocation : '',
      lastQuery:
        parsed.lastQuery &&
        typeof parsed.lastQuery.city === 'string' &&
        typeof parsed.lastQuery.segment === 'string'
          ? {
              city: parsed.lastQuery.city,
              segment: parsed.lastQuery.segment,
              ...(parsed.lastQuery.opportunity === 'Sem site' ||
              parsed.lastQuery.opportunity === 'Perfil incompleto' ||
              parsed.lastQuery.opportunity === 'Site identificado'
                ? { opportunity: parsed.lastQuery.opportunity }
                : {}),
            }
          : null,
      nextPageToken: typeof parsed.nextPageToken === 'string' ? parsed.nextPageToken : undefined,
    }
  } catch {
    return defaultSearchCache
  }
}

export function SearchPage({ onSelectLead }: SearchPageProps) {
  const [searchCache, setSearchCache] = useState<SearchCache>(getSearchCache)
  const [errorMessage, setErrorMessage] = useState('')
  const [loadMoreError, setLoadMoreError] = useState('')
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const lastQuery = useRef<SearchQuery | null>(searchCache.lastQuery)
  const requestId = useRef(0)
  const inFlight = useRef(false)
  const leadListRef = useRef<HTMLElement>(null)
  const {
    countryCode,
    stateCode,
    city,
    segment,
    opportunity,
    pages,
    currentPage,
    status,
    searchedLocation,
    nextPageToken,
  } = searchCache
  const currentLeads = pages[currentPage - 1] ?? []

  useEffect(() => {
    window.sessionStorage.setItem(
      searchCacheKey,
      JSON.stringify({ ...searchCache, lastQuery: lastQuery.current }),
    )
  }, [searchCache])

  function updateSearchCache(changes: Partial<SearchCache>) {
    setSearchCache((current) => ({ ...current, ...changes }))
  }

  function scrollToResults() {
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'

    window.requestAnimationFrame(() => {
      leadListRef.current?.scrollIntoView({ behavior, block: 'start' })
    })
  }

  function selectPage(page: number) {
    if (page === currentPage) return
    updateSearchCache({ currentPage: page })
    scrollToResults()
  }

  async function loadLeads(location?: SearchLocation) {
    if (inFlight.current) return
    const query = location
      ? {
          city: [location.cityName, location.stateName, location.countryName]
            .filter(Boolean)
            .join(', '),
          segment,
          ...(opportunity ? { opportunity } : {}),
        }
      : lastQuery.current
    if (!query?.segment) return
    lastQuery.current = query
    const currentRequest = ++requestId.current
    inFlight.current = true

    updateSearchCache({
      status: 'loading',
      searchedLocation: query.city,
      pages: [],
      currentPage: 1,
      nextPageToken: undefined,
    })
    setErrorMessage('')
    setLoadMoreError('')

    try {
      const response = await searchLeads(query)
      if (currentRequest !== requestId.current) return
      updateSearchCache({
        pages: [response.data],
        currentPage: 1,
        status: 'success',
        nextPageToken: response.meta.nextPageToken,
      })
    } catch (error) {
      if (currentRequest !== requestId.current) return
      updateSearchCache({ status: 'error' })
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível buscar os leads.')
    } finally {
      inFlight.current = false
    }
  }

  async function loadNextPage() {
    const query = lastQuery.current
    if (!query || !nextPageToken || inFlight.current) return

    const currentRequest = ++requestId.current
    inFlight.current = true
    setIsLoadingMore(true)
    setLoadMoreError('')

    try {
      const response = await searchLeads({ ...query, pageToken: nextPageToken })
      if (currentRequest !== requestId.current) return

      setSearchCache((current) => {
        const knownLeadIds = new Set(current.pages.flatMap((page) => page.map((lead) => lead.id)))
        const additionalLeads = response.data.filter((lead) => !knownLeadIds.has(lead.id))
        const pages = [...current.pages, additionalLeads]

        return {
          ...current,
          pages,
          currentPage: pages.length,
          nextPageToken: response.meta.nextPageToken,
        }
      })
      scrollToResults()
    } catch (error) {
      if (currentRequest !== requestId.current) return
      setLoadMoreError(
        error instanceof Error ? error.message : 'Não foi possível carregar mais oportunidades.',
      )
    } finally {
      inFlight.current = false
      setIsLoadingMore(false)
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
      </header>

      <SearchPanel
        countryCode={countryCode}
        stateCode={stateCode}
        city={city}
        segment={segment}
        opportunity={opportunity}
        isSearching={status === 'loading'}
        onCountryChange={handleCountryChange}
        onStateChange={handleStateChange}
        onCityChange={(nextCity) =>
          updateSearchCache({ city: nextCity, status: 'idle', searchedLocation: '' })
        }
        onSegmentChange={(nextSegment) =>
          updateSearchCache({ segment: nextSegment, status: 'idle', searchedLocation: '' })
        }
        onOpportunityChange={(nextOpportunity) =>
          updateSearchCache({
            opportunity: nextOpportunity,
            status: 'idle',
            searchedLocation: '',
          })
        }
        onSearch={(location) => void loadLeads(location)}
      />
      {status !== 'idle' && <ResultsHeader city={searchedLocation} total={currentLeads.length} />}
      <section ref={leadListRef} className="lead-list" aria-label="Lista de leads">
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
        {status === 'success' && currentLeads.length === 0 && (
          <div className="data-state">Nenhuma oportunidade encontrada para esses filtros.</div>
        )}
      {status === 'success' &&
          currentLeads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onSelect={onSelectLead} />
          ))}
      </section>
      {status === 'success' && currentLeads.length > 0 && (
        <nav className="search-pagination" aria-label="Páginas de resultados">
          <button
            className="secondary-button"
            type="button"
            onClick={() => selectPage(currentPage - 1)}
            disabled={currentPage === 1}
          >
            Anterior
          </button>
          <div className="pagination-pages">
            {pages.map((_, index) => {
              const page = index + 1
              return (
                <button
                  key={page}
                  className={page === currentPage ? 'selected' : ''}
                  type="button"
                  onClick={() => selectPage(page)}
                  aria-current={page === currentPage ? 'page' : undefined}
                  aria-label={`Página ${page}`}
                >
                  {page}
                </button>
              )
            })}
          </div>
          {nextPageToken ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => void loadNextPage()}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? 'Buscando...' : 'Próxima'}
            </button>
          ) : (
            <span className="pagination-complete">Última página</span>
          )}
          {loadMoreError && <span role="alert">{loadMoreError}</span>}
        </nav>
      )}
      {status === 'success' && (
        <p className="places-attribution" translate="no">
          Dados de lugares: Google Maps
        </p>
      )}
    </>
  )
}
