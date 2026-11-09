import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  afterWake,
  checkQuestion,
  RESET_TRANSCRIPT_MS,
  tidyQuestion,
  wakeHints,
  wakeWords
} from '../shared/listen'
import type { Character, ListenLocale, ListenStatus } from '../shared/types'
import { Ducker } from './duck'

/**
 * Voice input: the Swift helper (sidecar/listen.swift, Apple's SpeechAnalyzer) turns the microphone into
 * text on this Mac, with Apple's on-device models (no Siri or Dictation needed); this
 * class looks for the name in it, turns the music down, follows the question and hands it over when the
 * user stops talking. While Poppy answers it doesn't listen (hold/release), so she never hears herself.
 *
 * Test-only: POPPY_LISTEN_BIN (another helper, like a fake), POPPY_LISTEN_FILE (the real helper plays an
 * audio file instead of the microphone).
 */
export interface ListenOptions {
  enabled: boolean
  locale: ListenLocale
  character: Character
  duckMusic: boolean
}

export interface ListenEvents {
  /** The name was heard: open the chat and listen. */
  wake: () => void
  /** The question so far, while the user talks. */
  heard: (text: string) => void
  /** The finished question: send it like a typed one. */
  ask: (text: string) => void
  /** Nothing asked after the name (or "never mind"). */
  cancel: () => void
  status: (s: ListenStatus) => void
}

const TICK_MS = 200
/** POPPY_LISTEN_DEBUG=1: every message to and from the helper in the terminal. */
const DEBUG = !!process.env.POPPY_LISTEN_DEBUG
const debug = (...a: unknown[]): void => {
  if (DEBUG) console.log('[listen]', new Date().toISOString().slice(11, 23), ...a)
}
/** After handing over a question: if no reply starts in this time, listen again anyway. */
const REPLY_START_MS = 10_000
/** The helper answers every reset/pause/listen; if it doesn't within this time, it's restarted. */
const ACK_MS = 10_000
const SOURCES = ['sidecar/listen.swift', 'sidecar/listen-Info.plist']

type Msg =
  | { type: 'listening' | 'paused' | 'reset' | 'downloading' }
  /** Everything heard since the last reset. */
  | { type: 'text'; text: string; settled?: boolean }
  | { type: 'error'; code?: string; message: string }
  | { type: 'note'; message: string }
  | { type: 'check'; mic: string; available: boolean; supported: boolean; installed: boolean }

export class Listener {
  status: ListenStatus = { state: 'off', message: '' }
  private opts: ListenOptions = { enabled: false, locale: 'en-US', character: 'male', duckMusic: true }
  private proc: ChildProcess | null = null
  private starting: Promise<ChildProcess | null> | null = null
  private holds = 0
  private ducker = new Ducker()
  /** After the name: the question so far. */
  private q: { text: string; wokeAt: number; changedAt: number; settled: boolean } | null = null
  private resetAt = 0
  private tick: NodeJS.Timeout | null = null
  private waitReply: NodeJS.Timeout | null = null
  private checks: ((m: Msg & { type: 'check' }) => void)[] = []
  /**
   * After asking the helper to start over (reset, pause, listen), text already on its way still belongs
   * to the old transcript, with the name in it: it's skipped until the helper says it started over.
   */
  private skipUntil: 'reset' | 'paused' | 'listening' | null = null
  private ackTimer: NodeJS.Timeout | null = null
  /** The helper has started listening once: before that, it may be waiting on the microphone prompt. */
  private started = false

  constructor(private readonly on: ListenEvents) {}

  /** Settings changed: start, stop or restart listening as needed. */
  configure(next: ListenOptions): void {
    const before = this.opts
    this.opts = next
    if (!next.enabled) return this.stop()
    if (!this.proc && !this.starting) return void this.begin()
    if (before.locale !== next.locale || before.character !== next.character || !before.enabled) this.listen()
  }

  /** Poppy is answering (or talking): stop listening until release(). */
  hold(): void {
    this.holds++
    if (this.waitReply) {
      clearTimeout(this.waitReply)
      this.waitReply = null
    }
    if (this.holds === 1) this.send({ cmd: 'pause' })
  }

  release(): void {
    if (this.holds === 0) return
    this.holds--
    if (this.holds === 0) this.resume()
  }

  /** Esc while listening to a question. */
  cancel(): void {
    if (!this.q) return
    this.endQuestion()
    this.on.cancel()
    void this.ducker.restore()
    this.send({ cmd: 'reset' })
  }

