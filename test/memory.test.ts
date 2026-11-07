import { describe, expect, it } from 'vitest'
import {
  asksWhatPoppyKnows,
  buildMemoryNote,
  cosine,
  firstJsonObject,
  fromBlob,
  isForgetRequest,
  keywordScore,
  looksLikeCorrection,
  norm,
  parseExtraction,
  parseNotebook,
  sameMemory,
  toBlob,
  topMatches
} from '../src/shared/memory'

describe('reading the learner model', () => {
  it('finds JSON inside a code fence or chatter', () => {
    expect(firstJsonObject('Sure!\n```json\n{"a": {"b": "}"}}\n```')).toEqual({ a: { b: '}' } })
    expect(firstJsonObject('no json here')).toBeNull()
    expect(firstJsonObject('{"broken": ')).toBeNull()
  })

  it('keeps good facts, entities and relations and drops junk', () => {
    const raw = JSON.stringify({
      facts: [
        { text: 'The user works at Acme as a designer.', kind: 'about' },
        { text: 'The user works at Acme as a designer.', kind: 'about' },
        { text: 'hi', kind: 'about' },
        { text: 'The user loves hiking in the Alps.', kind: 'weird' },
        'not an object'
      ],
      entities: [{ name: 'Acme', type: 'organization' }, { name: 'Alps', type: 'mountains' }, { name: '' }],
      relations: [
        { from: 'the user', type: 'Works At', to: 'Acme' },
        { from: 'Acme', type: 'is', to: 'acme' }
      ],
      outdated: [3, 99, 'x'],
      lesson: 'Keep answers about code short.'
    })
    const x = parseExtraction(raw, [3, 4])
    expect(x.facts).toEqual([
      { text: 'The user works at Acme as a designer.', kind: 'about' },
      { text: 'The user loves hiking in the Alps.', kind: 'other' }
    ])
    expect(x.entities).toEqual([
      { name: 'Acme', type: 'organization' },
      { name: 'Alps', type: 'thing' }
    ])
    expect(x.relations).toEqual([{ from: 'the user', type: 'works_at', to: 'Acme' }])
    expect(x.outdated).toEqual([3])
    expect(x.lesson).toBe('Keep answers about code short.')
  })

  it('returns nothing for a broken reply', () => {
    expect(parseExtraction('I could not do that')).toEqual({ facts: [], entities: [], relations: [], outdated: [], lesson: null })
  })

  it('reads the notebook rules', () => {
    expect(parseNotebook('{"rules":["Be brief.","be brief","Short","Use short sentences when explaining code.", 5]}')).toEqual([
      'Be brief.',
      'Use short sentences when explaining code.'
    ])
  })
})

describe('searching memory', () => {
  it('normalizes names', () => {
    expect(norm('  Café  Ünïcode-Test! ')).toBe('cafe unicode test')
  })

  it('compares embeddings', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosine([1, 0], [1, 0, 0])).toBe(0)
    expect(cosine(null, [1])).toBe(0)
  })

  it('falls back to word overlap', () => {
    expect(keywordScore('where does my sister Sara live?', 'Sara is the sister of the user and lives in Utrecht.')).toBeGreaterThan(0.3)
    expect(keywordScore('what is the weather', 'The user owns a bike.')).toBe(0)
  })

  it('spots the same memory said twice', () => {
    expect(sameMemory({ text: 'The user lives in Utrecht.', vec: null }, { text: 'the user lives in utrecht', vec: null })).toBe(true)
    expect(sameMemory({ text: 'a', vec: new Float32Array([1, 0]) }, { text: 'b', vec: new Float32Array([0.99, 0.05]) })).toBe(true)
    expect(sameMemory({ text: 'a', vec: new Float32Array([1, 0]) }, { text: 'b', vec: new Float32Array([0, 1]) })).toBe(false)
  })

  it('picks the best matches above a minimum', () => {
    const r = topMatches([1, 5, 3, 0.1], (n) => n / 5, 2, 0.1)
    expect(r.map((x) => x.item)).toEqual([5, 3])
  })

  it('stores embeddings as blobs and reads them back', () => {
    const v = fromBlob(toBlob([0.5, -1, 2]))
    expect(Array.from(v!)).toEqual([0.5, -1, 2])
    expect(fromBlob(null)).toBeNull()
  })
})

describe('the chat as a feedback loop', () => {
  it('notices corrections in English and Dutch', () => {
    expect(looksLikeCorrection('No, I meant the other one')).toBe(true)
    expect(looksLikeCorrection("That's wrong, it's on Thursday")).toBe(true)
    expect(looksLikeCorrection('Nee, dat klopt niet')).toBe(true)
    expect(looksLikeCorrection('Way too long, keep it shorter')).toBe(true)
    expect(looksLikeCorrection('Can you help me with my notes?')).toBe(false)
    expect(looksLikeCorrection('I know nobody there')).toBe(false)
  })

  it('understands "forget that" and "what do you know about me"', () => {
    expect(isForgetRequest('Forget that')).toBe(true)
    expect(isForgetRequest('please forget what I just said')).toBe(true)
    expect(isForgetRequest('Vergeet dat')).toBe(true)
    expect(isForgetRequest("Don't forget that I have a meeting")).toBe(false)
    expect(asksWhatPoppyKnows('Hey Poppy, what do you know about me?')).toBe(true)
    expect(asksWhatPoppyKnows('Wat weet je over mij?')).toBe(true)
    expect(asksWhatPoppyKnows('What do you know about Rome?')).toBe(false)
  })

  it('builds a short memory note, or nothing', () => {
    expect(buildMemoryNote({ facts: [], lessons: [], graph: [] })).toBe('')
    const note = buildMemoryNote({
      facts: ['The user is called Sam.'],
      lessons: ['Keep it short.'],
      graph: ['the user — works at → Acme']
    })
    expect(note).toContain('- The user is called Sam.')
    expect(note).toContain('- the user — works at → Acme')
    expect(note).toContain('- Keep it short.')
    expect(note).toMatch(/Don't recite it/)
    const long = buildMemoryNote({ facts: Array.from({ length: 200 }, (_, i) => `Fact number ${i} about the user.`), lessons: [], graph: [] })
    expect(long.length).toBeLessThan(2500)
  })
})
