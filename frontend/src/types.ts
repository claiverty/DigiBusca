export type OpportunityType = 'Sem site' | 'Site identificado' | 'Perfil incompleto'
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
  conversationStage?: string
  contactName?: string
  nextAction?: string
  draftMessage?: string
  whatsappConsentStatus?: 'unknown' | 'opted_in' | 'opted_out'
  whatsappConsentSource?: string
  whatsappConsentAt?: string
}

export type LeadUpdate = Pick<Lead, 'status' | 'notes' | 'nextFollowUp' | 'draftMessage' | 'conversationStage' | 'contactName' | 'nextAction' | 'whatsappConsentStatus' | 'whatsappConsentSource' | 'whatsappConsentAt'>

export type SearchLeadsResponse = {
  data: Lead[]
  meta: {
    total: number
    city: string
    segment: string
    monthlyLimitReached?: boolean
    nextPageToken?: string
  }
}
