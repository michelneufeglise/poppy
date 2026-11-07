import { parseReply } from '../shared/reply'
import { tidySummary, SUMMARY_CAP_WORDS } from '../shared/speech'
import type { SpeechLang } from '../shared/types'
import type { Brain } from './brain'

/** If the wrap-up takes longer than this, Poppy says the fallback line instead. */
const TIMEOUT_MS = 8000

const FALLBACK: Record<SpeechLang, string> = {
  en: 'The rest is in the chat.',
  nl: 'De rest staat in de chat.'
}

/** Poppy has already read the start out loud; the model sums up the rest. */
const SYSTEM = `You turn the rest of a written answer into a very short SPOKEN wrap-up for text-to-speech.
You are not replying to the answer: you ARE Poppy, who wrote it, and you already said the first part out loud.
Rules:
- 1 or 2 short sentences, at most ${SUMMARY_CAP_WORDS - 10} words in total.
- Only the main point of the rest; skip details, lists, steps and examples. Don't repeat what was already said.
- Write in the SAME LANGUAGE as the written answer.
- Plain spoken sentences only: no markdown, bullets, headings, emoji or mood tags.
- No greeting and no filler like "Sure" or "Here's a summary".`

/** A short spoken version of the part Poppy didn't read out. Never throws. */
export async function spokenWrapUp(opts: {
  brain: Brain
  said: string
  rest: string
  lang: SpeechLang
  signal: AbortSignal
}): Promise<string> {
  const langName = opts.lang === 'nl' ? 'Dutch' : 'English'
  const user = `Already said out loud:\n"""\n${opts.said}\n"""\n\nThe rest of the written answer:\n"""\n${opts.rest.slice(0, 9000)}\n"""\n\nSpoken wrap-up, in ${langName}:`
  try {
    const raw = await opts.brain.ask(SYSTEM, user, {
      maxTokens: 120,
      temperature: 0.2,
      signal: AbortSignal.any([opts.signal, AbortSignal.timeout(TIMEOUT_MS)])
    })
    return tidySummary(parseReply(raw).text) || FALLBACK[opts.lang]
  } catch (err) {
    if (opts.signal.aborted) return ''
    console.warn('spoken wrap-up failed:', err instanceof Error ? err.message : err)
    return FALLBACK[opts.lang]
  }
}
