import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { LeadCard } from '../components/LeadCard'
import { ResultsHeader } from '../components/ResultsHeader'
import { SearchPanel, type SearchLocation } from '../components/SearchPanel'
import { GoogleApiMonthlyLimitError, searchLeads } from '../services/leadsService'
import { hasContactPhone } from '../lib/phone'
import type { Lead, OpportunityType } from '../types'
import './SearchPage.css'

type SearchPageProps = { onSelectLead: (lead: Lead) => void; savedLeadIds?: Set<string> }

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

const sortOptions = [
  { value: 'score', label: 'Prioridade' },
  { value: 'reviews', label: 'Quantidade de avaliações' },
  { value: 'rating', label: 'Avaliação' },
] as const

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

export function SearchPage({ onSelectLead, savedLeadIds = new Set() }: SearchPageProps) {
  const [searchCache, setSearchCache] = useState<SearchCache>(getSearchCache)
  const [hideSaved, setHideSaved] = useState(false)
  const [onlyWithPhone, setOnlyWithPhone] = useState(false)
  const [sortOrder, setSortOrder] = useState<(typeof sortOptions)[number]['value']>('score')
  const [errorMessage, setErrorMessage] = useState('')
  const [loadMoreError, setLoadMoreError] = useState('')
  const [quotaNotice, setQuotaNotice] = useState('')
  const [isSearching, setIsSearching] = useState(false)
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
  const pageLeads = pages[currentPage - 1] ?? []
  const selectedSortLabel = sortOptions.find((option) => option.value === sortOrder)?.label ?? sortOptions[0].label
  const currentLeads = pageLeads.filter((lead) => (!hideSaved || !savedLeadIds.has(lead.id)) && (!onlyWithPhone || hasContactPhone(lead.phone))).sort((a, b) => sortOrder === 'reviews' ? b.reviews - a.reviews : sortOrder === 'rating' ? b.rating - a.rating : b.score - a.score)

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
    setIsSearching(true)

    updateSearchCache({
      status: 'loading',
      searchedLocation: query.city,
      pages: [],
      currentPage: 1,
      nextPageToken: undefined,
    })
    setErrorMessage('')
    setLoadMoreError('')
    setQuotaNotice('')

    try {
      const response = await searchLeads(query)
      if (currentRequest !== requestId.current) return
      updateSearchCache({
        pages: [response.data],
        currentPage: 1,
        status: 'success',
        nextPageToken: response.meta.nextPageToken,
      })
      if (response.meta.monthlyLimitReached) {
        setQuotaNotice('O limite mensal de consultas do Google foi atingido. Exibindo os resultados encontrados até agora.')
      }
    } catch (error) {
      if (currentRequest !== requestId.current) return
      updateSearchCache({ status: 'error' })
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível buscar os leads.')
    } finally {
      inFlight.current = false
      setIsSearching(false)
    }
  }

  async function loadNextPage() {
    const query = lastQuery.current
    if (!query || !nextPageToken || inFlight.current) return

    const currentRequest = ++requestId.current
    inFlight.current = true
    setIsSearching(true)
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
      if (response.meta.monthlyLimitReached) {
        setQuotaNotice('O limite mensal de consultas do Google foi atingido. Exibindo os resultados encontrados até agora.')
      }
      scrollToResults()
    } catch (error) {
      if (currentRequest !== requestId.current) return
      if (error instanceof GoogleApiMonthlyLimitError) {
        updateSearchCache({ nextPageToken: undefined })
        setQuotaNotice(error.message)
      } else {
        setLoadMoreError(
          error instanceof Error ? error.message : 'Não foi possível carregar mais oportunidades.',
        )
      }
    } finally {
      inFlight.current = false
      setIsSearching(false)
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
        isSearching={isSearching}
        onCountryChange={handleCountryChange}
        onStateChange={handleStateChange}
        onCityChange={(nextCity) => { requestId.current += 1; updateSearchCache({ city: nextCity, status: 'idle', searchedLocation: '' }) }}
        onSegmentChange={(nextSegment) => { requestId.current += 1; updateSearchCache({ segment: nextSegment, status: 'idle', searchedLocation: '' }) }}
        onOpportunityChange={(nextOpportunity) => {
          requestId.current += 1
          updateSearchCache({
            opportunity: nextOpportunity,
            status: 'idle',
            searchedLocation: '',
          })
        }}
        onSearch={(location) => void loadLeads(location)}
      />
      {status !== 'idle' && (
        <>
          <ResultsHeader city={searchedLocation} total={currentLeads.length} />
          {status === 'success' && <div className="search-result-controls">
            <label className="search-result-filter">
              <input type="checkbox" checked={hideSaved} onChange={(event) => setHideSaved(event.target.checked)} />
              <span>Ocultar leads já salvos</span>
            </label>
            <label className="search-result-filter">
              <input type="checkbox" checked={onlyWithPhone} onChange={(event) => setOnlyWithPhone(event.target.checked)} />
              <span>Somente com telefone</span>
            </label>
            <div className="search-result-sort">
              <span className="search-result-sort-label">Ordenar esta página</span>
              <details className="search-result-sort-menu">
                <summary aria-label={`Ordenar esta página: ${selectedSortLabel}`}>
                  <span>{selectedSortLabel}</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <div className="search-result-sort-options" role="group" aria-label="Opções de ordenação">
                  {sortOptions.map((option) => (
                    <button
                      className={sortOrder === option.value ? 'active' : ''}
                      type="button"
                      key={option.value}
                      aria-pressed={sortOrder === option.value}
                      onClick={(event) => {
                        setSortOrder(option.value)
                        event.currentTarget.closest('details')?.removeAttribute('open')
                      }}
                    >
                      <span>{option.label}</span>
                      {sortOrder === option.value && <Check size={15} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </details>
            </div>
          </div>}
          <section ref={leadListRef} className="lead-list" aria-label="Lista de leads">
            {status === 'loading' && <div className="data-state">Buscando oportunidades...</div>}
            {status === 'error' && (
              <div className="data-state" role="alert">
                <p>{errorMessage}</p>
                {!errorMessage.includes('limite mensal de consultas do Google') && (
                  <button className="secondary-button" type="button" onClick={() => void loadLeads()}>
                    Tentar novamente
                  </button>
                )}
              </div>
            )}
            {status === 'success' && currentLeads.length === 0 && (
              <div className="data-state"><p>Nenhuma oportunidade nesta página com os filtros atuais.</p><p>Remova um filtro, escolha outro segmento ou continue para a próxima página, se disponível.</p>{(hideSaved || onlyWithPhone) && <button className="secondary-button" type="button" onClick={() => { setHideSaved(false); setOnlyWithPhone(false) }}>Limpar filtros dos resultados</button>}</div>
            )}
            {status === 'success' &&
              currentLeads.map((lead) => (
                <LeadCard key={lead.id} lead={lead} isSaved={savedLeadIds.has(lead.id)} onSelect={onSelectLead} />
              ))}
          </section>
        </>
      )}
      {status === 'success' && (pages.length > 1 || pageLeads.length > 0 || nextPageToken) && (
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
      {status === 'success' && quotaNotice && (
        <p className="search-quota-notice" role="status">{quotaNotice}</p>
      )}
      {status === 'success' && (
        <p className="places-attribution" translate="no">
          Dados de lugares: Google Maps
        </p>
      )}
    </>
  )
}
