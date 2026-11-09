import { execFile } from 'node:child_process'

/**
 * Turns Spotify and Apple Music down while the user talks to Poppy, and back up afterwards. Only an app
 * that is running and playing is touched, and a volume the user changed in the meantime is left alone.
 * The system volume stays as it is, so Poppy's own voice is heard normally.
 * POPPY_OSASCRIPT is for tests only (a fake osascript).
 */
const OSASCRIPT = process.env.POPPY_OSASCRIPT || '/usr/bin/osascript'
const APPS = ['Spotify', 'Music']
/** Music goes down to this (0–100), or stays where it is if it's already quieter. */
export const DUCK_VOLUME = 15

function osascript(lines: string[], args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const e = lines.flatMap((l) => ['-e', l])
    execFile(OSASCRIPT, [...e, ...args], { timeout: 4000 }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())))
  })
}

// Values go in as argv, never pasted into the script. "is running" is asked first, without a tell block,
// so an app that isn't installed is never looked for (osascript would ask "Where is Spotify?").
const run = (body: string[]): string[] => ['on run argv', ...body, 'end run']
const IS_RUNNING = run(['return (application (item 1 of argv) is running) as string'])
const DUCK = (app: string): string[] =>
  run([
    `tell application "${app}"`,
    '  if player state is not playing then return ""',
    '  set v to sound volume',
    '  set target to (item 1 of argv) as integer',
    '  if v > target then set sound volume to target',
    '  return (v as string) & "," & (sound volume as string)',
    'end tell'
  ])
const RESTORE = (app: string): string[] =>
  run([
    `tell application "${app}"`,
    '  if (sound volume) is ((item 1 of argv) as integer) then set sound volume to ((item 2 of argv) as integer)',
    'end tell'
  ])

export class Ducker {
  /** Per app: the volume before, and the one we set. */
  private saved: { app: string; before: number; set: number }[] = []
  private busy: Promise<void> = Promise.resolve()

  get ducked(): boolean {
    return this.saved.length > 0
  }

  duck(): Promise<void> {
    return this.queue(async () => {
      if (this.saved.length) return
      for (const app of APPS) {
        try {
          if ((await osascript(IS_RUNNING, [app])) !== 'true') continue
          const out = await osascript(DUCK(app), [String(DUCK_VOLUME)])
          const [before, set] = out.split(',').map(Number)
          if (Number.isFinite(before) && Number.isFinite(set) && before !== set) this.saved.push({ app, before, set })
        } catch (err) {
          console.warn(`[listen] couldn't turn ${app} down:`, (err as Error).message)
        }
      }
    })
  }

  restore(): Promise<void> {
    return this.queue(async () => {
      const saved = this.saved
      this.saved = []
      for (const { app, before, set } of saved) {
        try {
          if ((await osascript(IS_RUNNING, [app])) !== 'true') continue
          await osascript(RESTORE(app), [String(set), String(before)])
        } catch (err) {
          console.warn(`[listen] couldn't turn ${app} back up:`, (err as Error).message)
        }
      }
    })
  }

  /** One at a time, so a quick duck → restore never crosses. */
  private queue(job: () => Promise<void>): Promise<void> {
    this.busy = this.busy.then(job, job)
    return this.busy
  }
}
