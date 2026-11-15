import { app, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { homedir, totalmem } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { EMBED_MODEL, hasModel, lastLine, pullProgress, type MacInfo } from '../shared/setup'
import type { SetupInstall, SetupProgress, SetupState } from '../shared/types'
import { startLocalSearch } from './tools/docker'

/**
 * The setup guide's hands: it looks at this Mac (chip, memory, disk, macOS, and whether Ollama,
 * Python + Kokoro, Docker and Node are there) and installs what's missing, but only what the page
 * asks for after the user said yes. Installs use Homebrew when it's there (fixed commands, never a
 * password: brew can't ask for one here, so anything that needs it fails and the page offers the
 * download page instead) and otherwise open the official download page.
 */

/** Electron started from Finder gets a bare PATH. */
const PATH = [
  process.env.PATH ?? '',
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(homedir(), '.local/bin'),
  '/Applications/Docker.app/Contents/Resources/bin'
]
  .filter(Boolean)
  .join(':')
const BREWS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']
const PYTHONS = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3']
/** kokoro-onnx: the version Poppy is tested with. */
const KOKORO_PKG = 'kokoro-onnx==0.4.7'
const INSTALL_MS = 20 * 60_000
const START_WAIT_MS = 45_000

/** The download pages the page may open (it sends the key, never a URL). */
export const PAGES = {
  brew: 'https://brew.sh',
  ollama: 'https://ollama.com/download/mac',
  docker: 'https://docs.docker.com/desktop/setup/install/mac-install/',
  python: 'https://www.python.org/downloads/macos/',
  node: 'https://nodejs.org/en/download'
} as const

/**
 * Test only: POPPY_SETUP_FAKE=ollama,model,kokoro,python,docker,swift,brew makes those look missing,
 * and "installing" them just pretends (a few seconds of progress), so the guide can be tried and
 * photographed on a Mac that has everything.
 */
const fake = new Set((process.env.POPPY_SETUP_FAKE ?? '').split(',').map((s) => s.trim()).filter(Boolean))

function run(cmd: string, args: string[], timeoutMs = 10_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, env: { ...process.env, PATH } }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim() })
    )
  })
}

/** Runs an installer, passing its newest output line along as it goes. */
function stream(cmd: string, args: string[], env: Record<string, string>, onLine: (l: string) => void, signal: AbortSignal): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { env: { ...process.env, PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const take = (b: Buffer): void => {
      out = (out + b.toString()).slice(-20_000)
      const line = lastLine(b.toString())
      if (line) onLine(line)
    }
    proc.stdout.on('data', take)
    proc.stderr.on('data', take)
    const stop = (): void => void proc.kill()
    signal.addEventListener('abort', stop, { once: true })
    const timer = setTimeout(stop, INSTALL_MS)
    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, out: err.message })
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      resolve({ ok: code === 0 && !signal.aborted, out })
    })
  })
}

const which = (name: string): string | null => {
  for (const dir of PATH.split(':')) {
    const p = join(dir, name)
    if (dir && existsSync(p)) return p
  }
  return null
}
const brew = (): string | null => (fake.has('brew') ? null : (BREWS.find((p) => existsSync(p)) ?? null))

async function swiftThere(): Promise<boolean> {
  if (fake.has('swift')) return false
  // xcode-select -p first: asking xcrun on a Mac without the tools pops up Apple's install dialog.
  const dev = await run('/usr/bin/xcode-select', ['-p'], 5000)
  if (!dev.ok) return false
  return ['usr/bin/swiftc', 'Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc'].some((p) => existsSync(join(dev.out, p)))
}

export async function macInfo(): Promise<MacInfo> {
  const [version, arm, brand, swift] = await Promise.all([
    run('/usr/bin/sw_vers', ['-productVersion']),
    run('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64']),
    run('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string']),
    swiftThere()
  ])
  let freeGB = 0
  try {
    const fs = await statfs(homedir())
    freeGB = (fs.bavail * fs.bsize) / 1e9
  } catch {
    // unknown: shown as 0 GB free
  }
  // Test only: POPPY_SETUP_MAC='{"chipName":"…"}' shows another Mac (for screenshots without this Mac's details).
  const pretendMac = process.env.POPPY_SETUP_MAC ? (JSON.parse(process.env.POPPY_SETUP_MAC) as Partial<MacInfo>) : {}
  return {
    macos: version.out || '0',
    chip: arm.out === '1' ? 'apple' : 'intel',
    chipName: brand.out,
    memGB: Math.round(totalmem() / 2 ** 30),
    freeGB,
    swift,
    brew: !!brew(),
    ...pretendMac
  }
}

