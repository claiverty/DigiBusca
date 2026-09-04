import type { Lead, SearchLeadsQuery } from '../contracts/lead.js'

export function searchLeads(leads: Lead[], _query: SearchLeadsQuery): Lead[] {
  // Location and segment filtering are performed by the external provider.
  // The domain keeps the result deterministic for the UI by ranking the opportunities.
  return [...leads].sort((left, right) => right.score - left.score)
}
