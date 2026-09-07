import { ChevronDown, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import './SaleServiceField.css'

const serviceOptions = [
  'Site institucional',
  'Landing page',
  'Loja virtual',
  'Identidade visual',
  'Gestão de tráfego',
  'Manutenção mensal',
]

type SaleServiceFieldProps = {
  value: string
  onChange: (value: string) => void
}

export function SaleServiceField({ value, onChange }: SaleServiceFieldProps) {
  const [isOpen, setIsOpen] = useState(false)
  const suggestions = useMemo(() => {
    const query = value.trim().toLocaleLowerCase('pt-BR')
    return serviceOptions.filter(
      (option) => !query || option.toLocaleLowerCase('pt-BR').startsWith(query),
    )
  }, [value])

  function selectOption(option: string) {
    onChange(option)
    setIsOpen(false)
  }

  return (
    <div className="service-combobox">
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setIsOpen(false)
          if (event.key === 'Enter') {
            event.preventDefault()
            if (suggestions[0]) {
              selectOption(suggestions[0])
            } else {
              setIsOpen(false)
            }
          }
        }}
        role="combobox"
        aria-label="O que foi vendido"
        aria-autocomplete="list"
        aria-controls="sale-service-suggestions"
        aria-expanded={isOpen}
        placeholder="Ex.: Site institucional"
        autoComplete="off"
      />
      {value && (
        <button
          className="service-combobox-clear"
          type="button"
          aria-label="Limpar serviço"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange('')
            setIsOpen(true)
          }}
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
      <button
        className="service-combobox-toggle"
        type="button"
        aria-label="Mostrar sugestões de serviço"
        aria-expanded={isOpen}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setIsOpen((current) => !current)}
      >
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      {isOpen && (
        <div id="sale-service-suggestions" className="service-suggestions" role="listbox">
          {suggestions.length ? (
            suggestions.map((option) => (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={option.toLocaleLowerCase('pt-BR') === value.trim().toLocaleLowerCase('pt-BR')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
              >
                {option}
              </button>
            ))
          ) : (
            <span>Pressione Enter para usar “{value}”.</span>
          )}
        </div>
      )}
    </div>
  )
}
