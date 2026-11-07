import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { unlink } from 'node:fs'
import type { VoiceInfo } from '../shared/types'
import type { Kokoro } from './kokoro'

/** How many sentences Kokoro prepares ahead of the one playing (Persephone's PREFETCH). */
const PREFETCH = 2
/** Give up on Kokoro for a sentence after this long and say it with the Mac voice instead. */
const KOKORO_WAIT_MS = 20_000

export interface Speech {
  text: string
  /** Kokoro voice id, or null to use macOS `say`. */
  kokoroVoice: string | null
  kokoroSpeed: number
  /** macOS voice; also the fallback when Kokoro fails. Empty means the system voice. */
  macVoice: string
  rate: number
}

interface Item extends Speech {
  wav?: Promise<string | null>
}

/**
 * Speaks sentences in order. Kokoro sentences are turned into audio a few ahead,
 * so there are no gaps; they play with `afplay`. Mac voice sentences use `say`.
 * Emits 'speaking' (true/false) and 'idle'.
 */
export class Voice extends EventEmitter {
  private queue: Item[] = []
  private proc: ChildProcess | null = null
  private active = false
  private gen = 0

  constructor(private kokoro: Kokoro) {
    super()
  }

  get busy(): boolean {
    return this.active || this.queue.length > 0
  }

  speak(speech: Speech): void {
    const text = speech.text.replace(/\s+/g, ' ').trim()
    if (!text) return
    this.queue.push({ ...speech, text })
    this.prefetch()
    if (!this.active) void this.next()
  }

  stop(): void {
    this.gen++
    for (const item of this.queue) discard(item.wav)
    this.queue = []
    this.active = false
    if (this.proc) {
      this.proc.removeAllListeners('exit')
      this.proc.kill()
      this.proc = null
    }
    this.emit('speaking', false)
    this.emit('idle')
  }

  /** Resolves once everything queued has been spoken (or speech was stopped). */
  whenIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve()
    return new Promise((resolve) => this.once('idle', resolve))
  }

  private prefetch(): void {
    for (const item of this.queue.slice(0, PREFETCH + 1)) {
      if (item.kokoroVoice && !item.wav) item.wav = this.render(item)
    }
  }

  private render(item: Item): Promise<string | null> {
    const job = this.kokoro.synth(item.text, item.kokoroVoice!, item.kokoroSpeed)
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), KOKORO_WAIT_MS)))
    const result = job.then(
      (path) => path,
      (err: Error) => {
        console.warn('Kokoro sentence failed, using the Mac voice:', err.message)
        return null
      }
    )
    return Promise.race([result, timeout]).then((path) => {
      clearTimeout(timer)
      if (!path) discard(result) // a late file still gets cleaned up
      return path
    })
  }

  private async next(): Promise<void> {
    const gen = this.gen
    const item = this.queue.shift()
    if (!item) {
      this.active = false
      this.emit('speaking', false)
      this.emit('idle')
      return
    }
    this.active = true
    if (item.kokoroVoice && !item.wav) item.wav = this.render(item)
    this.prefetch()

    const wav = item.wav ? await item.wav : null
    if (gen !== this.gen) {
      if (wav) unlink(wav, () => {})
      return
    }
    const proc = wav ? spawn('afplay', [wav], { stdio: 'ignore' }) : spawn('say', sayArgs(item), { stdio: 'ignore' })
    this.proc = proc
    this.emit('speaking', true)
    const done = (): void => {
      if (wav) unlink(wav, () => {})
      if (this.proc !== proc) return
      this.proc = null
      void this.next()
    }
    proc.on('exit', done)
    proc.on('error', done)
  }
}

function sayArgs(item: Speech): string[] {
  const args = ['-r', String(item.rate)]
  if (item.macVoice) args.push('-v', item.macVoice)
  args.push('--', item.text)
  return args
}

function discard(wav: Promise<string | null> | undefined): void {
  void wav?.then((path) => path && unlink(path, () => {}))
}

/** Voices installed on this Mac, from `say -v ?`. */
export function listVoices(): Promise<VoiceInfo[]> {
  return new Promise((resolve) => {
    execFile('say', ['-v', '?'], (err, stdout) => {
      if (err) return resolve([])
      const voices: VoiceInfo[] = []
      for (const line of stdout.split('\n')) {
        const m = line.match(/^(.+?)\s{2,}([a-z]{2,3}[_-][A-Za-z0-9]+)\s+#/)
        if (m) voices.push({ name: m[1].trim(), lang: m[2] })
      }
      resolve(voices)
    })
  })
}
