import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Starts the local search engine on request: the Docker engine first if it's off (Docker Desktop in
 * the background, or Colima when that's the Docker context), then the poppy-searxng container
 * (created with scripts/searxng.sh when it's missing), then waits until search answers.
 */
const CONTAINER = 'poppy-searxng'
const DOCKER_WAIT_MS = 90_000
const SEARCH_WAIT_MS = 45_000
/** Electron started from Finder gets a bare PATH. */
const PATH = [process.env.PATH ?? '', '/opt/homebrew/bin', '/usr/local/bin', '/Applications/Docker.app/Contents/Resources/bin'].filter(Boolean).join(':')

function sh(cmd: string, args: string[], timeoutMs: number, env: Record<string, string> = {}): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, env: { ...process.env, PATH, ...env } }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim() })
    )
  })
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(signal.reason)
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })

async function healthy(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) })).ok
  } catch {
    return false
  }
}

const dockerUp = async (): Promise<boolean> => (await sh('docker', ['info', '--format', '{{.ServerVersion}}'], 8000)).ok

async function startEngine(signal: AbortSignal): Promise<void> {
  const context = (await sh('docker', ['context', 'show'], 5000)).out
  if (/colima/i.test(context)) {
    const r = await sh('colima', ['start'], DOCKER_WAIT_MS)
    if (!r.ok) throw new Error(`Colima didn't start (${r.out.split('\n').pop()})`)
    return
  }
  if (!existsSync('/Applications/Docker.app')) throw new Error("Docker Desktop isn't installed")
  // -g: start in the background, without bringing Docker's window to the front.
  await sh('open', ['-g', '-a', 'Docker'], 10_000)
  const until = Date.now() + DOCKER_WAIT_MS
  while (!(await dockerUp())) {
    if (Date.now() > until) throw new Error(`Docker didn't start within ${DOCKER_WAIT_MS / 1000} seconds`)
    await sleep(2000, signal)
  }
}

async function startContainer(url: string): Promise<void> {
  const r = await sh('docker', ['start', CONTAINER], 30_000)
  if (r.ok) return
  if (!/no such container/i.test(r.out)) throw new Error(`the search container didn't start (${r.out.split('\n').pop()})`)
  // Not set up yet: run the setup script (it also writes the search engine's settings).
  const script = join(app.getAppPath(), 'scripts', 'searxng.sh')
  if (!existsSync(script)) throw new Error('the local search engine isn\'t set up (run "npm run searxng" in Poppy\'s folder)')
  const port = new URL(url).port || '8890'
  const setup = await sh('sh', [script], 180_000, { POPPY_DATA_DIR: app.getPath('userData'), POPPY_SEARXNG_PORT: port })
  if (!setup.ok) throw new Error(`setting up the search engine failed (${setup.out.split('\n').pop()})`)
}

let starting: Promise<void> | null = null

/** Starts Docker (when needed) and the search container, and waits until search answers. Throws with a plain reason. */
export function startLocalSearch(url: string, signal: AbortSignal): Promise<void> {
  starting ??= (async () => {
    if (!(await dockerUp())) await startEngine(signal)
    await startContainer(url)
    const until = Date.now() + SEARCH_WAIT_MS
    while (!(await healthy(url))) {
      if (Date.now() > until) throw new Error(`the search engine didn't answer within ${SEARCH_WAIT_MS / 1000} seconds`)
      await sleep(1000, signal)
    }
  })().finally(() => (starting = null))
  return starting
}
