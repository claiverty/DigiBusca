export type OpportunityType = 'Sem site' | 'Site desatualizado' | 'Perfil incompleto'
export type LeadStatus = 'Novo' | 'Contatado' | 'Respondeu' | 'Proposta' | 'Ganhou' | 'Perdeu'

export type Lead = {
  id: string
  name: string
  category: string
  address: string
  phone: string
  rating: number
  reviews: number
  website?: string
  googleMapsUri?: string
  source: 'Google Maps'
  retrievedAt: string
  opportunity: OpportunityType
  score: number
  diagnosis: string
  status: LeadStatus
  notes?: string
  nextFollowUp?: string
  draftMessage?: string
}

export type LeadUpdate = Pick<Lead, 'status' | 'notes' | 'nextFollowUp' | 'draftMessage'>

export type SearchLeadsResponse = {
  data: Lead[]
  meta: {
    total: number
    city: string
    segment: string
    nextPageToken?: string
  }
}
