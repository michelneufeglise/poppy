import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * API keys (Anthropic, Ollama web search, Spotify), each encrypted with a key that macOS keeps in the
 * user's Keychain (Electron's safeStorage). They never go into settings.json and never back to a window.
 */
export type SecretName = 'anthropic' | 'ollama' | 'spotifyId' | 'spotifySecret'

const file = (): string => join(app.getPath('userData'), 'secrets.json')

let cache: Partial<Record<SecretName, string>> | undefined

function readAll(): Partial<Record<SecretName, string>> {
  if (cache) return cache
  cache = {}
  try {
    const data = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Record<SecretName, string>>
    if (safeStorage.isEncryptionAvailable()) {
      for (const [name, value] of Object.entries(data)) {
        if (typeof value === 'string' && value) cache[name as SecretName] = safeStorage.decryptString(Buffer.from(value, 'base64'))
      }
    }
  } catch {
    // Nothing saved yet.
  }
  return cache
}

export function getSecret(name: SecretName): string | null {
  return readAll()[name] ?? null
}

/** Saves one secret (an empty string removes it). Throws when the Mac can't encrypt it. */
export function setSecret(name: SecretName, value: string): void {
  const clean = value.trim()
  const all = { ...readAll() }
  if (clean) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("This Mac can't encrypt the key right now, so it wasn't saved.")
    all[name] = clean
  } else delete all[name]
  cache = all
  const names = Object.keys(all) as SecretName[]
  if (!names.length) {
    rmSync(file(), { force: true })
    return
  }
  const out: Partial<Record<SecretName, string>> = {}
  for (const n of names) out[n] = safeStorage.encryptString(all[n]!).toString('base64')
  mkdirSync(dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify(out), { mode: 0o600 })
}

/** "sk-ant-…abcd", for showing that a key is set without showing the key. */
export function maskSecret(name: SecretName, keep = 7): string | null {
  const k = getSecret(name)
  return k ? `${k.slice(0, Math.min(keep, Math.floor(k.length / 3)))}…${k.slice(-4)}` : null
}

export const getApiKey = (): string | null => getSecret('anthropic')
export const setApiKey = (value: string): void => setSecret('anthropic', value)
export const maskedApiKey = (): string | null => maskSecret('anthropic')
