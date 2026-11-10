import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  addCall,
  addFixes,
  addTyped,
  emptyLearned,
  hintsFrom,
  learnFixes,
  learnedSummary,
  type VoiceLearned
} from '../shared/voicelearn'

export type LearnedKind = 'call' | 'fix' | 'word'

/**
 * What voice learning knows (shared/voicelearn.ts), in userData/voice-learned.json: learned words and
 * counts only, never audio or transcripts. Saved a moment after each change.
 */
export class VoiceStore {
  data: VoiceLearned = emptyLearned()
  private timer: NodeJS.Timeout | null = null
  onChange: () => void = () => {}

  // (Resolved late: POPPY_DATA_DIR moves the data folder after this module loads.)
  private get file(): string {
    return join(app.getPath('userData'), 'voice-learned.json')
  }

  /** Reads the file; call once the app is ready. */
  load(): void {
    try {
      if (existsSync(this.file)) this.data = { ...emptyLearned(), ...JSON.parse(readFileSync(this.file, 'utf8')) }
    } catch {
      this.data = emptyLearned() // a broken file: start over
    }
  }

  call(word: string, delta: number): void {
    addCall(this.data, word, delta)
    this.changed()
  }

  fixesFrom(heard: string, typed: string): void {
    const pairs = learnFixes(heard, typed)
    if (!pairs.length) return
    addFixes(this.data, pairs)
    this.changed()
  }

  typed(text: string): void {
    addTyped(this.data, text)
    this.changed()
  }

  hints(name: string[], memory: string[]): string[] {
    return hintsFrom(this.data, name, memory)
  }

  summary(): ReturnType<typeof learnedSummary> {
    return learnedSummary(this.data)
  }

  forget(kind: LearnedKind, key: string): void {
    if (kind === 'call') delete this.data.calls[key]
    if (kind === 'fix') delete this.data.fixes[key]
    if (kind === 'word') delete this.data.typed[key]
    this.changed()
  }

  forgetAll(): void {
    this.data = emptyLearned()
    this.changed()
  }

  private changed(): void {
    this.onChange()
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.save()
    }, 1000)
  }

  save(): void {
    try {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 })
      renameSync(tmp, this.file)
    } catch (err) {
      console.warn('[listen] could not save what voice learning knows:', err)
    }
  }
}
