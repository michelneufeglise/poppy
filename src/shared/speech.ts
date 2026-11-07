/**
 * Turning a reply into text worth saying:
 * the clean-up rules, the stopword language detection and the word caps.
 */
import type { SpeechLang } from './types'

export const CODE_SENTENCE = 'There is a code block on screen.'
export const TABLE_SENTENCE = 'There is a table on screen.'
const DUTCH_PLACEHOLDERS: Record<string, string> = {
  [CODE_SENTENCE]: 'Er staat een codeblok in de chat.',
  [TABLE_SENTENCE]: 'Er staat een tabel in de chat.'
}

/** Below this many words Poppy reads everything. */
export const READ_ALONG_WORDS = 40
/** A rest this short is just read out instead of summarized. */
export const SHORT_REST_WORDS = 20
/** Never speak more than this from the summary. */
export const SUMMARY_CAP_WORDS = 45

const FENCE_LINE = /^[ \t]*(```|~~~)/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g
const LINK = /\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g
const AUTOLINK = /<(?:https?|ftp|mailto):[^>\s]+>/gi
const URL = /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>()[\]]+/gi
const CITATION = /\[\^?\d+(?:\s*[,;–-]\s*\^?\d+)*\]|【[^】]*】|\[(?:source|src|ref|doc|citation)[\s:#]*\d*[^\]]{0,40}\]/gi
const HTML_TAG = /<\/?[a-zA-Z][^>]{0,200}>/g
const INLINE_CODE = /`([^`\n]*)`/g
const HEADING = /^\s{0,3}#{1,6}\s+/
const BULLET = /^\s*(?:[-*+•]|\d{1,3}[.)])\s+/
const TASKBOX = /^\[[ xX]\]\s+/
const QUOTE = /^\s*>+\s?/
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍️⃣]/gu
const END_PUNCT = /[.!?:;…]$/

function stripInline(line: string): string {
  let s = line
    .replace(IMAGE, '$1')
    .replace(LINK, '$1')
    .replace(AUTOLINK, '')
    .replace(URL, '')
    .replace(CITATION, '')
    .replace(HTML_TAG, ' ')
    .replace(INLINE_CODE, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, '$1')
    .replace(/(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s*(?:->|=>|→|⇒)\s*/g, ', ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(EMOJI, '')
    .replace(/[ \t]+/g, ' ')
  // tidy punctuation left behind by removed tokens
  s = s
    .replace(/\(\s*[,;:]?\s*\)/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])\1+/g, '$1')
  return s.trim()
}

/**
 * The reply as it should be spoken, line by line, so it can be cut into sentences while it streams.
 * Code blocks and tables become one short sentence each; links, URLs, citations, markdown and emoji go.
 * Works line by line, so text that is already spoken keeps the same offsets as more streams in.
 */
export function speechView(body: string): string {
  const out: string[] = []
  let inFence = false
  let inTable = false
  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    if (FENCE_LINE.test(raw)) {
      if (!inFence) out.push(CODE_SENTENCE)
      inFence = !inFence
      inTable = false
      continue
    }
    if (inFence) continue
    if (TABLE_ROW.test(raw)) {
      if (!inTable) out.push(TABLE_SENTENCE)
      inTable = true
      continue
    }
    inTable = false
    if (!raw.trim() || HR.test(raw)) {
      out.push('')
      continue
    }
    const isHeading = HEADING.test(raw)
    const isItem = BULLET.test(raw)
    let line = raw.replace(HEADING, '').replace(QUOTE, '').replace(BULLET, '').replace(TASKBOX, '')
    line = stripInline(line)
    line = line.replace(/\s*\|\s*/g, ', ').replace(/^[ ,]+|[ ,]+$/g, '')
    if (!line || !/[\p{L}\p{N}]/u.test(line)) {
      out.push('')
      continue
    }
    if ((isHeading || isItem) && !END_PUNCT.test(line)) line += '.'
    out.push(line)
  }
  return out.join('\n')
}

