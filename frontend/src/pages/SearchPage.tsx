import { useMemo, useState } from 'react'
import { LeadCard } from '../components/LeadCard'
import { OpportunityTabs, opportunityFilters } from '../components/OpportunityTabs'
import { ResultsHeader } from '../components/ResultsHeader'
import { SearchPanel } from '../components/SearchPanel'
import { mockLeads } from '../data/mockLeads'
import type { Lead } from '../types'
import './SearchPage.css'

type SearchPageProps = { onSelectLead: (lead: Lead) => void }

export function SearchPage({ onSelectLead }: SearchPageProps) {
  const [city, setCity] = useState('Formosa, Goiás')
  const [segment, setSegment] = useState('Todos os segmentos')
  const [activeFilter, setActiveFilter] = useState<(typeof opportunityFilters)[number]>('Todos')

  const leads = useMemo(
    () => activeFilter === 'Todos' ? mockLeads : mockLeads.filter((lead) => lead.opportunity === activeFilter),
    [activeFilter],
  )

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">BUSCAR OPORTUNIDADES</span>
          <h1>Encontre empresas que precisam de você.</h1>
          <p>Pesquise uma região e encontre negócios com espaço para melhorar sua presença digital.</p>
        </div>
        <div className="avatar" aria-label="Conta do usuário">C</div>
      </header>

      <SearchPanel city={city} segment={segment} onCityChange={setCity} onSegmentChange={setSegment} />
      <ResultsHeader city={city} />
      <OpportunityTabs activeFilter={activeFilter} onFilterChange={setActiveFilter} />

      <section className="lead-list" aria-label="Lista de leads">
        {leads.map((lead) => <LeadCard key={lead.id} lead={lead} onSelect={onSelectLead} />)}
      </section>
    </>
  )
}