async function ollamaUp(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(2000) })).ok
  } catch {
    return false
  }
}

async function ollamaModels(url: string): Promise<string[]> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) })
    const data = (await res.json()) as { models?: { name: string }[] }
    return (data.models ?? []).map((m) => m.name)
  } catch {
    return []
  }
}

const pythonPath = (): string | null => (fake.has('python') ? null : (PYTHONS.find((p) => existsSync(p)) ?? null))

/** kokoro-onnx wants Python 3.10 or newer (macOS's own /usr/bin/python3 is 3.9). */
async function pythonOk(python: string): Promise<boolean> {
  const r = await run(python, ['-c', 'import sys; print(sys.version_info >= (3, 10))'], 8000)
  return r.out.endsWith('True')
}

const dockerApp = (): boolean => existsSync('/Applications/Docker.app') || !!which('colima')
async function dockerUp(): Promise<boolean> {
  return !fake.has('docker') && (await run('docker', ['info', '--format', '{{.ServerVersion}}'], 8000)).ok
}
async function searchUp(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) })).ok
  } catch {
    return false
  }
}

/** Everything the guide checks, in one go (a few seconds at most). */
export async function setupState(ollamaUrl: string, searxngUrl: string, kokoroFiles: boolean): Promise<SetupState> {
  const [mac, running] = await Promise.all([macInfo(), ollamaUp(ollamaUrl)])
  const models = running ? await ollamaModels(ollamaUrl) : []
  const python = pythonPath()
  const pyOk = python ? await pythonOk(python) : false
  const kokoro = pyOk && !fake.has('kokoro') ? (await run(python!, ['-c', 'import kokoro_onnx'], 15_000)).ok : false
  const [docker, search] = await Promise.all([dockerUp(), searchUp(searxngUrl)])
  return {
    mac,
    ollama: {
      installed: !fake.has('ollama') && (existsSync('/Applications/Ollama.app') || !!which('ollama')),
      running: running && !fake.has('ollama'),
      models: models.filter((m) => (/embed/i.test(m) ? !fake.has('embed') : !fake.has('model')))
    },
    voice: { python: python && pyOk ? python : null, kokoro, files: kokoroFiles && !fake.has('kokoro') },
    tools: {
      dockerInstalled: !fake.has('docker') && (dockerApp() || docker),
      dockerRunning: docker,
      search: search && !fake.has('docker'),
      npx: which('npx')
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A pretend install for POPPY_SETUP_FAKE: some progress, then it's "there". */
async function pretend(what: string, progress: (p: Omit<SetupProgress, 'what'>) => void, signal: AbortSignal): Promise<void> {
  for (let i = 1; i <= 10; i++) {
    if (signal.aborted) throw new Error('stopped')
    progress({ text: `pretending to install (${i * 10}%)`, percent: i * 10 })
    await sleep(300)
  }
  fake.delete(what)
}

async function waitFor(check: () => Promise<boolean>, ms: number, signal: AbortSignal): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (signal.aborted) return false
    if (await check()) return true
    await sleep(1500)
  }
  return false
}

export class InstallError extends Error {
  /** The download page that does it by hand. */
  constructor(message: string, readonly page?: keyof typeof PAGES) {
    super(message)
  }
}

async function brewInstall(args: string[], page: keyof typeof PAGES, progress: (p: Omit<SetupProgress, 'what'>) => void, signal: AbortSignal): Promise<void> {
  const b = brew()
  if (!b) throw new InstallError("Homebrew isn't installed, so let's use the download page.", page)
  progress({ text: `brew ${args.join(' ')}`, percent: null })
  const r = await stream(b, args, { NONINTERACTIVE: '1', HOMEBREW_NO_ENV_HINTS: '1' }, (line) => progress({ text: line, percent: null }), signal)
  if (signal.aborted) throw new InstallError('Stopped.')
  if (!r.ok) {
    const why = /password|sudo/i.test(r.out) ? 'it needs your Mac password' : lastLine(r.out) || 'brew failed'
    throw new InstallError(`Homebrew couldn't do it (${why}). The download page works too.`, page)
  }
}

async function startOllama(url: string, signal: AbortSignal): Promise<void> {
  if (await ollamaUp(url)) return
  if (existsSync('/Applications/Ollama.app')) await run('/usr/bin/open', ['-g', '-a', 'Ollama'])
  else {
    const bin = which('ollama')
    if (!bin) throw new InstallError("Ollama isn't installed yet.", 'ollama')
    spawn(bin, ['serve'], { detached: true, stdio: 'ignore', env: { ...process.env, PATH } }).unref()
  }
  if (!(await waitFor(() => ollamaUp(url), START_WAIT_MS, signal))) throw new InstallError("Ollama didn't start. Try opening the Ollama app yourself.")
}

/** Downloads a model through Ollama, with progress. */
async function pull(url: string, model: string, progress: (p: Omit<SetupProgress, 'what'>) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`${url}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }), signal })
  if (!res.ok || !res.body) throw new InstallError(`Ollama said ${res.status} to the download.`)
  const lines = createInterface({ input: Readable.fromWeb(res.body as never) })
  for await (const raw of lines) {
    if (!raw.trim()) continue
    const p = pullProgress(JSON.parse(raw))
    if (p.error) throw new InstallError(p.error)
    progress({ text: p.text, percent: p.percent })
  }
}

async function installKokoro(progress: (p: Omit<SetupProgress, 'what'>) => void, signal: AbortSignal): Promise<void> {
  const python = pythonPath()
  if (!python || !(await pythonOk(python))) throw new InstallError('Python 3.10 or newer is needed first.', 'python')
  const pip = (extra: string[]): Promise<{ ok: boolean; out: string }> =>
    stream(python, ['-m', 'pip', 'install', '--user', ...extra, KOKORO_PKG], { PIP_DISABLE_PIP_VERSION_CHECK: '1' }, (line) => progress({ text: line, percent: null }), signal)
  progress({ text: `pip install ${KOKORO_PKG}`, percent: null })
  let r = await pip([])
  // Homebrew's Python is "externally managed": installing for this user only is still fine.
  if (!r.ok && /externally-managed/i.test(r.out)) r = await pip(['--break-system-packages'])
  if (!r.ok) throw new InstallError(`pip couldn't install it (${lastLine(r.out)}).`)
}

/** Installs or starts one thing. The page only asks after the user said yes. */
export async function install(
  job: SetupInstall,
  urls: { ollama: string; searxng: string },
  progress: (p: Omit<SetupProgress, 'what'>) => void,
  signal: AbortSignal
): Promise<void> {
  const key = job.what === 'model' ? (job.model === EMBED_MODEL.model ? 'embed' : 'model') : job.what
  if (fake.has(key) || (job.what === 'start-ollama' && fake.has('ollama')) || (job.what === 'search' && fake.has('docker'))) {
    return pretend(job.what === 'start-ollama' ? 'ollama' : job.what === 'search' ? 'docker' : key, progress, signal)
  }
  switch (job.what) {
    case 'ollama':
      await brewInstall(['install', '--cask', 'ollama-app'], 'ollama', progress, signal)
      return startOllama(urls.ollama, signal)
    case 'start-ollama':
      return startOllama(urls.ollama, signal)
    case 'model':
      if (!job.model) throw new InstallError('Which model?')
      if (!(await ollamaUp(urls.ollama))) await startOllama(urls.ollama, signal)
      if (hasModel(await ollamaModels(urls.ollama), job.model)) return
      return pull(urls.ollama, job.model, progress, signal)
    case 'python':
      return brewInstall(['install', 'python'], 'python', progress, signal)
    case 'kokoro':
      return installKokoro(progress, signal)
    case 'docker':
      await brewInstall(['install', '--cask', 'docker-desktop'], 'docker', progress, signal)
      return
    case 'search':
      progress({ text: 'starting Docker and the search engine…', percent: null })
      try {
        await startLocalSearch(urls.searxng, signal)
      } catch (err) {
        throw new InstallError(
          `${(err as Error).message}. If Docker shows its own welcome window, finish that first and try again.`
        )
      }
      return
    case 'swift':
      // Apple's own installer window: the user clicks Install there.
      await run('/usr/bin/xcode-select', ['--install'])
      progress({ text: "Apple's installer is open: click Install there", percent: null })
      if (!(await waitFor(swiftThere, INSTALL_MS, signal))) throw new InstallError("The command line tools aren't there yet.")
      return
  }
}

export function openPage(key: string): void {
  const url = PAGES[key as keyof typeof PAGES]
  if (url) void shell.openExternal(url)
}

/** Kokoro's voice files are in the data folder. */
export const kokoroFilesThere = (): boolean =>
  ['kokoro-v1.0.onnx', 'voices-v1.0.bin'].every((f) => existsSync(join(app.getPath('userData'), 'kokoro', f)))
