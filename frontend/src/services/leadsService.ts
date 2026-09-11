import type { Lead, LeadUpdate, OpportunityType, SearchLeadsResponse } from '../types'
import type { CreateLeadInteractionInput, LeadInteraction } from '../types/interactions'
import type { CreateSaleInput, Sale } from '../types/sales'
import { supabase } from '../lib/supabase'

type SearchLeadsParams = {
  city: string
  segment: string
  opportunity?: OpportunityType
  pageToken?: string
}

export type SavedLeadState = {
  leadId: string
  lead?: Omit<Lead, 'status' | 'notes' | 'nextFollowUp' | 'draftMessage'>
  status: Lead['status']
  notes?: string
  nextFollowUp?: string
  draftMessage?: string
  updatedAt: string
}

export type GoogleApiUsage = {
  requestsToday: number
  requestsThisMonth: number
  textSearchRequests: number
  placeDetailsRequests: number
  historicalRequests: number
  monthlyLimit: number
}

export type SiteHealthResult = {
  status: 'healthy' | 'insecure' | 'not_found' | 'http_error' | 'unreachable'
  statusCode?: number
  checkedAt: string
}

export type OutreachTone = 'Profissional' | 'Direto' | 'Informal'

export type GenerateOutreachInput = {
  businessName: string
  category: string
  websiteStatus: 'listed' | 'not_listed'
  googleProfileStatus: 'complete' | 'incomplete'
  service: string
  tone: OutreachTone
}

export type LeadAnalysis = {
  leadType: 'NO_WEBSITE' | 'INCOMPLETE_GOOGLE_PROFILE' | 'NO_CLEAR_OPPORTUNITY'
  primaryOpportunity: 'website' | 'google_profile' | 'general_outreach'
  secondaryOpportunities: Array<'website' | 'google_profile' | 'general_outreach'>
  confidence: 'high' | 'medium' | 'low'
  evidence: string[]
}

export type GeneratedOutreach = {
  salesArgument: string
  whatsappMessage: string
  followUpMessage: string
  analysis: LeadAnalysis
  generationSource: 'ai' | 'safe_template'
  cacheHit?: boolean
}

const apiBaseUrl = import.meta.env.PROD ? '/api' : (import.meta.env.VITE_API_URL ?? '/api')
const outreachCacheVersion = 'v1'
const outreachCacheTtlMs = 60 * 60 * 1_000
const maxCachedOutreaches = 50

type OutreachCacheEntry = {
  key: string
  cachedAt: number
  data: GeneratedOutreach
}

function buildOutreachCacheKey(input: GenerateOutreachInput) {
  return JSON.stringify({
    version: outreachCacheVersion,
    businessName: input.businessName.trim().toLocaleLowerCase('pt-BR'),
    category: input.category.trim().toLocaleLowerCase('pt-BR'),
    websiteStatus: input.websiteStatus,
    googleProfileStatus: input.googleProfileStatus,
    service: input.service.trim().toLocaleLowerCase('pt-BR'),
    tone: input.tone,
  })
}

function isGeneratedOutreach(value: unknown): value is GeneratedOutreach {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<GeneratedOutreach>
  return (
    typeof candidate.whatsappMessage === 'string' &&
    typeof candidate.followUpMessage === 'string' &&
    typeof candidate.salesArgument === 'string' &&
    typeof candidate.analysis === 'object' &&
    candidate.analysis !== null &&
    (candidate.generationSource === 'ai' || candidate.generationSource === 'safe_template')
  )
}

async function getOutreachCacheStorageKey() {
  if (!supabase || typeof localStorage === 'undefined') return undefined
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id
    ? `digibusca:ai-outreach:${outreachCacheVersion}:${data.session.user.id}`
    : undefined
}

