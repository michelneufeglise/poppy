import { describe, expect, it } from 'vitest'
import {
  addCall,
  addFixes,
  addTyped,
  applyFixes,
  callCandidate,
  emptyLearned,
  hintsFrom,
  learnFixes,
  learnedCalls,
  learnedSummary
} from '../src/shared/voicelearn'

describe('voice learning', () => {
  it('spots a lone word that may be a missed call', () => {
    expect(callCandidate("That's the music. Pally.", ['polly'])).toBe('pally')
    expect(callCandidate('Hey, Bolly', [])).toBe('bolly')
    expect(callCandidate('Okay.', [])).toBeNull()
    expect(callCandidate('Polly.', ['polly'])).toBeNull()
    expect(callCandidate('I think so.', [])).toBeNull()
  })

  it('learns a call word after two missed calls and forgets it when it misfires', () => {
    const d = emptyLearned()
    addCall(d, 'pally', 1)
    expect(learnedCalls(d)).toEqual([])
    addCall(d, 'pally', 1)
    expect(learnedCalls(d)).toEqual(['pally'])
    addCall(d, 'pally', -1)
    addCall(d, 'pally', -1)
    expect(d.calls.pally).toBeUndefined()
  })

  it('learns word fixes from a retyped question, only for words that look alike', () => {
    expect(learnFixes("What's the weather in Utrek tomorrow?", "What's the weather in Utrecht tomorrow?")).toEqual([['utrek', 'Utrecht']])
    expect(learnFixes("What's the weather in Utrecht tomorrow?", "What's the weather in Amsterdam tomorrow?")).toEqual([])
    expect(learnFixes('Play some jazz', 'What time is it in Tokyo right now?')).toEqual([])
    const d = emptyLearned()
    addFixes(d, [['utrek', 'Utrecht']])
    expect(applyFixes('weather in utrek', d)).toBe('weather in utrek') // once isn't enough
    addFixes(d, [['utrek', 'Utrecht']])
    expect(applyFixes('Weather in Utrek tomorrow', d)).toBe('Weather in Utrecht tomorrow')
    expect(applyFixes('Utrekking', d)).toBe('Utrekking') // whole words only
  })

  it('collects typed names as hints, with her name and memory first', () => {
    const d = emptyLearned()
    for (let i = 0; i < 3; i++) addTyped(d, 'Can you ask Sara about the Spotify playlist? Thanks.')
    addTyped(d, 'What about Bob.')
    expect(d.typed.Sara).toBe(3)
    expect(d.typed.Can).toBeUndefined() // first word of a sentence
    expect(hintsFrom(d, ['Polly'], ['Utrecht', 'sara'])).toEqual(['Polly', 'Utrecht', 'sara', 'Spotify'])
    expect(learnedSummary(d).words).toEqual(['Sara', 'Spotify'])
  })
})
