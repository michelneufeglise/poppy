import Anthropic from '@anthropic-ai/sdk'
import { claudeChatModels, quickThinking, toClaudeRequest, type BrainMessage } from '../shared/brain'

/** Claude declined to answer (a safety refusal). */
export class ClaudeRefusal extends Error {}

let cached: { key: string; client: Anthropic } | null = null

/**
 * Always Anthropic's own address with the user's key: ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN from the
 * environment are ignored on purpose, so the key never goes anywhere else. POPPY_ANTHROPIC_URL is for tests only.
 */
const BASE_URL = process.env.POPPY_ANTHROPIC_URL || 'https://api.anthropic.com'

function client(apiKey: string): Anthropic {
  if (cached?.key !== apiKey)
    cached = { key: apiKey, client: new Anthropic({ apiKey, authToken: null, baseURL: BASE_URL, maxRetries: 1, timeout: 60_000 }) }
  return cached.client
}

/** Streams Claude's reply text, chunk by chunk. */
export async function* streamClaude(
  apiKey: string,
  model: string,
  messages: BrainMessage[],
  signal: AbortSignal
): AsyncGenerator<string> {
  const req = toClaudeRequest(messages)
  const stream = client(apiKey).messages.stream(
    { model, max_tokens: 16000, system: req.system || undefined, messages: req.messages, ...quickThinking(model) },
    { signal }
  )
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text
  }
  const final = await stream.finalMessage()
  if (final.stop_reason === 'refusal') throw new ClaudeRefusal('Claude declined to answer')
}

/** One short reply (learning, reflection, the spoken wrap-up). With a schema, the answer is JSON in that shape. */
export async function askClaude(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  opts: { maxTokens: number; schema?: Record<string, unknown>; signal: AbortSignal }
): Promise<string> {
  const quick = quickThinking(model)
  const res = await client(apiKey).messages.create(
    {
      model,
      max_tokens: Math.max(opts.maxTokens, 1024),
      system,
      messages: [{ role: 'user', content: user }],
      ...quick,
      ...(opts.schema ? { output_config: { ...quick.output_config, format: { type: 'json_schema', schema: opts.schema } } } : {})
    },
    { signal: opts.signal }
  )
  if (res.stop_reason === 'refusal') throw new ClaudeRefusal('Claude declined to answer')
  return res.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim()
}

/** Claude chat models this key can use (also a quick check that the key works). */
export async function listClaudeModels(apiKey: string): Promise<string[]> {
  const ids: string[] = []
  for await (const m of client(apiKey).models.list()) ids.push(m.id)
  return claudeChatModels(ids)
}

/** A short, plain explanation of what went wrong with Claude. */
export function claudeProblem(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'the API key was refused'
  if (err instanceof Anthropic.PermissionDeniedError) return 'this key may not use that model'
  if (err instanceof Anthropic.NotFoundError) return "that Claude model doesn't exist (any more)"
  if (err instanceof Anthropic.RateLimitError) return 'Claude is busy or the account hit a limit'
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'Claude took too long'
  if (err instanceof Anthropic.APIConnectionError) return "Claude couldn't be reached (offline?)"
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit|billing|balance/i.test(err.message)) return 'the account is out of credit'
    return `Claude refused the request: ${err.message}`
  }
  if (err instanceof Anthropic.APIError) return `Claude returned an error (${err.status ?? 'no status'})`
  const msg = err instanceof Error ? err.message : String(err)
  if (/terminated|socket|ECONNRESET|network/i.test(msg)) return 'the connection dropped'
  return msg
}