async function readOutreachCache(): Promise<{ storageKey?: string; entries: OutreachCacheEntry[] }> {
  const storageKey = await getOutreachCacheStorageKey()
  if (!storageKey) return { entries: [] }

  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return { storageKey, entries: [] }
    const oldestAllowed = Date.now() - outreachCacheTtlMs
    const entries = parsed.filter((entry): entry is OutreachCacheEntry => {
      if (typeof entry !== 'object' || entry === null) return false
      const candidate = entry as Partial<OutreachCacheEntry>
      return (
        typeof candidate.key === 'string' &&
        typeof candidate.cachedAt === 'number' &&
        candidate.cachedAt > oldestAllowed &&
        isGeneratedOutreach(candidate.data)
      )
    })
    return { storageKey, entries }
  } catch {
    return { storageKey, entries: [] }
  }
}

export async function getCachedAiOutreach(
  input: GenerateOutreachInput,
): Promise<GeneratedOutreach | undefined> {
  const { storageKey, entries } = await readOutreachCache()
  if (storageKey) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(entries))
    } catch {
      // The cache is optional; generation continues if browser storage is unavailable.
    }
  }
  const cached = entries.find((entry) => entry.key === buildOutreachCacheKey(input))
  return cached ? { ...cached.data, cacheHit: true } : undefined
}

async function cacheAiOutreach(input: GenerateOutreachInput, data: GeneratedOutreach) {
  const { storageKey, entries } = await readOutreachCache()
  if (!storageKey) return

  const key = buildOutreachCacheKey(input)
  const nextEntries = [
    { key, cachedAt: Date.now(), data: { ...data, cacheHit: undefined } },
    ...entries.filter((entry) => entry.key !== key),
  ].slice(0, maxCachedOutreaches)
  try {
    localStorage.setItem(storageKey, JSON.stringify(nextEntries))
  } catch {
    // The cache is optional; never fail a successful generation because of browser storage.
  }
}

export async function authenticatedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!supabase) {
    throw new Error('O Supabase ainda não está configurado.')
  }

  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) {
    throw new Error('Sua sessão expirou. Faça login novamente.')
  }

  const requestWithSession = (accessToken: string) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${accessToken}`)
    return fetch(input, { ...init, headers })
  }

  const response = await requestWithSession(data.session.access_token)

  if (response.status !== 401) {
    return response
  }

  const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError || !refreshedData.session) {
    throw new Error('Sua sessão expirou. Faça login novamente.')
  }

  return requestWithSession(refreshedData.session.access_token)
}

export async function searchLeads({
  city,
  segment,
  opportunity,
  pageToken,
}: SearchLeadsParams): Promise<SearchLeadsResponse> {
  const params = new URLSearchParams({
    city,
    segment,
    ...(opportunity ? { opportunity } : {}),
    ...(pageToken ? { pageToken } : {}),
  })
  const response = await authenticatedFetch(`${apiBaseUrl}/leads?${params.toString()}`)

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível buscar os leads.')
  }

  return response.json() as Promise<SearchLeadsResponse>
}

export async function getSavedLeads(): Promise<SavedLeadState[]> {
  const response = await authenticatedFetch(`${apiBaseUrl}/saved-leads`)

  if (!response.ok) {
    throw new Error('Não foi possível carregar os leads salvos.')
  }

  const payload = (await response.json()) as { data: SavedLeadState[] }
  return payload.data
}

export async function getSavedLead(leadId: string): Promise<Lead> {
  const response = await authenticatedFetch(`${apiBaseUrl}/saved-leads/${encodeURIComponent(leadId)}`)

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível abrir este lead.')
  }

  const payload = (await response.json()) as { data: Lead }
  return payload.data
}

export async function getSavedLeadIds(): Promise<string[]> {
  const response = await authenticatedFetch(`${apiBaseUrl}/saved-lead-ids`)

  if (!response.ok) {
    throw new Error('Não foi possível carregar seus leads salvos.')
  }

  const payload = (await response.json()) as { data: SavedLeadState[] }
  return payload.data.map((lead) => lead.leadId)
}

export async function getSiteHealth(url: string): Promise<SiteHealthResult> {
  const response = await authenticatedFetch(`${apiBaseUrl}/site-health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível verificar o site.')
  }

  const payload = (await response.json()) as { data: SiteHealthResult }
  return payload.data
}

