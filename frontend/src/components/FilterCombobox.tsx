import { ChevronDown, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import './FilterCombobox.css'

type FilterComboboxProps = {
  id: string
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('pt-BR')
}

export function FilterCombobox({
  id,
  label,
  value,
  options,
  onChange,
}: FilterComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState(value)

  useEffect(() => {
    setQuery(value)
  }, [value])

  const suggestions = useMemo(() => {
    const normalizedQuery = normalize(query)
    if (normalize(query) === normalize(value)) {
      return options
    }

    return options.filter((option) => !normalizedQuery || normalize(option).startsWith(normalizedQuery))
  }, [options, query, value])

  function selectOption(option: string) {
    onChange(option)
    setQuery(option)
    setIsOpen(false)
  }

  return (
    <div className="filter-combobox">
      <input
        id={id}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          window.setTimeout(() => {
            setIsOpen(false)
            setQuery(value)
          }, 120)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setIsOpen(false)
            setQuery(value)
          }

          if (event.key === 'Enter' && suggestions[0]) {
            event.preventDefault()
            selectOption(suggestions[0])
          }
        }}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-controls={`${id}-suggestions`}
        aria-expanded={isOpen}
        autoComplete="off"
      />
      {value !== options[0] && (
        <button
          className="filter-combobox-clear"
          type="button"
          aria-label={`Limpar filtro de ${label}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            selectOption(options[0])
            setIsOpen(true)
          }}
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
      <button
        className="filter-combobox-toggle"
        type="button"
        aria-label={`Mostrar opções de ${label}`}
        aria-expanded={isOpen}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setIsOpen((current) => !current)}
      >
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      {isOpen && (
        <div id={`${id}-suggestions`} className="filter-combobox-suggestions" role="listbox">
          {suggestions.length ? (
            suggestions.map((option) => (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={option === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
              >
                {option}
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
