import { describe, expect, it } from 'vitest'
import { splitReply, takeSentences } from '../src/shared/reply'
import {
  capWords,
  CODE_SENTENCE,
  detectLanguage,
  localize,
  pickLanguage,
  speechView,
  TABLE_SENTENCE,
  tidySummary,
  wordCount
} from '../src/shared/speech'

describe('speechView', () => {
  it('turns a code block into one sentence', () => {
    const view = speechView('Try this:\n```ts\nconst a = 1\nconst b = 2\n```\nThat works.')
    expect(view.split('\n').filter(Boolean)).toEqual(['Try this:', CODE_SENTENCE, 'That works.'])
  })

  it('treats a code block that is still streaming as code', () => {
    expect(speechView('Look.\n```py\nprint(1)')).toBe(`Look.\n${CODE_SENTENCE}`)
  })

  it('turns a table into one sentence', () => {
    const view = speechView('Prices:\n| a | b |\n|---|---|\n| 1 | 2 |\nDone.')
    expect(view.split('\n').filter(Boolean)).toEqual(['Prices:', TABLE_SENTENCE, 'Done.'])
  })

  it('removes links, urls, markdown and emoji but keeps the words', () => {
    const view = speechView('## Plan\n- Read the [docs](https://x.dev) at https://x.dev/a 🎉\n- **Really** fast')
    expect(view).toBe('Plan.\nRead the docs at.\nReally fast.')
  })

  it('keeps already spoken text stable while more streams in', () => {
    const a = speechView(splitReply('[happy] Sure thing. Here is **mo').body)
    const b = speechView(splitReply('[happy] Sure thing. Here is **more** text.').body)
    const first = takeSentences(a, 0, false)
    expect(first.parts).toEqual(['Sure thing.'])
    expect(b.startsWith(a.slice(0, first.next))).toBe(true)
  })
})

describe('language', () => {
  it('detects Dutch and English in longer text', () => {
    expect(detectLanguage('Ik denk dat het een goed idee is om dat niet te doen met de kat.')).toBe('nl')
    expect(detectLanguage('I think that this is a good idea for you and the cat to do it.')).toBe('en')
    expect(detectLanguage('Hoi!')).toBeNull()
  })

  it('uses the user message for short replies', () => {
    expect(pickLanguage('Hoi!', 'Hoi Poppy, hoe gaat het met je?')).toBe('nl')
    expect(pickLanguage('Hi!', 'Hi Poppy, how are you today?')).toBe('en')
  })

  it('falls back to the previous language when nothing is clear', () => {
    expect(pickLanguage('Oké!', 'Oké', 'nl')).toBe('nl')
    expect(pickLanguage('Oké!', 'Oké')).toBe('en')
  })

  it('says the placeholders in Dutch for Dutch replies', () => {
    expect(localize(CODE_SENTENCE, 'nl')).toBe('Er staat een codeblok in de chat.')
    expect(localize('Gewoon tekst.', 'nl')).toBe('Gewoon tekst.')
  })
})

describe('word caps and summary clean-up', () => {
  it('keeps whole sentences up to the cap', () => {
    expect(capWords('One two three. Four five six. Seven.', 6)).toBe('One two three. Four five six.')
    expect(capWords('one two three four five', 3)).toBe('one two three…')
  })

  it('removes filler and markdown from the summary', () => {
    const out = tidySummary('"Sure! Here\'s a short summary: The **build** is green."')
    expect(out).toBe('The build is green.')
    expect(wordCount(out)).toBe(4)
  })
})
