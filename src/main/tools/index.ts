import type { Settings } from '../../shared/types'
import { getSecret } from '../secrets'
import { musicServer } from './music'
import type { BuiltinServer } from './types'
import { weatherServer } from './weather'
import { webServer } from './web'

/** Poppy's own tools that are switched on in Settings (built fresh, so new keys and settings count at once). */
export function builtinServers(s: Settings): BuiltinServer[] {
  const out: BuiltinServer[] = []
  if (s.weatherTool) out.push(weatherServer(s.homeCity))
  if (s.webTool) out.push(webServer(getSecret('ollama')))
  if (s.musicTool) {
    const id = getSecret('spotifyId')
    const secret = getSecret('spotifySecret')
    out.push(musicServer(id && secret ? { id, secret } : null))
  }
  return out
}
