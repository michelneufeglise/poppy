/**
 * Voice learning: Apple's recognizer can't be trained on one voice, so Poppy learns how it hears the
 * user instead, from what happens around a spoken question (no audio and no transcripts are kept):
 *
 * - calls: words her name comes out as. A sentence that is just one unknown word ("Pally.") and the
 *   user opening the chat by hand right after = a missed call. A learned call word that wakes her and
 *   leads to a question counts up; one that is cancelled right away counts down (and is dropped at 0).
 *   It counts as her name from CALL_LEARNED on, only when calling (like Buddy and Body).
 * - fixes: words the recognizer gets wrong, from a question the user types again after a voice
 *   question ("weather in Utrek" → "weather in Utrecht"). Applied to what she hears from FIX_LEARNED on.
 * - typed: names the user types often (capitalized words), sent to the recognizer as expected words.
 */

export interface VoiceLearned {
  calls: Record<string, number>
  fixes: Record<string, { to: string; count: number }>
  typed: Record<string, number>
}

export const emptyLearned = (): VoiceLearned => ({ calls: {}, fixes: {}, typed: {} })

export const CALL_LEARNED = 2
export const FIX_LEARNED = 2
export const TYPED_HINT = 3
/** A missed call: the user opened the chat this soon after the lone word. */
export const MISSED_CALL_MS = 10_000
/** A retyped question: this soon after the voice question. */
export const RETYPE_MS = 60_000
const MAX_TYPED = 200
const MAX_FIXES = 200
const MAX_CALLS = 30

/** Words that stand alone in normal talk, so they never count as her name. */
const COMMON = new Set(
  (
    'yes yeah yep yup no nope nah okay ok oke alright thanks thank right sure well so oh uh um hmm hm hey hi hello bye ' +
    'what why how who when where which wait stop really exactly great good nice cool fine true maybe please sorry wow ' +
    'damn and but or because then now here there this that you me we they he she it my your our ' +
    'amazing perfect indeed definitely absolutely totally anyway whatever never always again later today tomorrow ' +
    'ja nee nou dus hoi doei wat waarom hoe goed prima echt precies klopt mooi top inderdaad zeker misschien'
  ).split(' ')
)

const WORD = /[\p{L}\p{N}']+/gu
const words = (s: string): string[] => (s.toLowerCase().match(WORD) ?? [])

/**
 * The lone word that may be a missed call: the last sentence is just one word (with "hey"/"uh" before
 * it at most) that isn't a common word or a name she already knows. "Pally." → "pally".
 */
export function callCandidate(text: string, known: string[]): string | null {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
  const last = sentences.at(-1)
  if (!last) return null
  const ws = words(last).filter((w) => !['hey', 'uh', 'um', 'oh'].includes(w))
  if (ws.length !== 1) return null
  const w = ws[0]
  if (w.length < 3 || /\d/.test(w) || COMMON.has(w) || known.includes(w)) return null
  return w
}

export function addCall(data: VoiceLearned, word: string, delta: number): void {
  const n = (data.calls[word] ?? 0) + delta
  if (n <= 0) delete data.calls[word]
  else data.calls[word] = Math.min(n, 9)
  const keys = Object.keys(data.calls)
  if (keys.length > MAX_CALLS) delete data.calls[keys.sort((a, b) => data.calls[a] - data.calls[b])[0]]
}

export const learnedCalls = (data: VoiceLearned): string[] =>
  Object.keys(data.calls).filter((w) => data.calls[w] >= CALL_LEARNED)

/** Edit distance, for "do these words look alike". */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}
/** Close enough to be the same word misheard (utrek/utrecht yes, utrecht/amsterdam no). */
export const looksAlike = (a: string, b: string): boolean => distance(a, b) / Math.max(a.length, b.length) <= 0.5

/**
 * Word swaps between what was heard and what the user then typed, when it's the same question with a
 * word or two fixed: single words that differ in the same place and look alike.
 */
