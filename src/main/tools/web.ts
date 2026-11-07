import { formatPage, formatSearch, intArg, WEB_TOOLS, webUrlProblem } from '../../shared/builtin'
import { failure, getJson, HttpError, type BuiltinServer } from './types'

/** Ollama's web search API (needs a free ollama.com key). POPPY_OLLAMA_WEB_URL is for tests only. */
const BASE = process.env.POPPY_OLLAMA_WEB_URL || 'https://ollama.com'

function post<T>(path: string, key: string, body: unknown, signal: AbortSignal, timeoutMs = 20_000): Promise<T> {
  return getJson<T>(
    `${BASE}${path}`,
    signal,
    { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    timeoutMs
  )
}

const explain = (err: unknown): unknown =>
  err instanceof HttpError && (err.status === 401 || err.status === 403)
    ? new Error('the Ollama key was refused (check it in Settings → Tools)')
    : err instanceof HttpError && err.status === 429
      ? new Error('the web search limit was reached for now')
      : err

/** Checks a key with one tiny search before it's saved. */
export async function checkOllamaKey(key: string): Promise<string | null> {
  try {
    await post('/api/web_search', key, { query: 'Poppy', max_results: 1 }, new AbortController().signal)
    return null
  } catch (err) {
    const e = explain(err)
    return e instanceof Error ? e.message : String(e)
  }
}

export function webServer(key: string | null): BuiltinServer {
  return {
    name: 'web',
    problem: key ? null : 'Add an Ollama key to use it.',
    tools: [
      {
        def: WEB_TOOLS[0],
        run: async (args, signal) => {
          const query = typeof args.query === 'string' ? args.query.trim().slice(0, 400) : ''
          if (!query) return { ok: false, text: 'web_search needs a query.' }
          try {
            const data = await post<{ results?: [] }>('/api/web_search', key!, { query, max_results: intArg(args.max_results, 1, 10, 5) }, signal)
            return { ok: true, text: formatSearch(query, data) }
          } catch (err) {
            return failure(explain(err), signal, 'The web search')
          }
        }
      },
      {
        def: WEB_TOOLS[1],
        run: async (args, signal) => {
          const url = typeof args.url === 'string' ? args.url.trim() : ''
          const problem = webUrlProblem(url)
          if (problem) return { ok: false, text: problem }
          try {
            return { ok: true, text: formatPage(url, await post('/api/web_fetch', key!, { url }, signal, 30_000)) }
          } catch (err) {
            return failure(explain(err), signal, 'Reading the page')
          }
        }
      }
    ]
  }
}
