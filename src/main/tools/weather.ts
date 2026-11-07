import { formatWeather, intArg, pickPlace, splitPlace, WEATHER_TOOLS, type Place } from '../../shared/builtin'
import { failure, getJson, type BuiltinServer } from './types'

/** Open-Meteo: free, no key. POPPY_WEATHER_URL points both parts at a local fake server for tests. */
const GEO = process.env.POPPY_WEATHER_URL || 'https://geocoding-api.open-meteo.com'
const FORECAST = process.env.POPPY_WEATHER_URL || 'https://api.open-meteo.com'

const places = new Map<string, Place>()

async function findPlace(wanted: string, signal: AbortSignal): Promise<Place | null> {
  const key = wanted.toLowerCase()
  if (places.has(key)) return places.get(key)!
  const { name, hint } = splitPlace(wanted)
  const q = new URLSearchParams({ name, count: '10', language: 'en', format: 'json' })
  const data = await getJson<{ results?: Place[] }>(`${GEO}/v1/search?${q}`, signal)
  const place = pickPlace(data.results ?? [], hint)
  if (place) places.set(key, place)
  return place
}

export function weatherServer(homeCity: string): BuiltinServer {
  return {
    name: 'weather',
    problem: null,
    tools: [
      {
        def: WEATHER_TOOLS[0],
        run: async (args, signal) => {
          const wanted = (typeof args.place === 'string' ? args.place.trim() : '') || homeCity.trim()
          if (!wanted) return { ok: false, text: "No place given and no home city set in Settings. Ask the user which place they mean." }
          const days = intArg(args.days, 1, 7, 3)
          try {
            const place = await findPlace(wanted, signal)
            if (!place) return { ok: false, text: `Couldn't find a place called "${wanted}".` }
            const q = new URLSearchParams({
              latitude: String(place.latitude),
              longitude: String(place.longitude),
              current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
              daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
              timezone: 'auto',
              forecast_days: String(days)
            })
            return { ok: true, text: formatWeather(place, await getJson(`${FORECAST}/v1/forecast?${q}`, signal)) }
          } catch (err) {
            return failure(err, signal, 'The weather lookup')
          }
        }
      }
    ]
  }
}
