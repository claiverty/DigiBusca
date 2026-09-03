import type { OpportunityType } from '../types'
import './OpportunityTabs.css'

export const opportunityFilters: Array<'Todos' | OpportunityType> = [
  'Todos',
  'Sem site',
  'Site desatualizado',
  'Perfil incompleto',
]

type OpportunityTabsProps = {
  activeFilter: (typeof opportunityFilters)[number]
  onFilterChange: (filter: (typeof opportunityFilters)[number]) => void
}

export function OpportunityTabs({ activeFilter, onFilterChange }: OpportunityTabsProps) {
  return (
    <div className="filter-tabs" role="tablist" aria-label="Filtrar oportunidades">
      {opportunityFilters.map((filter) => (
        <button
          key={filter}
          className={activeFilter === filter ? 'selected' : ''}
          onClick={() => onFilterChange(filter)}
          type="button"
          role="tab"
          aria-selected={activeFilter === filter}
        >
          {filter}
        </button>
      ))}
    </div>
  )
}
