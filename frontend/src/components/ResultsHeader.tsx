import { SlidersHorizontal } from 'lucide-react'

type ResultsHeaderProps = { city: string }

export function ResultsHeader({ city }: ResultsHeaderProps) {
  return (
    <section className="results-header" aria-labelledby="results-title">
      <div>
        <span className="eyebrow">RESULTADOS DA BUSCA</span>
        <h2 id="results-title">24 oportunidades em {city}</h2>
        <p className="results-note">15 sem site · 8 com alta oportunidade · atualizado nesta busca</p>
      </div>
      <button className="filter-button" type="button">
        <SlidersHorizontal size={16} aria-hidden="true" />
        Filtros
      </button>
    </section>
  )
}
