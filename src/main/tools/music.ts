import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  formatNowPlaying,
  intArg,
  MUSIC_ACTIONS,
  MUSIC_KINDS,
  MUSIC_TOOLS,
  pickSpotify,
  type MusicAction,
  type MusicKind
} from '../../shared/builtin'
import { failure, getJson, HttpError, type BuiltinServer } from './types'

/**
 * The Spotify app on this Mac, driven with AppleScript (play, pause, skip, what's playing). Finding
 * a song by name needs Spotify's search: with the user's developer app (client ID + secret) Poppy
 * searches and plays the hit; without it, the search opens in the app.
 * POPPY_SPOTIFY_URL and POPPY_OSASCRIPT are for tests only (a fake server and a fake osascript).
 */
const ACCOUNTS = process.env.POPPY_SPOTIFY_URL || 'https://accounts.spotify.com'
const API = process.env.POPPY_SPOTIFY_URL || 'https://api.spotify.com'
const OSASCRIPT = process.env.POPPY_OSASCRIPT || '/usr/bin/osascript'

export const spotifyInstalled = (): boolean =>
  !!process.env.POPPY_OSASCRIPT || ['/Applications/Spotify.app', join(homedir(), 'Applications/Spotify.app')].some((p) => existsSync(p))

/** Runs an AppleScript with its values passed as arguments (never pasted into the script). */
function osascript(lines: string[], args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(OSASCRIPT, [...lines.flatMap((l) => ['-e', l]), ...args], { timeout: 15_000, signal }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message)
        reject(new Error(/-1743|not allowed/i.test(msg) ? "macOS doesn't allow Poppy to control Spotify (System Settings → Privacy & Security → Automation)" : msg.trim().slice(0, 200)))
      } else resolve(String(stdout))
    })
  })
}

const NOW_PLAYING = [
  'if application "Spotify" is not running then return "not running"',
  'tell application "Spotify"',
  'set s to player state as string',
  'if s is "stopped" then return "stopped"',
  'set t to current track',
  'return s & tab & (name of t) & tab & (artist of t) & tab & (album of t) & tab & ((duration of t) div 1000) & tab & (player position as integer) & tab & (sound volume) & tab & (shuffling as string)',
  'end tell'
]

/** Opens Spotify when it's closed, so a play command has something to talk to. */
const LAUNCH = ['if application "Spotify" is not running then', 'tell application "Spotify" to launch', 'delay 3', 'end if']

const CONTROL: Record<MusicAction, string> = {
  play: 'play',
  pause: 'pause',
  next: 'next track',
  previous: 'previous track',
  shuffle_on: 'set shuffling to true',
  shuffle_off: 'set shuffling to false',
  set_volume: 'set sound volume to ((item 1 of argv) as integer)'
}

const run = (body: string[]): string[] => ['on run argv', ...body, 'end run']

let token: { id: string; value: string; until: number } | null = null

async function accessToken(id: string, secret: string, signal: AbortSignal): Promise<string> {
  if (token && token.id === id && Date.now() < token.until) return token.value
  const data = await getJson<{ access_token: string; expires_in: number }>(`${ACCOUNTS}/api/token`, signal, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  })
  token = { id, value: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 }
  return token.value
}

/** Checks a client ID + secret before they're saved. */
export async function checkSpotifyKeys(id: string, secret: string): Promise<string | null> {
  token = null
  try {
    await accessToken(id, secret, new AbortController().signal)
    return null
  } catch (err) {
    return err instanceof HttpError && (err.status === 400 || err.status === 401)
      ? 'Spotify refused that client ID and secret'
      : err instanceof Error
        ? err.message
        : String(err)
  }
}

export function musicServer(keys: { id: string; secret: string } | null): BuiltinServer {
  return {
    name: 'music',
    problem: spotifyInstalled() ? null : "The Spotify app isn't installed on this Mac.",
    tools: [
      {
        def: MUSIC_TOOLS[0],
        run: async (_args, signal) => {
          try {
            return { ok: true, text: formatNowPlaying(await osascript(run(NOW_PLAYING), [], signal)) }
          } catch (err) {
            return failure(err, signal, 'Asking Spotify')
          }
        }
      },
      {
        def: MUSIC_TOOLS[1],
        run: async (args, signal) => {
          const action = MUSIC_ACTIONS.find((a) => a === args.action)
          if (!action) return { ok: false, text: `Unknown action. Use one of: ${MUSIC_ACTIONS.join(', ')}.` }
          const extra = action === 'set_volume' ? [String(intArg(args.volume, 0, 100, 50))] : []
          try {
            await osascript(run([...LAUNCH, `tell application "Spotify" to ${CONTROL[action]}`]), extra, signal)
            // Spotify needs a moment before it reports the next song.
            if (action === 'next' || action === 'previous' || action === 'play') await new Promise((r) => setTimeout(r, 700))
            const now = action === 'pause' ? '' : ` ${formatNowPlaying(await osascript(run(NOW_PLAYING), [], signal))}`
            return { ok: true, text: `Done (${action.replace('_', ' ')}${extra.length ? ` ${extra[0]}%` : ''}).${now}` }
          } catch (err) {
            return failure(err, signal, 'Controlling Spotify')
          }
        }
      },
      {
        def: MUSIC_TOOLS[2],
        run: async (args, signal) => {
          const query = typeof args.query === 'string' ? args.query.trim().slice(0, 200) : ''
          if (!query) return { ok: false, text: 'play_music needs a query.' }
          const kind: MusicKind = MUSIC_KINDS.find((k) => k === args.kind) ?? 'track'
          try {
            if (!keys) {
              await osascript(run(['open location (item 1 of argv)']), [`spotify:search:${encodeURIComponent(query)}`], signal)
              return {
                ok: true,
                text: `Opened a search for "${query}" in Spotify. Poppy can't pick a result without Spotify keys (Settings → Tools), so the user has to click play there.`
              }
            }
            const q = new URLSearchParams({ q: query, type: kind, limit: '5' })
            const data = await getJson<Record<string, { items?: [] }>>(`${API}/v1/search?${q}`, signal, {
              headers: { Authorization: `Bearer ${await accessToken(keys.id, keys.secret, signal)}` }
            })
            const hit = pickSpotify(data, kind)
            if (!hit) return { ok: false, text: `Spotify found no ${kind} for "${query}".` }
            await osascript(run([...LAUNCH, 'tell application "Spotify" to play track (item 1 of argv)']), [hit.uri], signal)
            return { ok: true, text: `Now playing ${hit.label} in Spotify.` }
          } catch (err) {
            return failure(err, signal, 'Playing music')
          }
        }
      }
    ]
  }
}