  /** Permissions and on-device support, without asking for anything. */
  async check(): Promise<string> {
    const proc = await this.ensureProcess()
    if (!proc) return this.status.message
    const res = await new Promise<(Msg & { type: 'check' }) | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000)
      this.checks.push((m) => {
        clearTimeout(timer)
        resolve(m)
      })
      this.send({ cmd: 'check', locale: this.opts.locale })
    })
    if (!this.opts.enabled) this.stop() // only started for the check
    if (!res) return "The listener didn't answer."
    const lang = this.lang()
    if (!res.available) return "Apple's speech recognition isn't available on this Mac."
    if (!res.supported) return `This Mac has no speech recognition for ${lang}.`
    if (res.mic === 'denied' || res.mic === 'restricted')
      return 'The microphone isn\'t allowed: turn on Poppy under System Settings → Privacy & Security → Microphone.'
    const notes = []
    if (!res.installed) notes.push(`Apple's ${lang} speech model downloads once when listening starts.`)
    if (res.mic !== 'authorized') notes.push('macOS asks for the microphone the first time.')
    return notes.join(' ') || `${lang} works on this Mac.`
  }

  private lang(): string {
    return this.opts.locale === 'nl-NL' ? 'Dutch' : 'English'
  }

  shutdown(): void {
    this.stop()
  }

  // ---------- the helper process ----------

  private async begin(): Promise<void> {
    const proc = await this.ensureProcess()
    if (proc && this.opts.enabled) this.listen()
  }

  private listen(): void {
    this.endQuestion()
    if (this.holds > 0) return this.setStatus('paused', '')
    this.setStatus('starting', '')
    this.resetAt = Date.now()
    this.send({ cmd: 'listen', locale: this.opts.locale, hints: wakeHints(this.opts.character) })
  }

  private resume(): void {
    if (!this.opts.enabled || !this.proc) return
    void this.ducker.restore() // the answer is spoken: music back up
    this.listen()
  }

  private stop(): void {
    this.endQuestion()
    if (this.ackTimer) clearTimeout(this.ackTimer)
    this.ackTimer = null
    this.skipUntil = null
    void this.ducker.restore()
    this.starting = null
    if (this.proc) {
      this.send({ cmd: 'quit' })
      const p = this.proc
      this.proc = null
      setTimeout(() => p.kill(), 1000).unref()
    }
    this.setStatus('off', '')
  }

  private ensureProcess(): Promise<ChildProcess | null> {
    if (this.proc) return Promise.resolve(this.proc)
    if (!this.starting) {
      this.starting = this.spawnHelper().catch((err: Error) => {
        this.setStatus('error', err.message)
        return null
      })
      void this.starting.finally(() => (this.starting = null))
    }
    return this.starting
  }

  private async spawnHelper(): Promise<ChildProcess> {
    const bin = process.env.POPPY_LISTEN_BIN || (await this.build())
    const args = process.env.POPPY_LISTEN_FILE ? ['--file', process.env.POPPY_LISTEN_FILE] : []
    const proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    proc.on('error', (err) => this.setStatus('error', `The listener didn't start: ${err.message}`))
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-600)))
    proc.on('exit', (code) => {
      if (this.proc !== proc) return
      this.proc = null
      this.endQuestion()
      if (this.opts.enabled) this.setStatus('error', `The listener stopped (${code ?? 'killed'}). ${stderr.trim().split('\n').at(-1) ?? ''}`.trim())
    })
    createInterface({ input: proc.stdout! }).on('line', (line) => {
      try {
        this.handle(JSON.parse(line) as Msg)
      } catch {
        // not one of ours
      }
    })
    this.proc = proc
    return proc
  }

  /**
   * Compiles the helper into the data folder with swiftc, once per version of its source (the name has
   * a hash of it). macOS keeps the permissions per binary, so it's only rebuilt when the source changes.
   */
  private async build(): Promise<string> {
    const root = app.getAppPath()
    const hash = createHash('sha256')
    for (const f of SOURCES) hash.update(readFileSync(join(root, f)))
    const dir = join(app.getPath('userData'), 'listen')
    const name = `listen-${hash.digest('hex').slice(0, 10)}`
    const bin = join(dir, name)
    if (existsSync(bin)) {
      this.cleanUp(dir, name)
      return bin
    }
    this.setStatus('building', 'Getting the ears ready (compiling, about 10 seconds)…')
    mkdirSync(dir, { recursive: true })
    const tmp = `${bin}.tmp`
    await new Promise<void>((resolve, reject) => {
      execFile(
        '/usr/bin/xcrun',
        ['swiftc', '-O', join(root, SOURCES[0]), '-o', tmp, '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', join(root, SOURCES[1])],
        { timeout: 180_000 },
        (err, _out, stderr) =>
          err
            ? reject(new Error(`Voice input needs Apple's Swift compiler: run "xcode-select --install" in Terminal. (${(stderr || err.message).trim().split('\n')[0]})`))
            : resolve()
      )
    })
    renameSync(tmp, bin)
    this.cleanUp(dir, name)
    return bin
  }

  /** Older builds of the helper (each version of the source gets its own). */
  private cleanUp(dir: string, keep: string): void {
    for (const f of readdirSync(dir)) if (f !== keep) rmSync(join(dir, f), { force: true })
  }

  /**
   * A helper that stops answering (it once hung starting over after a pause) is restarted, so voice
   * input never stays deaf until Poppy restarts.
   */
  private watchAck(): void {
    if (this.ackTimer) clearTimeout(this.ackTimer)
    const proc = this.proc
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null
      if (!this.skipUntil || this.proc !== proc || !proc) return
      console.warn(`[listen] no "${this.skipUntil}" from the helper in ${ACK_MS / 1000} s: restarting it`)
      this.skipUntil = null
      this.proc = null
      this.endQuestion()
      proc.kill()
      if (this.opts.enabled) void this.begin()
    }, ACK_MS)
  }

  private send(msg: Record<string, unknown>): void {
    if (!this.proc?.stdin?.writable) return
    const after = ({ reset: 'reset', pause: 'paused', listen: 'listening' } as const)[msg.cmd as string]
    if (after) {
      this.skipUntil = after
      // Not on the first start: macOS's microphone question (or a model download) takes as long as it takes.
      if (this.started) this.watchAck()
    }
    debug('→', JSON.stringify(msg))
    this.proc.stdin.write(JSON.stringify(msg) + '\n')
  }

  private setStatus(state: ListenStatus['state'], message: string): void {
    if (state === this.status.state && message === this.status.message) return
    this.status = { state, message }
    this.on.status(this.status)
  }

  // ---------- what the helper hears ----------

  private handle(m: Msg): void {
    debug('←', JSON.stringify(m), `holds=${this.holds} skip=${this.skipUntil} q=${this.q ? JSON.stringify(this.q.text) : '-'}`)
    if (m.type === 'check') return this.checks.shift()?.(m)
    if (m.type === this.skipUntil) {
      this.skipUntil = null
      if (this.ackTimer) clearTimeout(this.ackTimer)
      this.ackTimer = null
    }
    if (m.type === 'reset') return
    if (m.type === 'note') return console.warn('[listen]', m.message)
    if (m.type === 'downloading') {
      // A language model download takes as long as it takes: no restart for that.
      if (this.ackTimer) clearTimeout(this.ackTimer)
      this.ackTimer = null
    }
    if (m.type === 'downloading') return this.setStatus('starting', `Downloading Apple's ${this.lang()} speech model (once)…`)
    if (m.type === 'error') {
      this.skipUntil = null
      return this.setStatus('error', m.message)
    }
    if (m.type === 'listening') this.started = true
    if (m.type === 'listening') return this.setStatus(this.q ? 'hearing' : 'waiting', '')
    if (m.type === 'paused') return this.setStatus(this.opts.enabled ? 'paused' : 'off', '')
    if (m.type !== 'text' || this.holds > 0 || this.skipUntil) return
    if (this.q) return this.follow(m.text, m.settled !== false)
    const after = afterWake(m.text, wakeWords(this.opts.character))
    if (after === null) {
      // No name: keep the running transcript short.
      if (Date.now() - this.resetAt > RESET_TRANSCRIPT_MS || m.text.length > 200) {
        this.resetAt = Date.now()
        this.send({ cmd: 'reset' })
      }
      return
    }
    const now = Date.now()
    this.q = { text: after, wokeAt: now, changedAt: now, settled: m.settled !== false }
    this.setStatus('hearing', '')
    if (this.opts.duckMusic) void this.ducker.duck()
    this.on.wake()
    if (after) this.on.heard(tidyQuestion(after))
    this.tick = setInterval(() => this.checkEnd(), TICK_MS)
  }

  /** The words after the name, as they come in. */
  private follow(text: string, settled: boolean): void {
    const q = this.q!
    q.settled = settled
    const own = afterWake(text, wakeWords(this.opts.character))
    if (own === null || own === q.text) return // (null: the recognizer rewrote the name for a moment)
    q.text = own
    q.changedAt = Date.now()
    this.on.heard(tidyQuestion(own))
  }

  private checkEnd(): void {
    const q = this.q
    if (!q) return
    const verdict = checkQuestion({ ...q, question: q.text, now: Date.now() })
    if (verdict === 'wait') return
    if (verdict === 'cancel') return this.cancel()
    const question = tidyQuestion(q.text)
    this.endQuestion()
    // Stop listening right away; the reply holds it from here (or it starts again if none comes).
    this.send({ cmd: 'pause' })
    this.waitReply = setTimeout(() => {
      this.waitReply = null
      if (this.holds === 0) this.resume()
    }, REPLY_START_MS)
    this.on.ask(question)
  }

  private endQuestion(): void {
    this.q = null
    if (this.tick) clearInterval(this.tick)
    this.tick = null
  }
}
