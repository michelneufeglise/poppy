import type { OllamaTool, OllamaToolCall } from '../shared/tools'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Base64 images for vision models. */
  images?: string[]
  /** The model's tool calls (assistant turns in a tool round). */
  tool_calls?: OllamaToolCall[]
  /** Which tool a 'tool' message answers. */
  tool_name?: string
}

/** A piece of a streamed reply: text, or the tool calls the model wants. */
export interface StreamPart {
  text?: string
  toolCalls?: OllamaToolCall[]
}

/** Whether a model can look at images (Ollama's "vision" capability). */
export async function canSee(baseUrl: string, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/show`, { method: 'POST', body: JSON.stringify({ model }) })
    const data = (await res.json()) as { capabilities?: string[] }
    return data.capabilities?.includes('vision') ?? false
  } catch {
    return false
  }
}

export class OllamaError extends Error {}

/** Installed chat models (embedding models are left out). */
export async function listModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/tags`)
  if (!res.ok) throw new OllamaError(`Ollama returned ${res.status}`)
  const data = (await res.json()) as { models?: { name: string }[] }
  return (data.models ?? []).map((m) => m.name).filter((n) => !/embed/i.test(n))
}

/** Picks a fast, decent chat model from what's installed. */
export async function pickDefaultModel(baseUrl: string): Promise<string> {
  const models = await listModels(baseUrl)
  if (models.length === 0) throw new OllamaError('No Ollama models are installed yet.')
  const preferred = [
    /^qwen3\.6:35b-a3b$/i,
    /qwen3.*4b.*instruct/i,
    /qwen2\.5:7b-instruct/i,
    /qwen2\.5:7b/i,
    /llama3\.[12](?!.*vision)/i,
    /gemma\d*:\d+b/i,
    /hermes/i
  ]
  for (const re of preferred) {
    const hit = models.find((m) => re.test(m))
    if (hit) return hit
  }
  return models.find((m) => !/ocr|vision|embed/i.test(m)) ?? models[0]
}

/** Streams the reply text, chunk by chunk. Thinking is switched off when the model supports it. */
export async function* streamChat(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  numCtx?: number
): AsyncGenerator<string> {
  for await (const part of streamChatParts(baseUrl, model, messages, signal, numCtx)) if (part.text) yield part.text
}

/** Like streamChat, with tools offered to the model: tool calls come out as their own parts. */
export async function* streamChatParts(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  numCtx?: number,
  tools?: OllamaTool[],
  temperature?: number
): AsyncGenerator<StreamPart> {
  const body: Record<string, unknown> = { model, messages, stream: true, think: false, keep_alive: '30m' }
  const options: Record<string, number> = {}
  if (numCtx) options.num_ctx = numCtx
  if (temperature !== undefined) options.temperature = temperature
  if (Object.keys(options).length) body.options = options
  if (tools?.length) body.tools = tools
  const post = (): Promise<Response> =>
    fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })

  let res = await post()
  if (res.status === 400) {
    const text = await res.text()
    if (!/think/i.test(text)) throw new OllamaError(readError(text))
    delete body.think // this model doesn't know the think option
    res = await post()
  }
  if (!res.ok || !res.body) throw new OllamaError(readError(await res.text()))

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      const msg = JSON.parse(line) as { error?: string; message?: { content?: string; tool_calls?: OllamaToolCall[] } }
      if (msg.error) throw new OllamaError(msg.error)
      if (msg.message?.content) yield { text: msg.message.content }
      if (msg.message?.tool_calls?.length) yield { toolCalls: msg.message.tool_calls }
    }
  }
}

function readError(text: string): string {
  try {
    return (JSON.parse(text) as { error?: string }).error ?? text
  } catch {
    return text
  }
}

/** One short, non-streaming reply (the spoken wrap-up, and Poppy's learning and reflection). */
export async function chatOnce(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  options: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
): Promise<string> {
  const body: Record<string, unknown> = { model, messages, stream: false, think: false, keep_alive: '30m', options, ...extra }
  const post = (): Promise<Response> =>
    fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
  let res = await post()
  if (res.status === 400) {
    const text = await res.text()
    if (!/think/i.test(text)) throw new OllamaError(readError(text))
    delete body.think
    res = await post()
  }
  if (!res.ok) throw new OllamaError(readError(await res.text()))
  const data = (await res.json()) as { message?: { content?: string } }
  return data.message?.content?.trim() ?? ''
}

/** Embeddings for some texts (one vector each), from an Ollama embedding model. */
export async function embed(baseUrl: string, model: string, texts: string[], signal?: AbortSignal): Promise<number[][]> {
  const res = await fetch(`${baseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts, keep_alive: '30m' }),
    signal
  })
  if (!res.ok) throw new OllamaError(readError(await res.text()))
  const data = (await res.json()) as { embeddings?: number[][] }
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) throw new OllamaError('No embeddings returned')
  return data.embeddings
}

/** Embedding models that are installed (names with "embed" in them, plus the well-known ones). */
export async function listEmbedModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/tags`)
  if (!res.ok) throw new OllamaError(`Ollama returned ${res.status}`)
  const data = (await res.json()) as { models?: { name: string }[] }
  return (data.models ?? []).map((m) => m.name).filter((n) => /embed|bge|minilm|e5-/i.test(n))
}
