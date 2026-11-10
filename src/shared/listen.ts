/**
 * Voice input rules, kept apart from the microphone so they can be tested: which words count as
 * Poppy's or Polly's name, where the question starts, and when it's finished.
 */
import type { Character } from './types'

/**
 * The name and the ways speech recognition tends to write it. "Holly" is how a laptop microphone often
 * comes out (heard in a live test). Very common words (like "puppy") are left out.
 */
const WAKE_WORDS: Record<Character, string[]> = {
  male: ['poppy', 'poppie', 'poppi', 'popi', 'poppey', 'popy'],
  female: ['polly', 'poly', 'pollie', 'polli', 'polley', 'pauly', 'paulie', 'holly', 'molly', 'olly']
}
/**
 * Everyday words the name also comes out as (recorded from the user's own voice: "Polly" was written
 * as Buddy, Bully, Body and Bunny more often than as Polly). They only count when the user is calling
 * her: first in a sentence and followed by a comma, full stop, question mark or nothing yet, so
 * "Body, how are you doing?" wakes her and "my body hurts" doesn't.
 */
const CALL_WORDS: Record<Character, string[]> = {
  male: [],
  female: ['buddy', 'bully', 'body', 'bunny', 'bobby', 'bolly', 'pally']
}
export interface Wake {
  /** Count anywhere. */
  names: string[]
  /** Count only when calling (see CALL_WORDS). */
  calls: string[]
}
export const wakeWords = (c: Character): Wake => ({ names: WAKE_WORDS[c], calls: CALL_WORDS[c] })
/** Words the recognizer should expect, so it writes the name the way we look for it. */
export const wakeHints = (c: Character): string[] => [c === 'female' ? 'Polly' : 'Poppy']

/**
 * How long a pause ends the question, how long to wait for one after the name, and the longest one.
 * The recognizer sends words in bursts and sometimes stops mid-sentence for a second or two (heard in
 * a live test: "Polly, tell me a" was sent), so a pause only ends the question once it has settled
 * (nothing still being guessed at); otherwise it takes UNSETTLED_SILENCE_MS.
 */
export const END_SILENCE_MS = 1500
export const UNSETTLED_SILENCE_MS = 4000
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
export function afterWake(text: string, wake: Wake): string | null {
  return findWake(text, wake)?.after ?? null
}

/** Like afterWake, plus which word woke her (to learn from how that went). */
export function findWake(text: string, wake: Wake): { word: string; after: string } | null {
  let end = -1
  let found = ''
  for (const m of text.matchAll(WORD)) {
    const word = m[0].toLowerCase()
    const after = m.index + m[0].length
    if (wake.names.includes(word) || (wake.calls.includes(word) && isCalling(text, m.index, after))) {
      end = after
      found = word
    }
  }
  if (end < 0) return null
  return { word: found, after: text.slice(end).replace(/^[\s,.!?;:—–-]+/, '').trim() }
}

/** First in its sentence ("hey", "uh", "oh"… before it are fine) and followed by , . ? ! or the end of the text. */
function isCalling(text: string, start: number, end: number): boolean {
  const before = text.slice(0, start).replace(/(\b(hey|uh|um|oh|okay|ok)\s*,?\s*)+$/i, '')
  return /(^|[.!?]["')\]]?)\s*$/.test(before) && /^\s*([,.!?]|$)/.test(text.slice(end))
}

export const isNeverMind = (q: string): boolean => NEVER_MIND.test(q.trim())

/** The first letter capital: the question as the user would have typed it. */
export const tidyQuestion = (q: string): string => {
  const t = q.trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

export type QuestionCheck = 'wait' | 'send' | 'cancel'

/** After the name: keep listening, send the question, or give up. */
export function checkQuestion(o: {
  question: string
  wokeAt: number
  changedAt: number
  now: number
  /** The recognizer has finished what it heard (false: it may still be working on the last words). */
  settled: boolean
}): QuestionCheck {
  const q = o.question.trim()
  if (!q) return o.now - o.wokeAt >= NO_QUESTION_MS ? 'cancel' : 'wait'
  const quiet = o.now - o.changedAt >= (o.settled ? END_SILENCE_MS : UNSETTLED_SILENCE_MS)
  if (isNeverMind(q) && quiet) return 'cancel'
  if (quiet || o.now - o.wokeAt >= MAX_QUESTION_MS) return 'send'
  return 'wait'
}
