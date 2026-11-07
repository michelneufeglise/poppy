import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'

const file = (): string => join(app.getPath('userData'), 'settings.json')

let current: Settings | null = null
const listeners = new Set<(s: Settings) => void>()

export function getSettings(): Settings {
  if (!current) {
    try {
      current = { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(file(), 'utf8')) }
    } catch {
      current = { ...DEFAULT_SETTINGS }
    }
  }
  return current!
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...getSettings(), ...patch }
  try {
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), JSON.stringify(current, null, 2))
  } catch (err) {
    console.error('Could not save settings', err)
  }
  for (const fn of listeners) fn(current)
  return current
}

export function onSettingsChanged(fn: (s: Settings) => void): void {
  listeners.add(fn)
}
