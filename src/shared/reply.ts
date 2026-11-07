import { MOODS, type Mood } from './types'

const MOOD_TAG = new RegExp(`\\[(${MOODS.join('|')})\\]`, 'i')
const MOOD_TAGS = new RegExp(`\\s*\\[(${MOODS.join('|')})\\]\\s*`, 'gi')

/**
 * The reply body with thinking and mood tags removed, but markdown kept
 * (the voice needs it to spot code blocks and tables).
 * - removes <think>…</think> blocks, including one that is still open
 * - reads the first mood tag, like [happy], and removes all mood tags
 * - hides a tag that is only half streamed so far, like "[hap"
 */
export function splitReply(raw: string): { body: string; mood: Mood | null } {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const openThink = s.search(/<think>/i)
  if (openThink !== -1) s = s.slice(0, openThink)

  const match = s.match(MOOD_TAG)
  const mood = match ? (match[1].toLowerCase() as Mood) : null

  s = s.replace(MOOD_TAGS, ' ')
  s = s.replace(/(^|\n)[ \t]*\[[a-z-]+\][ \t]*/gi, '$1') // an invented tag at the start (or after a tool round)
  s = s.replace(/\[[a-z-]{0,14}$/i, '') // a tag that's still streaming in
  // The whole reply wrapped in brackets ("[I am happy to help! …]"): a mood tag gone wrong.
  const wrapped = s.trim().match(/^\[([^[\]]{12,})\]?$/)
  if (wrapped) s = wrapped[1]
  return { body: s.trimStart(), mood }
}

/**
 * Turn the raw (possibly half-streamed) model output into what Poppy shows.
 * Same as splitReply, plus markdown symbols and emoji removed.
 */
export function parseReply(raw: string): { text: string; mood: Mood | null } {
  const { body, mood } = splitReply(raw)
  let s = body.replace(/\*\*|__|`+/g, '').replace(/^#+\s*/gm, '')
  s = s.replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u200D\uFE0F]/gu, '') // emoji would be read out loud
  s = s.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/, '').trimStart()
  return { text: s, mood }
}

/**
 * Cut finished sentences out of a growing text, starting at `from`.
 * With `final`, the unfinished rest is returned too.
 */
export function takeSentences(
  text: string,
  from: number,
  final: boolean
): { parts: string[]; next: number } {
  const parts: string[] = []
  const re = /[.!?…]+["')\]]?\s+|\n+/g
  re.lastIndex = from
  let start = from
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length
    const part = text.slice(start, end).trim()
    if (part) parts.push(part)
    start = end
  }
  if (final) {
    const rest = text.slice(start).trim()
    if (rest) parts.push(rest)
    start = text.length
  }
  return { parts, next: start }
}
