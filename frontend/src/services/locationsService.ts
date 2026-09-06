import type { LocationCity, LocationCountry, LocationState } from '../types/locations'

type CountryDatasetRow = { country: string; ISO: string }
type StateDatasetRow = { adminName1: string; adminCode1: string }
type CityDatasetRow = { name: string }
type IbgeCityRow = { nome: string }

const assetBaseUrl = `${import.meta.env.BASE_URL}location-data/`
const brazilStateCodes: Record<string, string> = {
  Acre: 'AC', Alagoas: 'AL', Amapá: 'AP', Amazonas: 'AM', Bahia: 'BA', Ceará: 'CE',
  'Distrito Federal': 'DF', 'Federal District': 'DF', 'Espírito Santo': 'ES', Goiás: 'GO',
  Maranhão: 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG',
  Pará: 'PA', Paraíba: 'PB', Paraiba: 'PB', Paraná: 'PR', Pernambuco: 'PE', Piauí: 'PI',
  'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS',
  Rondônia: 'RO', Roraima: 'RR', 'Santa Catarina': 'SC', 'São Paulo': 'SP', Sergipe: 'SE', Tocantins: 'TO',
}
const federalDistrictAdministrativeRegions = [
  'Águas Claras', 'Água Quente', 'Arapoanga', 'Arniqueira', 'Brazlândia', 'Candangolândia',
  'Ceilândia', 'Cruzeiro', 'Fercal', 'Gama', 'Guará', 'Itapoã', 'Jardim Botânico', 'Lago Norte',
  'Lago Sul', 'Núcleo Bandeirante', 'Paranoá', 'Park Way', 'Planaltina', 'Plano Piloto',
  'Recanto das Emas', 'Riacho Fundo', 'Riacho Fundo II', 'Samambaia', 'Santa Maria', 'São Sebastião',
  'SCIA/Estrutural', 'SIA', 'Sobradinho', 'Sobradinho II', 'Sol Nascente/Pôr do Sol',
  'Sudoeste/Octogonal', 'Taguatinga', 'Varjão', 'Vicente Pires',
]

let countriesPromise: Promise<CountryDatasetRow[]> | undefined

function assetPath(...parts: string[]) {
  return `${assetBaseUrl}${parts.map(encodeURIComponent).join('/')}`
}

async function getLocationData<T>(path: string): Promise<T> {
  const response = await fetch(assetPath(...path.split('/')))

  if (!response.ok) {
    throw new Error('Não foi possível carregar as localidades.')
  }

  return response.json() as Promise<T>
}

function getCountriesDataset() {
  countriesPromise ??= getLocationData<CountryDatasetRow[]>('countries.json')
  return countriesPromise
}

async function getCountry(countryCode: string) {
  const countries = await getCountriesDataset()
  return countries.find((country) => country.ISO === countryCode.toUpperCase())
}

export async function getCountries(): Promise<LocationCountry[]> {
  const countries = await getCountriesDataset()
  return countries
    .map((country) => ({ code: country.ISO, name: country.ISO === 'BR' ? 'Brasil' : country.country }))
    .sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'))
}

export async function getStates(countryCode: string): Promise<LocationState[]> {
  const country = await getCountry(countryCode)
  if (!country) return []

  const payload = await getLocationData<{ regions: StateDatasetRow[] }>(`region/${country.country}.json`)
  return payload.regions
    .map((state) => ({
      code: country.ISO === 'BR' ? brazilStateCodes[state.adminName1] ?? state.adminCode1 : state.adminCode1,
      name: country.ISO === 'BR' && state.adminName1 === 'Federal District'
        ? 'Distrito Federal'
        : country.ISO === 'BR' && state.adminName1 === 'Paraiba'
          ? 'Paraíba'
          : state.adminName1,
    }))
    .sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'))
}

async function getBrazilCities(stateCode: string): Promise<LocationCity[]> {
  if (stateCode.toUpperCase() === 'DF') {
    return federalDistrictAdministrativeRegions.map((name) => ({ name }))
  }

  const response = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(stateCode)}/municipios`,
  )
  if (!response.ok) throw new Error('Não foi possível carregar os municípios do IBGE.')
  const cities = (await response.json()) as IbgeCityRow[]
  return cities.map((city) => ({ name: city.nome })).sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'))
}

export async function getCities(countryCode: string, stateCode?: string): Promise<LocationCity[]> {
  const country = await getCountry(countryCode)
  if (!country) return []

  if (country.ISO === 'BR' && stateCode) {
    try {
      return await getBrazilCities(stateCode)
    } catch {
      // Mantém o catálogo estático como alternativa quando o IBGE estiver indisponível.
    }
  }

  const states = await getStates(countryCode)
  const selectedStates = stateCode
    ? states.filter((state) => state.code === stateCode.toUpperCase())
    : states
  const cityGroups = await Promise.all(selectedStates.map(async (state) => {
    const datasetName = country.ISO === 'BR' && state.code === 'DF'
      ? 'Federal District'
      : country.ISO === 'BR' && state.code === 'PB'
        ? 'Paraiba'
        : state.name
    try {
      const payload = await getLocationData<{ cities: CityDatasetRow[] }>(
        `region_city_data/${country.country}/${datasetName}.json`,
      )
      return payload.cities.map((city) => ({ name: city.name }))
    } catch {
      return []
    }
  }))

  return cityGroups.flat().sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'))
}
