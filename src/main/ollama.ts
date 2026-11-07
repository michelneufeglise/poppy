export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** Base64 images for vision models. */
  images?: string[]
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
  const body: Record<string, unknown> = { model, messages, stream: true, think: false, keep_alive: '30m' }
  if (numCtx) body.options = { num_ctx: numCtx }
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
      const msg = JSON.parse(line) as { error?: string; message?: { content?: string } }
      if (msg.error) throw new OllamaError(msg.error)
      if (msg.message?.content) yield msg.message.content
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

/** One short, non-streaming reply (used for the spoken wrap-up). */
export async function chatOnce(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  options: Record<string, unknown> = {}
): Promise<string> {
  const body: Record<string, unknown> = { model, messages, stream: false, think: false, keep_alive: '30m', options }
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
