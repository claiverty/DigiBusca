import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const source = resolve('node_modules/country-state-city-data/dist')
const destination = resolve('frontend/public/location-data')

rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })
cpSync(resolve(source, 'countries.json'), resolve(destination, 'countries.json'))
cpSync(resolve(source, 'region'), resolve(destination, 'region'), { recursive: true })
cpSync(resolve(source, 'region_city_data'), resolve(destination, 'region_city_data'), { recursive: true })
