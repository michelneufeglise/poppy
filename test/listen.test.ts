import { describe, expect, it } from 'vitest'
import {
  afterWake,
  checkQuestion,
  END_SILENCE_MS,
  isNeverMind,
  MAX_QUESTION_MS,
  NO_QUESTION_MS,
  tidyQuestion,
  wakeWords
} from '../src/shared/listen'

const polly = wakeWords('female')
const poppy = wakeWords('male')

describe('voice input', () => {
  it('finds the name and takes the question after it', () => {
    expect(afterWake("Polly, what's the weather in Utrecht?", polly)).toBe("what's the weather in Utrecht?")
    expect(afterWake('hey polly play some jazz', polly)).toBe('play some jazz')
    expect(afterWake('Poly.', polly)).toBe('')
    expect(afterWake("I think we'll go now", polly)).toBeNull()
    expect(afterWake('Polly', poppy)).toBeNull()
    expect(afterWake('Poppy how are you', poppy)).toBe('how are you')
    // Not inside other words, and the last mention counts.
    expect(afterWake('Pollyanna is a film', polly)).toBeNull()
    expect(afterWake('Polly no wait. Polly, set a timer', polly)).toBe('set a timer')
  })

  it('sends after a short pause, waits for a question, and gives up when none comes', () => {
    const at = (question: string, sinceWake: number, sinceChange: number) =>
      checkQuestion({ question, wokeAt: 0, changedAt: sinceWake - sinceChange, now: sinceWake })
    expect(at('', 2000, 2000)).toBe('wait')
    expect(at('', NO_QUESTION_MS, NO_QUESTION_MS)).toBe('cancel')
    expect(at('what time is it', 3000, 500)).toBe('wait')
    expect(at('what time is it', 3000, END_SILENCE_MS)).toBe('send')
    expect(at('a very long story', MAX_QUESTION_MS, 100)).toBe('send')
    expect(at('never mind', 3000, END_SILENCE_MS)).toBe('cancel')
  })

  it('knows "never mind" in English and Dutch, and tidies the question', () => {
    expect(isNeverMind('Never mind.')).toBe(true)
    expect(isNeverMind('laat maar')).toBe(true)
    expect(isNeverMind('never mind the weather, play music')).toBe(false)
    expect(tidyQuestion("  what's up")).toBe("What's up")
  })
})
