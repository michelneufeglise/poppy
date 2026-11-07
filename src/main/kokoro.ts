import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { constants, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { KokoroStatus } from '../shared/types'

const MODEL_FILES = ['kokoro-v1.0.onnx', 'voices-v1.0.bin']
/**
 * Optional: a folder that already holds the model files (POPPY_KOKORO_DIR). They are copied once;
 * without it the sidecar downloads them from the kokoro-onnx releases on GitHub.
 */
const OWN_COPY_DIR = process.env.POPPY_KOKORO_DIR
const PYTHONS = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3']
const RESTART_AFTER_MS = 30_000

interface Pending {
  resolve: (path: string) => void
  reject: (err: Error) => void
  out: string
}

/**
 * Talks to sidecar/kokoro_tts.py, which keeps Kokoro loaded and turns one sentence at a time into a WAV file.
 * Emits 'status' with a KokoroStatus whenever the state changes.
 */
export class Kokoro extends EventEmitter {
  status: KokoroStatus = { state: 'off', message: '' }
  private proc: ChildProcess | null = null
  private ready: Promise<boolean> | null = null
  private pending = new Map<number, Pending>()
  private seq = 0
  private failedAt = 0
  private tmp: string | null = null

  /** Starts the sidecar if it isn't running. Resolves true once Kokoro is ready. */
  start(): Promise<boolean> {
    if (this.ready) return this.ready
    if (this.status.state === 'error' && Date.now() - this.failedAt < RESTART_AFTER_MS) return Promise.resolve(false)
    this.ready = this.launch().catch((err: Error) => {
      this.fail(err.message)
      return false
    })
    return this.ready
  }

  /** Turns text into a WAV file and returns its path. The caller deletes the file. */
  async synth(text: string, voice: string, speed: number): Promise<string> {
    if (!(await this.start()) || !this.proc?.stdin) throw new Error(this.status.message || 'Kokoro is not available')
    const id = ++this.seq
    const out = join(this.tempDir(), `s${id}.wav`)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, out })
      this.proc!.stdin!.write(JSON.stringify({ id, text, voice, speed, out }) + '\n')
    })
  }

  shutdown(): void {
    const proc = this.proc
    this.proc = null
    this.ready = null
    proc?.kill()
    this.rejectAll('Kokoro stopped')
    if (this.tmp) rmSync(this.tmp, { recursive: true, force: true })
    this.tmp = null
  }

  private async launch(): Promise<boolean> {
    const python = PYTHONS.find((p) => existsSync(p))
    if (!python) throw new Error('Python 3 is not installed (looked in Homebrew and /usr/bin).')
    const modelDir = join(app.getPath('userData'), 'kokoro')
    await this.copyOwnFiles(modelDir)

    this.setStatus('starting', 'Loading Kokoro…')
    const script = join(app.getAppPath(), 'sidecar/kokoro_tts.py')
    const proc = spawn(python, ['-u', script, modelDir], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc

    return new Promise<boolean>((resolve, reject) => {
      let settled = false
      const lines = createInterface({ input: proc.stdout! })
      lines.on('line', (line) => {
        let msg: { event?: string; error?: string; id?: number; ok?: boolean }
        try {
          msg = JSON.parse(line)
        } catch {
          return
        }
        if (msg.event === 'downloading') this.setStatus('downloading', 'Downloading the Kokoro voice (about 350 MB)…')
        else if (msg.event === 'ready') {
          this.setStatus('ready', 'Kokoro is ready.')
          settled = true
          resolve(true)
        } else if (msg.event === 'error') {
          settled = true
          reject(new Error(msg.error ?? 'Kokoro failed to start'))
        } else if (typeof msg.id === 'number') {
          const job = this.pending.get(msg.id)
          if (!job) return
          this.pending.delete(msg.id)
          if (msg.ok) job.resolve(job.out)
          else job.reject(new Error(msg.error ?? 'Kokoro failed'))
        }
      })
      proc.stderr?.on('data', (d: Buffer) => console.log('[kokoro]', d.toString().trim()))
      proc.on('error', (err) => {
        if (!settled) reject(err)
      })
      proc.on('exit', (code) => {
        if (this.proc !== proc) return
        this.proc = null
        this.ready = null
        this.rejectAll('Kokoro stopped')
        if (!settled) reject(new Error(`Kokoro stopped while starting (exit ${code})`))
        else if (this.status.state === 'ready') this.fail(`Kokoro stopped unexpectedly (exit ${code})`)
      })
    })
  }

  private async copyOwnFiles(modelDir: string): Promise<void> {
    mkdirSync(modelDir, { recursive: true })
    if (!OWN_COPY_DIR) return
    for (const name of MODEL_FILES) {
      const target = join(modelDir, name)
      if (bigFile(target)) continue
      const source = join(OWN_COPY_DIR, name)
      if (!bigFile(source)) continue // the sidecar downloads it instead
      this.setStatus('copying', 'Copying the Kokoro voice files…')
      // On APFS this is a clone: instant and no extra disk space until one copy changes.
      await copyFile(source, `${target}.part`, constants.COPYFILE_FICLONE)
      renameSync(`${target}.part`, target)
    }
  }

  private tempDir(): string {
    if (!this.tmp || !existsSync(this.tmp)) this.tmp = mkdtempSync(join(tmpdir(), 'poppy-voice-'))
    return this.tmp
  }

  private rejectAll(reason: string): void {
    for (const job of this.pending.values()) job.reject(new Error(reason))
    this.pending.clear()
  }

  private fail(message: string): void {
    console.error('Kokoro:', message)
    this.failedAt = Date.now()
    this.ready = null
    this.setStatus('error', message)
  }

  private setStatus(state: KokoroStatus['state'], message: string): void {
    this.status = { state, message }
    this.emit('status', this.status)
  }
}

function bigFile(path: string): boolean {
  try {
    return statSync(path).size > 1_000_000
  } catch {
    return false
  }
}
