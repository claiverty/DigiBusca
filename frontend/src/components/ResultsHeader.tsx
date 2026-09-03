import { SlidersHorizontal } from 'lucide-react'

type ResultsHeaderProps = { city: string; total: number }

export function ResultsHeader({ city, total }: ResultsHeaderProps) {
  const opportunityLabel = total === 1 ? 'oportunidade' : 'oportunidades'

  return (
    <section className="results-header" aria-labelledby="results-title">
      <div>
        <span className="eyebrow">RESULTADOS DA BUSCA</span>
        <h2 id="results-title">
          {total} {opportunityLabel} em {city}
        </h2>
        <p className="results-note">Resultados disponíveis nesta busca</p>
      </div>
      <button className="filter-button" type="button">
        <SlidersHorizontal size={16} aria-hidden="true" />
        Filtros
      </button>
    </section>
  )
}
