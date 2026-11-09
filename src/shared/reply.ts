import { MOODS, type Mood } from './types'

/**
 * Tags the model sometimes makes up instead of one from the list, and the drawing that fits them
 * (seen: [chuckling], [chirping]). Unknown ones still give no mood.
 */
export const MOOD_ALIASES: Record<string, Mood> = {
  chuckling: 'laughing', giggling: 'laughing', amused: 'laughing', grinning: 'cheerful', smiling: 'happy',
  joyful: 'happy', delighted: 'excited', thrilled: 'excited', thoughtful: 'thinking', pondering: 'thinking',
  puzzled: 'confused', worried: 'anxious', calm: 'chilling', relaxed: 'chilling', sleepy: 'tired',
  embarrassed: 'shy', annoyed: 'grumpy', mischievous: 'sneaky', loving: 'cuddly', warm: 'cuddly',
  impressed: 'wonder', amazed: 'wonder', greeting: 'hello', waving: 'hello', goodbye: 'bye', sorry: 'sad',
  helpful: 'happy', friendly: 'happy', neutral: 'idle'
}
const MOOD_TAG = new RegExp(`\\[(${[...MOODS, ...Object.keys(MOOD_ALIASES)].join('|')})\\]`, 'gi')
const MOOD_TAGS = new RegExp(`\\s*\\[(${MOODS.join('|')})\\]\\s*`, 'gi')

/**
 * The reply body with thinking and mood tags removed, but markdown kept
 * (the voice needs it to spot code blocks and tables).
 * - removes <think>…</think> blocks, including one that is still open
 * - reads the mood tag, like [happy], and removes all mood tags; with more than one (a reply after a
 *   tool round starts with its own tag) the last one counts: "[curious] Let me look… [happy] It's sunny!"
 *   is a happy answer
 * - hides a tag that is only half streamed so far, like "[hap"
 */
export function splitReply(raw: string): { body: string; mood: Mood | null } {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const openThink = s.search(/<think>/i)
  if (openThink !== -1) s = s.slice(0, openThink)

  const match = [...s.matchAll(MOOD_TAG)].at(-1)
  const tag = match?.[1].toLowerCase()
  const mood = tag ? (MOOD_ALIASES[tag] ?? (tag as Mood)) : null

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