/** Dutch wording for the code/table placeholder sentences. */
export function localize(sentence: string, lang: SpeechLang): string {
  return lang === 'nl' ? (DUTCH_PLACEHOLDERS[sentence] ?? sentence) : sentence
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** Keep whole sentences up to `max` words; hard-cut a single overlong one. */
export function capWords(text: string, max: number): string {
  const sentences = text.trim().split(/(?<=[.!?…])\s+/).filter(Boolean)
  const out: string[] = []
  let n = 0
  for (const s of sentences) {
    const w = wordCount(s)
    if (n + w > max) break
    out.push(s)
    n += w
  }
  if (out.length) return out.join(' ')
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  const cut = words.slice(0, max).join(' ').replace(/[,;:—-]+$/, '')
  return /[.!?:;…]$/.test(cut) ? cut : `${cut}…`
}

const STOPWORDS: Record<string, Set<string>> = {
  en: new Set(['the', 'and', 'is', 'are', 'you', 'of', 'to', 'that', 'with', 'for', 'this', 'it']),
  nl: new Set(['de', 'het', 'een', 'en', 'is', 'van', 'je', 'dat', 'niet', 'met', 'voor', 'op', 'zijn', 'ook', 'wat']),
  de: new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'sie', 'ein', 'eine', 'auch', 'für', 'zu', 'ich']),
  fr: new Set(['le', 'la', 'les', 'et', 'est', 'des', 'une', 'pour', 'que', 'pas', 'vous', 'avec', 'dans', 'du']),
  es: new Set(['el', 'la', 'los', 'las', 'y', 'es', 'que', 'para', 'una', 'con', 'por', 'del', 'no', 'se'])
}

/** Language by stopword counts, only when there's enough text to be sure. */
export function detectLanguage(text: string): string | null {
  const words = (text.toLowerCase().match(/[a-zà-öø-ÿ]+/g) ?? []).slice(0, 600)
  if (words.length < 8) return null
  const scores = Object.entries(STOPWORDS).map(([lang, sw]) => [lang, words.filter((w) => sw.has(w)).length] as const)
  scores.sort((a, b) => b[1] - a[1])
  const [best, score] = scores[0]
  if (score < 3) return null
  return score >= 1.3 * Math.max(scores[1][1], 1) ? best : null
}

/** Typical Dutch words that are rare in English, for short texts where detectLanguage can't decide. */
const DUTCH_HINTS = new Set([
  'ik', 'je', 'jij', 'het', 'een', 'niet', 'wat', 'hoe', 'ook', 'zijn', 'van', 'voor', 'met', 'maar', 'wel',
  'heb', 'hebt', 'heeft', 'ben', 'bent', 'kan', 'kun', 'wil', 'graag', 'dank', 'bedankt', 'hoi', 'hallo',
  'goed', 'goedemorgen', 'ja', 'nee', 'mij', 'jou', 'jouw', 'mijn', 'dit', 'deze', 'die', 'dat', 'nog',
  'leuk', 'fijn', 'even', 'waar', 'waarom', 'welke', 'dag', 'vandaag', 'morgen', 'zeker', 'natuurlijk'
])
const ENGLISH_HINTS = new Set([
  'i', 'you', 'the', 'a', 'is', 'are', 'what', 'how', 'not', 'and', 'with', 'for', 'my', 'your', 'this',
  'that', 'can', 'do', 'it', 'hi', 'hello', 'thanks', 'yes', 'no', 'sure', 'of', 'to', 'in', 'on', 'today'
])

/**
 * Which voice language to use for a reply: Dutch or English.
 * Looks at the reply so far, then the user's message, then falls back to the previous reply's language.
 */
export function pickLanguage(reply: string, userText: string, previous: SpeechLang = 'en'): SpeechLang {
  for (const text of [reply, `${userText} ${reply}`]) {
    const lang = detectLanguage(text)
    if (lang) return lang === 'nl' ? 'nl' : 'en'
  }
  const words = `${userText} ${reply}`.toLowerCase().match(/[a-zà-öø-ÿ]+/g) ?? []
  const nl = words.filter((w) => DUTCH_HINTS.has(w)).length
  const en = words.filter((w) => ENGLISH_HINTS.has(w)).length
  if (nl >= 2 && nl > en) return 'nl'
  if (en >= 2 && en > nl) return 'en'
  return previous
}

const FILLER =
  /^(?:(?:great|good|excellent|nice)\s+(?:question|advice|plan|idea)[!.]\s*|sure[!,.]\s*|here(?:'s|’s| is) (?:a |the )?(?:short |brief |spoken )?(?:summary|version)[^:.!]*[:.!]\s*)+/i

/** Tidy the summary model's output. */
export function tidySummary(raw: string): string {
  let s = raw.trim().replace(/^["“”']+|["“”']+$/g, '').trim()
  s = s.replace(/^(?:spoken(?: version| wrap-up)?|summary|wrap-up)\s*:\s*/i, '')
  s = s.replace(FILLER, '').trim()
  s = speechView(s).replace(/\s+/g, ' ').trim()
  return s ? capWords(s, SUMMARY_CAP_WORDS) : ''
}
