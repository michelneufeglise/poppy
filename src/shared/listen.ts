/**
 * Voice input rules, kept apart from the microphone so they can be tested: which words count as
 * Poppy's or Polly's name, where the question starts, and when it's finished.
 */
import type { Character } from './types'

/** The name and the ways speech recognition tends to write it. Ordinary words (puppy, holly) are left out. */
const WAKE_WORDS: Record<Character, string[]> = {
  male: ['poppy', 'poppie', 'poppi', 'popi', 'poppey'],
  female: ['polly', 'poly', 'pollie', 'polli', 'pauly', 'paulie', 'molly']
}
export const wakeWords = (c: Character): string[] => WAKE_WORDS[c]

/** How long a pause ends the question, how long to wait for one after the name, and the longest one. */
export const END_SILENCE_MS = 1500
export const NO_QUESTION_MS = 8000
export const MAX_QUESTION_MS = 30_000
/** Without the name, the running transcript is started over after this long (keeps it short and fast). */
export const RESET_TRANSCRIPT_MS = 40_000
/** Saying just this after the name cancels. */
const NEVER_MIND = /^(never ?mind|cancel|stop|forget it|nothing|laat maar|niks|niets|stop maar)[.!?]*$/i

const WORD = /[\p{L}\p{N}']+/gu

/**
 * Finds the name in a transcript. Returns what comes after it (the question so far, without the
 * comma or "hey" around the name), or null when the name isn't there. The last mention counts, so
 * "Polly ... Polly, what time is it" starts at the second one.
 */
export function afterWake(text: string, words: string[]): string | null {
  let end = -1
  for (const m of text.matchAll(WORD)) {
    if (words.includes(m[0].toLowerCase())) end = m.index + m[0].length
  }
  if (end < 0) return null
  return text.slice(end).replace(/^[\s,.!?;:—–-]+/, '').trim()
}

export const isNeverMind = (q: string): boolean => NEVER_MIND.test(q.trim())

/** The first letter capital: the question as the user would have typed it. */
export const tidyQuestion = (q: string): string => {
  const t = q.trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

export type QuestionCheck = 'wait' | 'send' | 'cancel'

/** After the name: keep listening, send the question, or give up. */
export function checkQuestion(o: { question: string; wokeAt: number; changedAt: number; now: number }): QuestionCheck {
  const q = o.question.trim()
  if (!q) return o.now - o.wokeAt >= NO_QUESTION_MS ? 'cancel' : 'wait'
  if (isNeverMind(q) && o.now - o.changedAt >= END_SILENCE_MS) return 'cancel'
  if (o.now - o.changedAt >= END_SILENCE_MS || o.now - o.wokeAt >= MAX_QUESTION_MS) return 'send'
  return 'wait'
}
