import { describe, expect, it } from 'vitest'
import { parseReply, takeSentences } from '../src/shared/reply'

describe('brackets around the whole reply', () => {
  it('unwraps a reply the model put in brackets', () => {
    expect(parseReply('[I am happy to help! You are Sam.]').text).toBe('I am happy to help! You are Sam.')
    expect(parseReply('[happy] See [1] for details.').text).toBe('See [1] for details.')
  })
})

describe('parseReply', () => {
  it('reads the mood tag and removes it', () => {
    expect(parseReply('[happy] Nice, that worked!')).toEqual({ text: 'Nice, that worked!', mood: 'happy' })
  })
  it('hides a tag that is still streaming in', () => {
    expect(parseReply('[hap').text).toBe('')
    expect(parseReply('Sure [cur').text).toBe('Sure')
  })
  it('removes thinking, also when it is not closed yet', () => {
    expect(parseReply('<think>hmm</think>[sad] Oh no.')).toEqual({ text: 'Oh no.', mood: 'sad' })
    expect(parseReply('<think>still going').text).toBe('')
  })
  it('drops an invented tag at the start and markdown symbols', () => {
    expect(parseReply('[excited] **Wow** `code`').text).toBe('Wow code')
  })
  it('removes emoji, since replies are spoken', () => {
    expect(parseReply('[surprised] Whoa, a disaster! 🐱☕').text).toBe('Whoa, a disaster!')
  })
  it('knows the moods from the second sheet, also with a dash', () => {
    expect(parseReply('[sad-hello] Oh, hi.')).toEqual({ text: 'Oh, hi.', mood: 'sad-hello' })
    expect(parseReply('[bye] See you!')).toEqual({ text: 'See you!', mood: 'bye' })
    expect(parseReply('[clapping] Well done!')).toEqual({ text: 'Well done!', mood: 'clapping' })
    expect(parseReply('[sad] Oh no.').mood).toBe('sad')
  })

  it('knows the hello mood', () => {
    expect(parseReply('[hello] Hi there!')).toEqual({ text: 'Hi there!', mood: 'hello' })
  })
  it('takes the answer\'s mood after a tool round', () => {
    expect(parseReply("[curious] Let me check the weather.\n\n[happy] It's sunny in Utrecht!").mood).toBe('happy')
    expect(parseReply('[curious] Let me check.').mood).toBe('curious')
  })
  it('maps a made-up tag to the nearest drawing', () => {
    expect(parseReply('[chuckling] Why did the cat join a band?')).toEqual({ text: 'Why did the cat join a band?', mood: 'laughing' })
    expect(parseReply('[chirping] Tweet.').mood).toBeNull()
  })
  it('returns no mood when there is no tag', () => {
    expect(parseReply('Hello there.').mood).toBeNull()
  })
})

describe('brackets around the whole reply', () => {
  it('unwraps a reply the model put in brackets', () => {
    expect(parseReply('[I am happy to help! You are Sam.]').text).toBe('I am happy to help! You are Sam.')
    expect(parseReply('[happy] See [1] for details.').text).toBe('See [1] for details.')
  })
})

describe('takeSentences', () => {
  it('returns only finished sentences while streaming', () => {
    const r = takeSentences('Hi there. How are', 0, false)
    expect(r.parts).toEqual(['Hi there.'])
    expect(takeSentences('Hi there. How are you?', r.next, true).parts).toEqual(['How are you?'])
  })
  it('splits on line breaks', () => {
    expect(takeSentences('One\nTwo\n', 0, false).parts).toEqual(['One', 'Two'])
  })
})
