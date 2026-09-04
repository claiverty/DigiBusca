import type { LocationCity, LocationCountry, LocationState } from '../types/locations'
import { authenticatedFetch } from './leadsService'

const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001/api'

async function getLocationData<T>(path: string): Promise<T[]> {
  const response = await authenticatedFetch(`${apiBaseUrl}${path}`)

  if (!response.ok) {
    throw new Error('Não foi possível carregar as localidades.')
  }

  const payload = (await response.json()) as { data: T[] }
  return payload.data
}

export function getCountries() {
  return getLocationData<LocationCountry>('/locations/countries')
}

export function getStates(countryCode: string) {
  return getLocationData<LocationState>(`/locations/states?country=${encodeURIComponent(countryCode)}`)
}

export function getCities(countryCode: string, stateCode?: string) {
  const params = new URLSearchParams({ country: countryCode })
  if (stateCode) {
    params.set('state', stateCode)
  }

  return getLocationData<LocationCity>(`/locations/cities?${params.toString()}`)
}
