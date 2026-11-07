import type { ToolDef } from '../../shared/builtin'

export interface ToolResult {
  ok: boolean
  text: string
}

export interface BuiltinTool {
  def: ToolDef
  run: (args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolResult>
}

/** One group of Poppy's own tools, shown like a server in Settings. */
export interface BuiltinServer {
  name: string
  /** Why it can't be used right now (no key, no Spotify); its tools aren't offered then. */
  problem: string | null
  tools: BuiltinTool[]
}

/** fetch with the reply's stop signal and a time limit; a non-2xx answer throws with a short reason. */
export async function getJson<T>(url: string, signal: AbortSignal, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) })
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)
    throw new HttpError(res.status, body)
  }
  return (await res.json()) as T
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`HTTP ${status}${body ? `: ${body}` : ''}`)
  }
}

/** A failed call as text for the model (it can tell the user), unless the reply was stopped. */
export function failure(err: unknown, signal: AbortSignal, what: string): ToolResult {
  if (signal.aborted) throw err
  const why = err instanceof Error && err.name === 'TimeoutError' ? 'it took too long' : err instanceof Error ? err.message : String(err)
  return { ok: false, text: `${what} failed: ${why}` }
}
