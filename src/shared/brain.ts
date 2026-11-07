/**
 * Poppy's brain, the pure parts: which model answers, how a chat becomes a Claude request, and
 * when to fall back to Ollama. No network here, so it can be tested.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { OllamaToolCall } from './tools'

export type BrainKind = 'ollama' | 'claude'

export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-5-5'

export interface BrainMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Base64 JPEG images (attachments). */
  images?: string[]
  /** Tool calls Poppy made through Ollama (kept in the history so he remembers what he did). */
  tool_calls?: OllamaToolCall[]
  /** Which tool a 'tool' message answers. */
  tool_name?: string
}

/** Tool results kept in the chat history are cut to this length. */
export const HISTORY_TOOL_CHARS = 2000

/** The history starts with a user message: tool turns cut off from their question are dropped. */
export function trimHistory(history: BrainMessage[], max: number): BrainMessage[] {
  const out = history.slice(-max)
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

/** Shown after the text when Claude stops halfway through a reply. */
export const CUT_SHORT_NOTE = '(My connection dropped here, so this answer is cut short.)'

/**
 * Poppy's messages as a Claude request: system prompts go to `system`, turns by the same speaker
 * are merged, the conversation starts with the user, and images go before the text.
 */
export function toClaudeRequest(messages: BrainMessage[]): { system: string; messages: Anthropic.MessageParam[] } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const out: Anthropic.MessageParam[] = []
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'tool') continue // Claude doesn't get Ollama's tool turns
    if (!out.length && m.role === 'assistant') continue
    const blocks: Anthropic.ContentBlockParam[] = []
    if (m.role === 'user') {
      for (const data of m.images ?? []) blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })
    }
    if (m.content.trim()) blocks.push({ type: 'text', text: m.content })
    if (!blocks.length) continue
    const last = out.at(-1)
    if (last?.role === m.role && Array.isArray(last.content)) last.content.push(...blocks)
    else out.push({ role: m.role, content: blocks })
  }
  return { system, messages: out }
}

/**
 * Keep thinking as low as each model allows: Poppy needs quick, short answers.
 * Haiku 5.5 can switch it off; Sonnet 5.5 uses "between_tools" for that; Opus 5.5 can only go to low effort.
 */
export function quickThinking(model: string): Pick<Anthropic.MessageCreateParams, 'thinking' | 'output_config'> {
  if (/haiku-5/i.test(model)) return { thinking: { type: 'disabled' } }
  if (/sonnet-5-5/i.test(model)) return { thinking: { type: 'between_tools' } }
  if (/opus-5|fable-5|mythos-5/i.test(model)) return { output_config: { effort: 'low' } }
  return {}
}

/** Claude chat models worth offering, newest first, with Haiku 5.5 on top. */
export function claudeChatModels(ids: string[]): string[] {
  const wanted = ids.filter((id) => /^claude-(haiku|sonnet|opus)-/i.test(id))
  const rank = (id: string): number => (id === DEFAULT_CLAUDE_MODEL ? 0 : /haiku/i.test(id) ? 1 : /sonnet/i.test(id) ? 2 : 3)
  return [...new Set(wanted)].sort((a, b) => rank(a) - rank(b) || b.localeCompare(a))
}

/** Why Claude didn't answer, as the brain sees it. */
export interface FailureInfo {
  /** The user pressed Esc or sent a new message. */
  aborted: boolean
  /** Some of the reply had already arrived. */
  gotText: boolean
  /** Claude declined to answer (a safety refusal): never route around that. */
  refused: boolean
  fallbackEnabled: boolean
}

/** Ollama takes over only when Claude failed before saying anything, and not after a refusal. */
export function shouldFallBack(f: FailureInfo): boolean {
  return f.fallbackEnabled && !f.aborted && !f.gotText && !f.refused
}
