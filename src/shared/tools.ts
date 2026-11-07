/**
 * MCP tools, the pure parts: reading the tools file, which tools are offered, what needs the
 * user's OK, and how tools and their results look to Ollama. No processes or network here.
 *
 * The tools file uses the same format as ollama-mcp-bridge's mcp-config.json
 * (https://github.com/jonigl/ollama-mcp-bridge, MIT), so a config can be copied over as-is.
 */

export interface ToolFilter {
  mode: 'include' | 'exclude'
  tools: string[]
}

export interface ServerConfig {
  name: string
  /** stdio = a local program; http = StreamableHTTP; sse = a URL ending in /sse. */
  kind: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  filter?: ToolFilter
}

/** One tool from one server, as Poppy offers it to the model. */
export interface ToolInfo {
  server: string
  /** The name the model sees (the tool's own name, or server_name when two servers share it). */
  name: string
  /** The tool's name on its server. */
  original: string
  description: string
  inputSchema: Record<string, unknown>
  /** The server says this tool only reads (MCP's readOnlyHint). */
  readOnly: boolean
}

/** A tool in the shape of Ollama's `tools` field. */
export interface OllamaTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> | string }
}

/** At most this many rounds of tool calls per reply; then Poppy answers without tools. */
export const DEFAULT_TOOL_ROUNDS = 5
/** A tool result longer than this is cut, so one call can't fill the whole context. */
export const MAX_TOOL_RESULT_CHARS = 20_000
/** No answer to "may I?" within this time counts as no. */
export const ASK_TIMEOUT_MS = 120_000

export const TOOLS_FILE_EXAMPLE = `{
  "mcpServers": {}
}
`

/** `${env:NAME}` → that environment variable, `${userHome}` → the home folder, a leading `~/` too. */
export function expandVars(value: string, env: Record<string, string | undefined>, home: string): string {
  return value
    .replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => env[name] ?? '')
    .replace(/\$\{userHome\}/g, home)
    .replace(/^~(?=\/|$)/, home)
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function stringMap(v: unknown, expand: (s: string) => string): Record<string, string> | undefined {
  if (!isObject(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string' || typeof val === 'number') out[k] = expand(String(val))
  return out
}

/** Reads the tools file. Servers with mistakes are left out and named in `problems`. */
export function parseToolsFile(
  text: string,
  env: Record<string, string | undefined>,
  home: string
): { servers: ServerConfig[]; problems: string[] } {
  const problems: string[] = []
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    return { servers: [], problems: [`The tools file isn't valid JSON (${err instanceof Error ? err.message : err}).`] }
  }
  const list = isObject(data) ? data.mcpServers : undefined
  if (!isObject(list)) return { servers: [], problems: ['The tools file needs an "mcpServers" object.'] }

  const expand = (s: string): string => expandVars(s, env, home)
  const servers: ServerConfig[] = []
  for (const [name, raw] of Object.entries(list)) {
    if (!isObject(raw)) {
      problems.push(`${name}: not an object.`)
      continue
    }
    if (raw.disabled === true) continue
    let filter: ToolFilter | undefined
    if (isObject(raw.toolFilter)) {
      const tools = Array.isArray(raw.toolFilter.tools) ? raw.toolFilter.tools.filter((t): t is string => typeof t === 'string') : []
      if (tools.length) filter = { mode: raw.toolFilter.mode === 'exclude' ? 'exclude' : 'include', tools }
    }
    if (typeof raw.command === 'string' && raw.command.trim()) {
      servers.push({
        name,
        kind: 'stdio',
        command: expand(raw.command.trim()),
        args: Array.isArray(raw.args) ? raw.args.map((a) => expand(String(a))) : [],
        env: stringMap(raw.env, expand),
        cwd: typeof raw.cwd === 'string' ? expand(raw.cwd) : undefined,
        filter
      })
    } else if (typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url)) {
      const url = expand(raw.url)
      servers.push({ name, kind: /\/sse\/?$/i.test(url) ? 'sse' : 'http', url, headers: stringMap(raw.headers, expand), filter })
    } else {
      problems.push(`${name}: needs a "command" or an http(s) "url".`)
    }
  }
  return { servers, problems }
}

/** Whether a tool passes the server's toolFilter. */
export function keepTool(name: string, filter?: ToolFilter): boolean {
  if (!filter?.tools.length) return true
  const listed = filter.tools.includes(name)
  return filter.mode === 'include' ? listed : !listed
}

/** Gives every tool a unique name: a name two servers share becomes server_name for both. */
export function uniqueNames(tools: { server: string; name: string }[]): string[] {
  const count = new Map<string, number>()
  for (const t of tools) count.set(t.name, (count.get(t.name) ?? 0) + 1)
  return tools.map((t) => (count.get(t.name)! > 1 ? `${t.server}_${t.name}` : t.name))
}

export function toOllamaTools(tools: ToolInfo[]): OllamaTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || t.original,
      parameters: t.inputSchema && Object.keys(t.inputSchema).length ? t.inputSchema : { type: 'object', properties: {} }
    }
  }))
}

/** Tools that only read, and tools of a server the user trusts, run without asking. */
export function needsAsk(tool: ToolInfo, trusted: string[]): boolean {
  return !tool.readOnly && !trusted.includes(tool.server)
}

/** The model's arguments as an object (some models send a JSON string). */
export function callArguments(call: OllamaToolCall): Record<string, unknown> {
  const a = call.function.arguments
  if (typeof a === 'string') {
    try {
      const parsed = JSON.parse(a) as unknown
      return isObject(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return isObject(a) ? a : {}
}

/** A short, readable line for the "may I?" question, like `write_file (path: notes.txt, content: "Hi…")`. */
export function describeCall(name: string, args: Record<string, unknown>, max = 160): string {
  const parts = Object.entries(args).map(([k, v]) => {
    let s = typeof v === 'string' ? v : JSON.stringify(v)
    s = s.replace(/\s+/g, ' ')
    if (s.length > 40) s = `${s.slice(0, 39)}…`
    return `${k}: ${s}`
  })
  const line = parts.length ? `${name} (${parts.join(', ')})` : name
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** An MCP tool result as text for the model. Images and other non-text parts become a short note. */
export function toolResultText(result: { content?: unknown; isError?: unknown; structuredContent?: unknown }): string {
  const parts: string[] = []
  if (Array.isArray(result.content)) {
    for (const c of result.content) {
      if (!isObject(c)) continue
      if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text)
      else if (c.type === 'resource' && isObject(c.resource) && typeof c.resource.text === 'string') parts.push(c.resource.text)
      else if (c.type === 'resource_link' && typeof c.uri === 'string') parts.push(`(link: ${c.uri})`)
      else if (typeof c.type === 'string') parts.push(`(${c.type} left out)`)
    }
  }
  if (!parts.length && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent))
  let text = parts.join('\n').trim() || '(no output)'
  if (text.length > MAX_TOOL_RESULT_CHARS) text = `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n… (cut: the result was ${text.length} characters)`
  return result.isError === true ? `The tool reported an error: ${text}` : text
}
