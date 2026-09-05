import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

type CountryRow = { country: string; ISO: string }
type StateRow = { adminName1: string; adminCode1: string }
type CityRow = { name: string }
type IbgeCityRow = { nome: string }

const require = createRequire(import.meta.url)
const dataRoot = dirname(require.resolve('country-state-city-data/package.json'))
const brazilStateCodes: Record<string, string> = {
  Acre: 'AC',
  Alagoas: 'AL',
  Amapá: 'AP',
  Amazonas: 'AM',
  Bahia: 'BA',
  Ceará: 'CE',
  'Distrito Federal': 'DF',
  'Federal District': 'DF',
  'Espírito Santo': 'ES',
  Goiás: 'GO',
  Maranhão: 'MA',
  'Mato Grosso': 'MT',
  'Mato Grosso do Sul': 'MS',
  'Minas Gerais': 'MG',
  Pará: 'PA',
  Paraíba: 'PB',
  Paraiba: 'PB',
  Paraná: 'PR',
  Pernambuco: 'PE',
  Piauí: 'PI',
  'Rio de Janeiro': 'RJ',
  'Rio Grande do Norte': 'RN',
  'Rio Grande do Sul': 'RS',
  Rondônia: 'RO',
  Roraima: 'RR',
  'Santa Catarina': 'SC',
  'São Paulo': 'SP',
  Sergipe: 'SE',
  Tocantins: 'TO',
}

const federalDistrictAdministrativeRegions = [
  'Águas Claras',
  'Água Quente',
  'Arapoanga',
  'Arniqueira',
  'Brazlândia',
  'Candangolândia',
  'Ceilândia',
  'Cruzeiro',
  'Fercal',
  'Gama',
  'Guará',
  'Itapoã',
  'Jardim Botânico',
  'Lago Norte',
  'Lago Sul',
  'Núcleo Bandeirante',
  'Paranoá',
  'Park Way',
  'Planaltina',
  'Plano Piloto',
  'Recanto das Emas',
  'Riacho Fundo',
  'Riacho Fundo II',
  'Samambaia',
  'Santa Maria',
  'São Sebastião',
  'SCIA/Estrutural',
  'SIA',
  'Sobradinho',
  'Sobradinho II',
  'Sol Nascente/Pôr do Sol',
  'Sudoeste/Octogonal',
  'Taguatinga',
  'Varjão',
  'Vicente Pires',
]

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function getCountry(code: string) {
  const countries = await readJson<CountryRow[]>(join(dataRoot, 'dist', 'countries.json'))
  return countries.find((country) => country.ISO === code.toUpperCase())
}

async function listBrazilCities(stateCode: string) {
  const response = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(stateCode)}/municipios`,
  )

  if (!response.ok) {
    throw new Error('Não foi possível carregar os municípios do IBGE.')
  }

  const cities = (await response.json()) as IbgeCityRow[]
  return cities
    .map((city) => ({ name: city.nome }))
    .sort((first, second) => first.name.localeCompare(second.name))
}

export async function listCountries() {
  const countries = await readJson<CountryRow[]>(join(dataRoot, 'dist', 'countries.json'))

  return countries
    .map((country) => ({
      code: country.ISO,
      name: country.ISO === 'BR' ? 'Brasil' : country.country,
    }))
    .sort((first, second) => first.name.localeCompare(second.name))
}

export async function listStates(countryCode: string) {
  const country = await getCountry(countryCode)
  if (!country) {
    return []
  }

  const file = join(dataRoot, 'dist', 'region', `${country.country}.json`)
  const { regions } = await readJson<{ regions: StateRow[] }>(file)

  return regions
    .map((state) => ({
      code: country.ISO === 'BR' ? brazilStateCodes[state.adminName1] ?? state.adminCode1 : state.adminCode1,
      name: country.ISO === 'BR' && state.adminName1 === 'Federal District'
        ? 'Distrito Federal'
        : country.ISO === 'BR' && state.adminName1 === 'Paraiba'
          ? 'Paraíba'
          : state.adminName1,
    }))
    .sort((first, second) => first.name.localeCompare(second.name))
}

export async function listCities(countryCode: string, stateCode?: string) {
  const country = await getCountry(countryCode)
  if (!country) {
    return []
  }

  if (country.ISO === 'BR' && stateCode) {
    if (stateCode.toUpperCase() === 'DF') {
      return federalDistrictAdministrativeRegions.map((name) => ({ name }))
    }

    try {
      return await listBrazilCities(stateCode)
    } catch {
      // The local dataset remains available if the IBGE endpoint is temporarily unavailable.
    }
  }

  const states = await listStates(countryCode)
  const selectedStates = stateCode
    ? states.filter((state) => state.code === stateCode.toUpperCase())
    : states

  const cities = await Promise.all(
    selectedStates.map(async (state) => {
      const datasetName = country.ISO === 'BR' && state.code === 'DF'
        ? 'Federal District'
        : country.ISO === 'BR' && state.code === 'PB'
          ? 'Paraiba'
          : state.name
      const file = join(dataRoot, 'dist', 'region_city_data', country.country, `${datasetName}.json`)
      try {
        const data = await readJson<{ cities: CityRow[] }>(file)
        return data.cities
      } catch {
        return []
      }
    }),
  )

  return cities
    .flat()
    .map((city) => ({ name: city.name }))
    .sort((first, second) => first.name.localeCompare(second.name))
}
