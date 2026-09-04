import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getCities, getCountries, getStates } from '../services/locationsService'
import type { LocationCity, LocationCountry, LocationState } from '../types/locations'
import './SearchPanel.css'

export type SearchLocation = {
  countryCode: string
  countryName: string
  stateCode?: string
  stateName?: string
  cityName: string
}

type SearchPanelProps = {
  countryCode: string
  stateCode: string
  city: string
  segment: string
  onCountryChange: (countryCode: string) => void
  onStateChange: (stateCode: string) => void
  onCityChange: (city: string) => void
  onSegmentChange: (segment: string) => void
  onSearch: (location: SearchLocation) => void
}

const segments = [
  'Todos os segmentos',
  'Restaurantes, padarias e lanchonetes',
  'Clínicas e consultórios',
  'Salões e barbearias',
  'Oficinas e serviços automotivos',
]

export function SearchPanel({
  countryCode,
  stateCode,
  city,
  segment,
  onCountryChange,
  onStateChange,
  onCityChange,
  onSegmentChange,
  onSearch,
}: SearchPanelProps) {
  const [countries, setCountries] = useState<LocationCountry[]>([])
  const [states, setStates] = useState<LocationState[]>([])
  const [cities, setCities] = useState<LocationCity[]>([])
  const [statesCountryCode, setStatesCountryCode] = useState('')
  const [isLoadingStates, setIsLoadingStates] = useState(false)
  const [isLoadingCities, setIsLoadingCities] = useState(false)
  const [hasLocationError, setHasLocationError] = useState(false)

  useEffect(() => {
    let isMounted = true

    void getCountries()
      .then((loadedCountries) => {
        if (isMounted) {
          setCountries(loadedCountries)
        }
      })
      .catch(() => {
        if (isMounted) {
          setHasLocationError(true)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    setStates([])
    setCities([])
    setStatesCountryCode('')
    setIsLoadingStates(true)
    setHasLocationError(false)

    void getStates(countryCode)
      .then((loadedStates) => {
        if (!isMounted) {
          return
        }

        setStates(loadedStates)
        setStatesCountryCode(countryCode)
      })
      .catch(() => {
        if (isMounted) {
          setHasLocationError(true)
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingStates(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [countryCode])

  const hasStates = states.length > 0
  const statesReady = statesCountryCode === countryCode
  const selectedCountry = countries.find((country) => country.code === countryCode)
  const selectedState = states.find((state) => state.code === stateCode)

  useEffect(() => {
    if (!statesReady || (hasStates && !stateCode)) {
      setCities([])
      setIsLoadingCities(false)
      return
    }

    let isMounted = true
    setCities([])
    setIsLoadingCities(true)

    void getCities(countryCode, stateCode || undefined)
      .then((loadedCities) => {
        if (isMounted) {
          setCities(loadedCities)
        }
      })
      .catch(() => {
        if (isMounted) {
          setHasLocationError(true)
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingCities(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [countryCode, hasStates, stateCode, statesReady])

  function handleSearch() {
    const selectedCity = cities.find((availableCity) => availableCity.name === city)

    if (!selectedCountry || !selectedCity || !segment || (hasStates && !selectedState)) {
      return
    }

    onSearch({
      countryCode: selectedCountry.code,
      countryName: selectedCountry.name,
      ...(selectedState
        ? { stateCode: selectedState.code, stateName: selectedState.name }
        : {}),
      cityName: selectedCity.name,
    })
  }

  return (
    <section className="search-panel" aria-label="Configurar busca">
      <span className="search-label">Onde você quer prospectar?</span>
      <select
        value={countryCode}
        onChange={(event) => onCountryChange(event.target.value)}
        aria-label="País"
        disabled={!countries.length}
      >
        {!countries.length && <option value={countryCode}>Carregando países...</option>}
        {countries.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name}
          </option>
        ))}
      </select>
      <select
        value={stateCode}
        onChange={(event) => onStateChange(event.target.value)}
        aria-label="Estado ou província"
        disabled={isLoadingStates || !hasStates}
      >
        <option value="">
          {isLoadingStates
            ? 'Carregando estados...'
            : hasStates
              ? 'Escolha um estado'
              : 'Sem estado ou província'}
        </option>
        {states.map((state) => (
          <option key={state.code} value={state.code}>
            {state.code} — {state.name}
          </option>
        ))}
      </select>
      <div className="search-input-wrap">
        <Search size={18} aria-hidden="true" />
        <select
          value={city}
          onChange={(event) => onCityChange(event.target.value)}
          aria-label="Cidade"
          disabled={!statesReady || !cities.length || isLoadingCities}
        >
          <option value="">
            {isLoadingCities
              ? 'Carregando cidades...'
              : cities.length
                ? 'Escolha uma cidade'
                : 'Escolha país e estado primeiro'}
          </option>
          {cities.map((availableCity) => (
            <option key={availableCity.name} value={availableCity.name}>
              {availableCity.name}
            </option>
          ))}
        </select>
      </div>
      <select
        value={segment}
        onChange={(event) => onSegmentChange(event.target.value)}
        aria-label="Segmento"
      >
        <option value="" disabled>
          Escolha um segmento
        </option>
        {segments.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <button
        className="primary-button search-button"
        type="button"
        onClick={handleSearch}
        disabled={
          hasLocationError ||
          !selectedCountry ||
          !city ||
          !segment ||
          (hasStates && !stateCode) ||
          isLoadingCities
        }
      >
        <Search size={17} aria-hidden="true" />
        Buscar oportunidades
      </button>
      {hasLocationError && (
        <span className="search-location-error" role="alert">
          Não foi possível carregar as localidades. Tente atualizar a página.
        </span>
      )}
    </section>
  )
}
