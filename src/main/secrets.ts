import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The Anthropic API key, encrypted with a key that macOS keeps in the user's Keychain
 * (Electron's safeStorage). It never goes into settings.json and never back to a window.
 */
const file = (): string => join(app.getPath('userData'), 'secrets.json')

let key: string | null | undefined

export function getApiKey(): string | null {
  if (key !== undefined) return key
  key = null
  try {
    const data = JSON.parse(readFileSync(file(), 'utf8')) as { anthropic?: string }
    if (data.anthropic && safeStorage.isEncryptionAvailable()) {
      key = safeStorage.decryptString(Buffer.from(data.anthropic, 'base64'))
    }
  } catch {
    // No key saved yet.
  }
  return key
}

/** Saves the key (an empty string removes it). Throws when the Mac can't encrypt it. */
export function setApiKey(value: string): void {
  const clean = value.trim()
  if (!clean) {
    rmSync(file(), { force: true })
    key = null
    return
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("This Mac can't encrypt the key right now, so it wasn't saved.")
  mkdirSync(dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify({ anthropic: safeStorage.encryptString(clean).toString('base64') }), { mode: 0o600 })
  key = clean
}

/** "sk-ant-…abcd", for showing that a key is set without showing the key. */
export function maskedApiKey(): string | null {
  const k = getApiKey()
  return k ? `${k.slice(0, 7)}…${k.slice(-4)}` : null
}
