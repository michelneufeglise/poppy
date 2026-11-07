import { describe, expect, it } from 'vitest'
import { claudeChatModels, quickThinking, shouldFallBack, toClaudeRequest } from '../src/shared/brain'

describe('building a Claude request', () => {
  it('moves the system prompt out, merges turns and starts with the user', () => {
    const req = toClaudeRequest([
      { role: 'system', content: 'You are Poppy.' },
      { role: 'system', content: 'Memory note.' },
      { role: 'assistant', content: '[hello] Hi!' },
      { role: 'user', content: 'one' },
      { role: 'user', content: 'two' },
      { role: 'assistant', content: '[happy] Sure.' },
      { role: 'user', content: 'Look at this', images: ['QUJD'] }
    ])
    expect(req.system).toBe('You are Poppy.\n\nMemory note.')
    expect(req.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(req.messages[0].content).toEqual([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' }
    ])
    expect(req.messages[2].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
      { type: 'text', text: 'Look at this' }
    ])
  })

  it('keeps thinking low for each model family', () => {
    expect(quickThinking('claude-haiku-5-5')).toEqual({ thinking: { type: 'disabled' } })
    expect(quickThinking('claude-sonnet-5-5')).toEqual({ thinking: { type: 'between_tools' } })
    expect(quickThinking('claude-opus-5-5')).toEqual({ output_config: { effort: 'low' } })
    expect(quickThinking('claude-haiku-4-5')).toEqual({})
  })

  it('offers chat models with Haiku 5.5 first', () => {
    expect(claudeChatModels(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-haiku-5-5', 'claude-fable-5-1'])).toEqual([
      'claude-haiku-5-5',
      'claude-haiku-4-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5'
    ])
  })
})

describe('falling back to Ollama', () => {
  const base = { aborted: false, gotText: false, refused: false, fallbackEnabled: true }
  it('takes over when Claude failed before saying anything', () => {
    expect(shouldFallBack(base)).toBe(true)
  })
  it('never after a refusal, a stop, halfway through, or when switched off', () => {
    expect(shouldFallBack({ ...base, refused: true })).toBe(false)
    expect(shouldFallBack({ ...base, aborted: true })).toBe(false)
    expect(shouldFallBack({ ...base, gotText: true })).toBe(false)
    expect(shouldFallBack({ ...base, fallbackEnabled: false })).toBe(false)
  })
})
