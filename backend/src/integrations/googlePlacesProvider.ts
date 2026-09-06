import type { Lead, LeadUpdate, SearchLeadsQuery } from '../contracts/lead.js'
import type { LeadProvider } from '../application/searchLeads.js'
import { getGoogleMapsApiKey } from '../config/supabase.js'

const searchTextUrl = 'https://places.googleapis.com/v1/places:searchText'
const requestTimeoutMs = 10 * 1000
const placeFields = [
  'places.id',
  'places.displayName',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'places.websiteUri',
  'places.googleMapsUri',
]
const searchFieldMask = [...placeFields, 'nextPageToken'].join(',')
const detailsFieldMask = placeFields.map((field) => field.replace('places.', '')).join(',')

type GooglePlace = {
  id?: string
  displayName?: { text?: string }
  primaryType?: string
  primaryTypeDisplayName?: { text?: string }
  formattedAddress?: string
  nationalPhoneNumber?: string
  internationalPhoneNumber?: string
  rating?: number
  userRatingCount?: number
  websiteUri?: string
  googleMapsUri?: string
}

type GooglePlacesResponse = {
  places?: GooglePlace[]
  nextPageToken?: string
}

function isAllSegments(segment: string | undefined): boolean {
  return !segment || segment.trim().toLocaleLowerCase('pt-BR') === 'todos os segmentos'
}

function buildTextQuery(query: SearchLeadsQuery): string {
  const segment = isAllSegments(query.segment) ? 'negócios locais' : query.segment
  return `${segment} em ${query.city}`.trim()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function getOpportunity(place: GooglePlace): Lead['opportunity'] {
  if (!place.websiteUri) {
    return 'Sem site'
  }

  if (!place.internationalPhoneNumber && !place.nationalPhoneNumber) {
    return 'Perfil incompleto'
  }

  return 'Site identificado'
}

function getScore(place: GooglePlace, opportunity: Lead['opportunity']): number {
  const ratingScore = clamp(Math.round(((place.rating ?? 0) / 5) * 40), 0, 40)
  const reviewScore = clamp(Math.round(Math.log10((place.userRatingCount ?? 0) + 1) * 15), 0, 30)
  const opportunityScore = opportunity === 'Sem site' ? 30 : opportunity === 'Perfil incompleto' ? 20 : 10

  return clamp(ratingScore + reviewScore + opportunityScore, 0, 100)
}

function getDiagnosis(place: GooglePlace, opportunity: Lead['opportunity']): string {
  if (opportunity === 'Sem site') {
    return 'O negócio aparece no Google, mas não apresenta um site nos dados públicos consultados.'
  }

  if (opportunity === 'Perfil incompleto') {
    return 'O negócio tem presença no Google, mas faltam dados públicos importantes para apresentar melhor a empresa online.'
  }

  return 'O negócio já possui um site informado. Vale avaliar se a experiência atual comunica bem a oferta e facilita novos contatos.'
}

function mapPlace(place: GooglePlace): Lead | undefined {
  if (!place.id || !place.displayName?.text) {
    return undefined
  }

  const opportunity = getOpportunity(place)

  return {
    id: place.id,
    name: place.displayName.text,
    category: place.primaryTypeDisplayName?.text ?? place.primaryType ?? 'Negócio local',
    address: place.formattedAddress ?? 'Endereço não informado',
    phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? 'Telefone não informado',
    rating: place.rating ?? 0,
    reviews: place.userRatingCount ?? 0,
    ...(place.websiteUri ? { website: place.websiteUri } : {}),
    ...(place.googleMapsUri ? { googleMapsUri: place.googleMapsUri } : {}),
    source: 'Google Maps',
    retrievedAt: new Date().toISOString(),
    opportunity,
    score: getScore(place, opportunity),
    diagnosis: getDiagnosis(place, opportunity),
    status: 'Novo',
  }
}

export class GooglePlacesProvider implements LeadProvider {
  private readonly apiKey: string | undefined

  constructor(apiKey = getGoogleMapsApiKey()) {
    this.apiKey = apiKey?.trim() || undefined
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey)
  }

  async search(query: SearchLeadsQuery) {
    if (!this.apiKey) {
      throw new Error(
        'A busca real ainda não está configurada. Adicione GOOGLE_MAPS_API_KEY ao .env do backend.',
      )
    }

    const body: Record<string, unknown> = {
      textQuery: buildTextQuery(query),
      pageSize: 20,
      ...(query.pageToken ? { pageToken: query.pageToken } : {}),
    }

    if (query.languageCode) {
      body.languageCode = query.languageCode
    }

    if (query.regionCode) {
      body.regionCode = query.regionCode.toUpperCase()
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)

    let response: Response

    try {
      response = await fetch(searchTextUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': searchFieldMask,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Google Places demorou para responder. Tente novamente em instantes.')
      }

      throw new Error('Não foi possível conectar ao Google Places agora.')
    } finally {
      clearTimeout(timeout)
    }

    const payload = (await response.json().catch(() => null)) as
      | (GooglePlacesResponse & { error?: { message?: string } })
      | null

    if (!response.ok) {
      const message = payload?.error?.message ?? 'O Google Places não conseguiu concluir a busca.'
      throw new Error(`Google Places: ${message}`)
    }

    const leads = (payload?.places ?? []).map(mapPlace).filter((lead): lead is Lead => Boolean(lead))

    return {
      leads: leads.sort((left, right) => right.score - left.score),
      ...(payload?.nextPageToken ? { nextPageToken: payload.nextPageToken } : {}),
    }
  }

  async findById(id: string): Promise<Lead | undefined> {
    if (!this.apiKey) {
      throw new Error(
        'A busca real ainda não está configurada. Adicione GOOGLE_MAPS_API_KEY ao .env do backend.',
      )
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    let response: Response

    try {
      response = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`,
        {
          headers: {
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': detailsFieldMask,
          },
          signal: controller.signal,
        },
      )
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Google Places demorou para responder. Tente novamente em instantes.')
      }

      throw new Error('Não foi possível conectar ao Google Places agora.')
    } finally {
      clearTimeout(timeout)
    }

    const payload = (await response.json().catch(() => null)) as
      | (GooglePlace & { error?: { message?: string } })
      | null

    if (response.status === 404) {
      return undefined
    }

    if (!response.ok) {
      const message = payload?.error?.message ?? 'O Google Places não encontrou este negócio.'
      throw new Error(`Google Places: ${message}`)
    }

    return payload ? mapPlace(payload) : undefined
  }

  async update(id: string, changes: Partial<LeadUpdate>): Promise<Lead | undefined> {
    const lead = await this.findById(id)

    if (!lead) {
      return undefined
    }

    return { ...lead, ...changes }
  }
}
