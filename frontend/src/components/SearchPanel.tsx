import { ChevronDown, Search, X } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { getCities, getCountries, getStates } from '../services/locationsService'
import type { OpportunityType } from '../types'
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
  opportunity: '' | OpportunityType
  isSearching?: boolean
  onCountryChange: (countryCode: string) => void
  onStateChange: (stateCode: string) => void
  onCityChange: (city: string) => void
  onSegmentChange: (segment: string) => void
  onOpportunityChange: (opportunity: '' | OpportunityType) => void
  onSearch: (location: SearchLocation) => void
}

const segments = [
  'Todos os segmentos',
  'Restaurantes, padarias e lanchonetes',
  'Clínicas e consultórios',
  'Dentistas e clínicas odontológicas',
  'Salões e barbearias',
  'Estética e bem-estar',
  'Oficinas e serviços automotivos',
  'Lojas e comércio local',
  'Academias e estúdios',
  'Pet shops e veterinárias',
  'Imobiliárias e corretores',
  'Escolas e cursos',
  'Contabilidade e advocacia',
  'Serviços residenciais',
]

const opportunityOptions: Array<{ value: '' | OpportunityType; label: string }> = [
  { value: '', label: 'Prioridade: todos os perfis' },
  { value: 'Sem site', label: 'Prioridade: somente sem site' },
  { value: 'Site identificado', label: 'Prioridade: negócios com site' },
]

function normalizeLocation(value: string) {
  return value.trim().toLocaleLowerCase('pt-BR')
}

function stateLabel(state: LocationState) {
  return `${state.code} - ${state.name}`
}

const portugueseRegionNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' })

function countryLabel(country: LocationCountry) {
  return portugueseRegionNames.of(country.code) ?? country.name
}

function matchesCountry(country: LocationCountry, value: string) {
  const query = normalizeLocation(value)
  return [country.code, countryLabel(country)].some(
    (name) => normalizeLocation(name) === query,
  )
}

type LocationOption = { value: string; label: string; searchTerms?: string[] }

type LocationComboboxProps = {
  id: string
  value: string
  options: LocationOption[]
  placeholder: string
  ariaLabel: string
  disabled?: boolean
  invalid?: boolean
  leadingIcon?: ReactNode
  className?: string
  onValueChange: (value: string) => void
  onClear: () => void
  onSelect: (option: LocationOption) => void
}