export function learnFixes(heard: string, typed: string): [string, string][] {
  const a = words(heard)
  const bRaw = typed.match(WORD) ?? []
  const b = bRaw.map((w) => w.toLowerCase())
  if (a.length < 2 || Math.abs(a.length - b.length) > 2) return []
  // Longest common subsequence, then the 1-to-1 gaps between matched words.
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  if (L[0][0] / Math.max(a.length, b.length) < 0.6) return [] // a different question
  const out: [string, string][] = []
  let gapA: number[] = []
  let gapB: number[] = []
  const flush = (): void => {
    if (gapA.length === 1 && gapB.length === 1 && looksAlike(a[gapA[0]], b[gapB[0]])) out.push([a[gapA[0]], bRaw[gapB[0]]])
    gapA = []
    gapB = []
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      flush()
      i++
      j++
    } else if (L[i + 1][j] >= L[i][j + 1]) gapA.push(i++)
    else gapB.push(j++)
  }
  while (i < a.length) gapA.push(i++)
  while (j < b.length) gapB.push(j++)
  flush()
  return out
}

export function addFixes(data: VoiceLearned, pairs: [string, string][]): void {
  for (const [from, to] of pairs) {
    const old = data.fixes[from]
    data.fixes[from] = old && old.to.toLowerCase() === to.toLowerCase() ? { to, count: Math.min(old.count + 1, 9) } : { to, count: 1 }
  }
  const keys = Object.keys(data.fixes)
  if (keys.length > MAX_FIXES) for (const k of keys.sort((x, y) => data.fixes[x].count - data.fixes[y].count).slice(0, keys.length - MAX_FIXES)) delete data.fixes[k]
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** What she heard with the learned word fixes applied. */
export function applyFixes(text: string, data: VoiceLearned): string {
  let out = text
  for (const [from, fix] of Object.entries(data.fixes)) {
    if (fix.count < FIX_LEARNED) continue
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}'])${escape(from)}(?![\\p{L}\\p{N}'])`, 'giu'), fix.to)
  }
  return out
}

/** Capitalized words in a typed message (not the first word of a sentence): names, places, apps. */
export function addTyped(data: VoiceLearned, text: string): void {
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    for (const w of (sentence.match(WORD) ?? []).slice(1)) {
      if (w.length < 3 || !/^\p{Lu}/u.test(w) || w === w.toUpperCase() || COMMON.has(w.toLowerCase())) continue
      data.typed[w] = (data.typed[w] ?? 0) + 1
    }
  }
  const keys = Object.keys(data.typed)
  if (keys.length > MAX_TYPED) for (const k of keys.sort((x, y) => data.typed[x] - data.typed[y]).slice(0, keys.length - MAX_TYPED)) delete data.typed[k]
}

/** Words the recognizer should expect: her name first, then names from memory, fixes and typed names. */
export function hintsFrom(data: VoiceLearned, name: string[], memory: string[], max = 80): string[] {
  const fixed = Object.values(data.fixes).filter((f) => f.count >= FIX_LEARNED).map((f) => f.to)
  const typed = Object.keys(data.typed).filter((w) => data.typed[w] >= TYPED_HINT).sort((a, b) => data.typed[b] - data.typed[a])
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of [...name, ...fixed, ...memory, ...typed]) {
    const k = w.toLowerCase()
    if (!w.trim() || seen.has(k)) continue
    seen.add(k)
    out.push(w)
    if (out.length >= max) break
  }
  return out
}

/** For Settings: what she learned, ready to show (only what is actually used). */
export function learnedSummary(data: VoiceLearned): { calls: string[]; fixes: { from: string; to: string }[]; words: string[] } {
  return {
    calls: learnedCalls(data).sort(),
    fixes: Object.entries(data.fixes)
      .filter(([, f]) => f.count >= FIX_LEARNED)
      .map(([from, f]) => ({ from, to: f.to })),
    words: Object.keys(data.typed).filter((w) => data.typed[w] >= TYPED_HINT).sort()
  }
}
