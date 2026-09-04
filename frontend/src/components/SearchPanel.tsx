import { Search } from 'lucide-react'
import './SearchPanel.css'

type SearchPanelProps = {
  city: string
  segment: string
  onCityChange: (city: string) => void
  onSegmentChange: (segment: string) => void
  onSearch: () => void
}

const segments = [
  'Todos os segmentos',
  'Restaurantes, padarias e lanchonetes',
  'Clínicas e consultórios',
  'Salões e barbearias',
  'Oficinas e serviços automotivos',
]

export function SearchPanel({
  city,
  segment,
  onCityChange,
  onSegmentChange,
  onSearch,
}: SearchPanelProps) {
  return (
    <section className="search-panel" aria-label="Configurar busca">
      <span className="search-label">Onde você quer prospectar?</span>
      <div className="search-input-wrap">
        <Search size={18} aria-hidden="true" />
        <input
          value={city}
          onChange={(event) => onCityChange(event.target.value)}
          aria-label="Cidade, região ou país"
          placeholder="Ex.: Lisboa, Portugal"
        />
      </div>
      <select
        value={segment}
        onChange={(event) => onSegmentChange(event.target.value)}
        aria-label="Segmento"
      >
        {segments.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
      <button className="primary-button search-button" type="button" onClick={onSearch}>
        <Search size={17} aria-hidden="true" />
        Buscar oportunidades
      </button>
    </section>
  )
}