function LocationCombobox({
  id,
  value,
  options,
  placeholder,
  ariaLabel,
  disabled = false,
  invalid = false,
  leadingIcon,
  className = '',
  onValueChange,
  onClear,
  onSelect,
}: LocationComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const suggestions = useMemo(() => {
    const query = normalizeLocation(value)
    return options
      .filter(
        (option) =>
          !query ||
          [option.label, option.value, ...(option.searchTerms ?? [])].some((term) =>
            normalizeLocation(term).includes(query),
          ),
      )
  }, [options, value])

  function chooseOption(option: LocationOption) {
    onSelect(option)
    setIsOpen(false)
  }

  return (
    <div className={`location-combobox ${className}`}>
      {leadingIcon && <span className="location-combobox-icon">{leadingIcon}</span>}
      <input
        id={id}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setIsOpen(false)
          }

          if (event.key === 'Enter' && suggestions[0]) {
            event.preventDefault()
            chooseOption(suggestions[0])
          }
        }}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={`${id}-suggestions`}
        aria-expanded={isOpen}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {value && !disabled && (
        <button
          className="location-clear-button"
          type="button"
          aria-label={`Limpar ${ariaLabel}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onClear()
            setIsOpen(true)
          }}
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
      <button
        className="location-toggle-button"
        type="button"
        aria-label={`Mostrar sugestões de ${ariaLabel}`}
        aria-expanded={isOpen}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setIsOpen((current) => !current)}
      >
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      {isOpen && !disabled && (
        <div id={`${id}-suggestions`} className="location-suggestions" role="listbox">
          {suggestions.length ? (
            suggestions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={normalizeLocation(option.value) === normalizeLocation(value)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseOption(option)}
              >
                {option.label}
              </button>
            ))
          ) : (
            <span>Nenhuma opção encontrada</span>
          )}
        </div>
      )}
    </div>
  )
}

export function SearchPanel({
  countryCode,
  stateCode,
  city,
  segment,
  opportunity,
  isSearching = false,
  onCountryChange,
  onStateChange,
  onCityChange,
  onSegmentChange,
  onOpportunityChange,
  onSearch,
}: SearchPanelProps) {
  const [countries, setCountries] = useState<LocationCountry[]>([])
  const [states, setStates] = useState<LocationState[]>([])
  const [cities, setCities] = useState<LocationCity[]>([])
  const [countryInput, setCountryInput] = useState('')
  const [stateInput, setStateInput] = useState('')
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
  const isFederalDistrict = countryCode === 'BR' && stateCode === 'DF'
  const matchingCountry = countries.find((country) => matchesCountry(country, countryInput))
  const matchingState = states.find((state) => {
    const value = normalizeLocation(stateInput)
    return (
      value === normalizeLocation(state.name) ||
      value === normalizeLocation(state.code) ||
      value === normalizeLocation(stateLabel(state))
    )
  })
  const matchingCity = cities.find(
    (availableCity) => normalizeLocation(availableCity.name) === normalizeLocation(city),
  )
  const hasValidCountry = matchingCountry?.code === countryCode
  const hasValidState = !hasStates || matchingState?.code === stateCode
  const countryOptions = countries.map((country) => ({
    value: country.code,
    label: countryLabel(country),
  })).sort((first, second) => first.label.localeCompare(second.label, 'pt-BR'))
  const stateOptions = states.map((state) => ({ value: stateLabel(state), label: stateLabel(state) }))
  const cityOptions = cities.map((availableCity) => ({
    value: availableCity.name,
    label: availableCity.name,
  }))

  useEffect(() => {
    if (selectedCountry) {
      setCountryInput(countryLabel(selectedCountry))
    }
  }, [countryCode, selectedCountry])

  useEffect(() => {
    setStateInput(selectedState ? stateLabel(selectedState) : '')
  }, [selectedState, stateCode])

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
    if (
      !matchingCountry ||
      !matchingCity ||
      !segment ||
      !hasValidCountry ||
      !hasValidState
    ) {
      return
    }

    onSearch({
      countryCode: matchingCountry.code,
      countryName: matchingCountry.name,
      ...(matchingState
        ? { stateCode: matchingState.code, stateName: matchingState.name }
        : {}),
      cityName: matchingCity.name,
    })
  }

  return (
    <section className="search-panel" aria-label="Configurar busca">
      <span className="search-label">Onde você quer prospectar?</span>
      <LocationCombobox
        id="country"
        value={countryInput}
        options={countryOptions}
        placeholder={countries.length ? 'Digite ou escolha um país' : 'Carregando países...'}
        ariaLabel="País"
        className="location-country"
        invalid={countries.length ? !hasValidCountry : false}
        disabled={!countries.length}
        onValueChange={(nextValue) => {
          setCountryInput(nextValue)
        }}
        onClear={() => {
          setCountryInput('')
          onStateChange('')
          onCityChange('')
        }}
        onSelect={(option) => {
          const nextCountry = countries.find((country) => country.code === option.value)
          if (!nextCountry) return
          setCountryInput(countryLabel(nextCountry))
          if (nextCountry.code !== countryCode) {
            onCountryChange(nextCountry.code)
          }
        }}
      />
      <LocationCombobox
        id="state"
        value={stateInput}
        options={stateOptions}
        placeholder={
          isLoadingStates
            ? 'Carregando estados...'
            : hasStates
              ? 'Digite ou escolha um estado'
              : 'Sem estado ou província'
        }
        ariaLabel="Estado ou província"
        invalid={statesReady && hasStates ? !hasValidState : false}
        disabled={isLoadingStates || !hasStates || !hasValidCountry}
        onValueChange={(nextValue) => {
          setStateInput(nextValue)
        }}
        onClear={() => {
          setStateInput('')
          onStateChange('')
          onCityChange('')
        }}
        onSelect={(option) => {
          const nextState = states.find((state) => stateLabel(state) === option.value)
          if (!nextState) return
          setStateInput(stateLabel(nextState))
          if (nextState.code !== stateCode) {
            onStateChange(nextState.code)
          }
        }}
      />
      <LocationCombobox
        id="city"
        value={city}
        options={cityOptions}
        leadingIcon={<Search size={18} aria-hidden="true" />}
        placeholder={
          isLoadingCities
            ? 'Carregando cidades...'
            : cities.length
              ? isFederalDistrict
                ? 'Digite ou escolha uma região'
                : 'Digite ou escolha uma cidade'
              : 'Escolha país e estado primeiro'
        }
        ariaLabel={isFederalDistrict ? 'Região administrativa' : 'Cidade'}
        invalid={cities.length ? !matchingCity : false}
        disabled={!statesReady || !hasValidCountry || !hasValidState || !cities.length || isLoadingCities}
        onValueChange={onCityChange}
        onClear={() => onCityChange('')}
        onSelect={(option) => onCityChange(option.value)}
      />
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
      <select
        value={opportunity}
        onChange={(event) => onOpportunityChange(event.target.value as '' | OpportunityType)}
        aria-label="Prioridade da busca"
      >
        {opportunityOptions.map((option) => (
          <option key={option.label} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        className="primary-button search-button"
        type="button"
        onClick={handleSearch}
        disabled={
          isSearching ||
          hasLocationError ||
          !hasValidCountry ||
          !matchingCity ||
          !segment ||
          !hasValidState ||
          isLoadingCities
        }
      >
        <Search size={17} aria-hidden="true" />
        {isSearching ? 'Buscando...' : 'Buscar oportunidades'}
      </button>
      {hasLocationError && (
        <span className="search-location-error" role="alert">
          Não foi possível carregar as localidades. Tente atualizar a página.
        </span>
      )}
    </section>
  )
}
