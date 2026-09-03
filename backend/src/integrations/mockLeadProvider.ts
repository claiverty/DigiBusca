import type { Lead, LeadUpdate, SearchLeadsQuery } from '../contracts/lead.js'
import type { LeadProvider } from '../application/searchLeads.js'

export class MockLeadProvider implements LeadProvider {
  private readonly leadsById: Map<string, Lead>

  constructor(leads: Lead[]) {
    this.leadsById = new Map(leads.map((lead) => [lead.id, lead]))
  }

  async search(_query: SearchLeadsQuery): Promise<Lead[]> {
    return Array.from(this.leadsById.values())
  }

  async findById(id: string): Promise<Lead | undefined> {
    return this.leadsById.get(id)
  }

  async update(id: string, changes: Partial<LeadUpdate>): Promise<Lead | undefined> {
    const lead = this.leadsById.get(id)

    if (!lead) {
      return undefined
    }

    const updatedLead = { ...lead, ...changes }
    this.leadsById.set(id, updatedLead)
    return updatedLead
  }
}
