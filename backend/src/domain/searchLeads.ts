import type { Lead, SearchLeadsQuery } from '../contracts/lead.js'

const normalize = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

export function searchLeads(leads: Lead[], query: SearchLeadsQuery): Lead[] {
  const city = normalize(query.city)
  const segment = normalize(query.segment ?? '')
  const cityName = city.split(',')[0]?.trim() ?? city
  const segmentTerms = segment
    .split(/,|\se\s/)
    .map((term) => term.trim())
    .filter((term) => term.length > 3)

  return leads.filter((lead) => {
    const normalizedCategory = normalize(lead.category)
    const matchesCity = normalize(lead.address).includes(cityName)
    const matchesSegment =
      !segment ||
      segment === 'todos os segmentos' ||
      segmentTerms.some(
        (term) => normalizedCategory.includes(term) || term.includes(normalizedCategory),
      )

    return matchesCity && matchesSegment
  })
}
