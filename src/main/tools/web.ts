import { formatPage, formatSearch, intArg, WEB_TOOLS, webUrlProblem } from '../../shared/builtin'
import { readPage } from './page'
import { failure, getJson, HttpError, type BuiltinServer } from './types'

/**
 * Web search in two ways:
 * - local (default): a SearXNG search engine on this Mac (scripts/searxng.sh), and pages read here;
 * - ollama: Ollama's web search API on ollama.com with the user's key (search and page reading).
 * POPPY_OLLAMA_WEB_URL is for tests only.
 */
const OLLAMA = process.env.POPPY_OLLAMA_WEB_URL || 'https://ollama.com'

export interface WebOptions {
  mode: 'local' | 'ollama'
  searxngUrl: string
  key: string | null
}

function post<T>(path: string, key: string, body: unknown, signal: AbortSignal, timeoutMs = 20_000): Promise<T> {
  return getJson<T>(
    `${OLLAMA}${path}`,
    signal,
    { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    timeoutMs
  )
}

const refused = (err: unknown): boolean => {
  const code = (err as { cause?: { code?: string } })?.cause?.code
  return code === 'ECONNREFUSED' || code === 'ECONNRESET'
}

const explain = (err: unknown, opts?: WebOptions): unknown =>
  opts?.mode === 'local' && refused(err)
    ? new Error(`the local search engine isn't running at ${opts.searxngUrl} (start Docker Desktop, or run "npm run searxng" in Poppy's folder)`)
    : err instanceof HttpError && (err.status === 401 || err.status === 403)
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
    return e instanceof Error ? e.message : String(err)
  }
}

/** Whether the local search engine answers (its health check, no search is sent). */
export async function checkLocalSearch(searxngUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${searxngUrl.replace(/\/+$/, '')}/healthz`, { signal: AbortSignal.timeout(3000) })
    return res.ok ? null : `it answered ${res.status}`
  } catch (err) {
    const e = explain(err, { mode: 'local', searxngUrl, key: null })
    return e instanceof Error ? e.message : String(e)
  }
}

type Results = { results?: { title?: string; url?: string; content?: string }[] }

async function search(opts: WebOptions, query: string, max: number, signal: AbortSignal): Promise<Results> {
  if (opts.mode === 'ollama') return post<Results>('/api/web_search', opts.key!, { query, max_results: max }, signal)
  const q = new URLSearchParams({ q: query, format: 'json' })
  const data = await getJson<Results>(`${opts.searxngUrl.replace(/\/+$/, '')}/search?${q}`, signal, {}, 20_000)
  return { results: (data.results ?? []).slice(0, max) }
}

export function webServer(opts: WebOptions): BuiltinServer {
  return {
    name: 'web',
    problem: opts.mode === 'ollama' && !opts.key ? 'Add an Ollama key to use it.' : null,
    tools: [
      {
        def: WEB_TOOLS[0],
        run: async (args, signal) => {
          const query = typeof args.query === 'string' ? args.query.trim().slice(0, 400) : ''
          if (!query) return { ok: false, text: 'web_search needs a query.' }
          try {
            return { ok: true, text: formatSearch(query, await search(opts, query, intArg(args.max_results, 1, 10, 5), signal)) }
          } catch (err) {
            return failure(explain(err, opts), signal, 'The web search')
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
            const page = opts.mode === 'ollama' ? await post<{ title?: string; content?: string }>('/api/web_fetch', opts.key!, { url }, signal, 30_000) : await readPage(url, signal)
            return { ok: true, text: formatPage(url, page) }
          } catch (err) {
            return failure(explain(err, opts), signal, 'Reading the page')
          }
        }
      }
    ]
  }
}