function mergeSavedLeadState(lead: Lead, state: SavedLeadState): Lead {
  const { leadId: _leadId, ...changes } = state
  return { ...lead, ...changes }
}

export async function saveLead(lead: Lead): Promise<Lead> {
  const response = await authenticatedFetch(`${apiBaseUrl}/leads/${encodeURIComponent(lead.id)}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lead: {
        id: lead.id,
        name: lead.name,
        category: lead.category,
        address: lead.address,
        phone: lead.phone,
        rating: lead.rating,
        reviews: lead.reviews,
        ...(lead.website ? { website: lead.website } : {}),
        ...(lead.googleMapsUri ? { googleMapsUri: lead.googleMapsUri } : {}),
        source: lead.source,
        retrievedAt: lead.retrievedAt,
        opportunity: lead.opportunity,
        score: lead.score,
        diagnosis: lead.diagnosis,
      },
    }),
  })

  if (!response.ok) {
    throw new Error('Não foi possível salvar este lead.')
  }

  const payload = (await response.json()) as { data: SavedLeadState }
  return mergeSavedLeadState(lead, payload.data)
}

export async function removeSavedLead(leadId: string): Promise<void> {
  const response = await authenticatedFetch(`${apiBaseUrl}/leads/${encodeURIComponent(leadId)}/save`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error('Não foi possível remover este lead dos salvos.')
  }
}

export async function updateLead(lead: Lead, changes: LeadUpdate): Promise<Lead> {
  const response = await authenticatedFetch(`${apiBaseUrl}/leads/${encodeURIComponent(lead.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível atualizar este lead.')
  }

  const payload = (await response.json()) as { data: SavedLeadState }
  return mergeSavedLeadState(lead, payload.data)
}

export async function getLeadInteractions(leadId: string): Promise<LeadInteraction[]> {
  const response = await authenticatedFetch(`${apiBaseUrl}/leads/${encodeURIComponent(leadId)}/interactions`)

  if (!response.ok) {
    throw new Error('Não foi possível carregar o histórico de interações.')
  }

  const payload = (await response.json()) as { data: LeadInteraction[] }
  return payload.data
}

export async function createLeadInteraction(
  leadId: string,
  input: CreateLeadInteractionInput,
): Promise<LeadInteraction> {
  const response = await authenticatedFetch(`${apiBaseUrl}/leads/${encodeURIComponent(leadId)}/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível registrar a interação.')
  }

  const payload = (await response.json()) as { data: LeadInteraction }
  return payload.data
}

export async function getSales(): Promise<Sale[]> {
  const response = await authenticatedFetch(`${apiBaseUrl}/sales`)

  if (!response.ok) {
    throw new Error('Não foi possível carregar o histórico financeiro.')
  }

  const payload = (await response.json()) as { data: Sale[] }
  return payload.data
}

export async function getGoogleApiUsage(): Promise<GoogleApiUsage> {
  const response = await authenticatedFetch(`${apiBaseUrl}/google-api-usage`)

  if (!response.ok) {
    throw new Error('Não foi possível carregar o contador de uso do Google.')
  }

  const payload = (await response.json()) as { data: GoogleApiUsage }
  return payload.data
}

export async function createSale(input: CreateSaleInput): Promise<Sale> {
  const response = await authenticatedFetch(`${apiBaseUrl}/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível registrar a venda.')
  }

  const payload = (await response.json()) as { data: Sale }
  return payload.data
}

export async function generateAiOutreach(input: GenerateOutreachInput): Promise<GeneratedOutreach> {
  const cached = await getCachedAiOutreach(input)
  if (cached) return cached

  const response = await authenticatedFetch(`${apiBaseUrl}/ai/outreach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível gerar a abordagem agora.')
  }

  const payload = (await response.json()) as { data: GeneratedOutreach }
  await cacheAiOutreach(input, payload.data)
  return { ...payload.data, cacheHit: false }
}

export type { Lead }
