import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { existsSync, readFileSync, unwatchFile, watchFile, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import type { ToolServerStatus, ToolsStatus } from '../shared/types'
import { BUILTIN_SERVERS } from '../shared/builtin'
import type { BuiltinServer } from './tools/types'
import { keepTool, parseToolsFile, toolResultText, TOOLS_FILE_EXAMPLE, uniqueNames, type ServerConfig, type ToolInfo } from '../shared/tools'

/** Starting a server can take a while the first time (npx/uvx download it). */
const CONNECT_TIMEOUT_MS = 90_000
const CALL_TIMEOUT_MS = 60_000
/** Electron started from Finder gets a bare PATH; add Homebrew's so npx, uvx and node are found. */
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin']

interface Server {
  config: ServerConfig
  status: ToolServerStatus
  client?: Client
  /** The last bit of what a local server printed on stderr, for error messages. */
  stderr: string
  tools: { original: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }[]
}

/**
 * Poppy's tools: her own (weather, web, music: `builtins`) and MCP servers, started from the tools
 * file when tools are switched on, restarted when the file changes, stopped when they're switched
 * off or Poppy quits.
 */
export class ToolBox {
  private servers: Server[] = []
  private problems: string[] = []
  private enabled = false
  private generation = 0
  private listeners = new Set<(s: ToolsStatus) => void>()

  constructor(
    readonly file: string,
    private readonly builtins: () => BuiltinServer[] = () => []
  ) {}

  /** Settings or keys for Poppy's own tools changed: tell the settings window. */
  refresh(): void {
    this.changed()
  }

  onStatus(fn: (s: ToolsStatus) => void): void {
    this.listeners.add(fn)
  }

  private changed(): void {
    const s = this.status()
    for (const fn of this.listeners) fn(s)
  }

  status(): ToolsStatus {
    const own: ToolServerStatus[] = this.enabled
      ? this.builtins().map((b) => ({
          name: b.name,
          state: b.problem ? 'error' : 'ready',
          message: b.problem ?? '',
          tools: b.tools.map((t) => ({ name: t.def.name, readOnly: t.def.readOnly, harmless: t.def.harmless })),
          builtin: true
        }))
      : []
    return { enabled: this.enabled, file: this.file, problems: this.problems, servers: [...own, ...this.servers.map((s) => s.status)] }
  }

  /** Makes the tools file with an empty server list when there isn't one yet. */
  ensureFile(): string {
    if (!existsSync(this.file)) writeFileSync(this.file, TOOLS_FILE_EXAMPLE, { mode: 0o600 })
    return this.file
  }

  async setEnabled(on: boolean): Promise<void> {
    if (on === this.enabled) return
    this.enabled = on
    if (on) {
      this.ensureFile()
      watchFile(this.file, { interval: 2000 }, () => void this.reload())
      await this.reload()
    } else {
      unwatchFile(this.file)
      await this.stopAll()
      this.changed()
    }
  }

  /** Reads the tools file again and restarts every server. */
  async reload(): Promise<void> {
    if (!this.enabled) return
    const gen = ++this.generation
    await this.stopAll()
    let text = ''
    try {
      text = readFileSync(this.file, 'utf8')
    } catch {
      text = TOOLS_FILE_EXAMPLE
    }
    const parsed = parseToolsFile(text, process.env, homedir())
    const reserved = (name: string): boolean => (BUILTIN_SERVERS as readonly string[]).includes(name)
    this.problems = [
      ...parsed.problems,
      ...parsed.servers.filter((c) => reserved(c.name)).map((c) => `${c.name}: that name is taken by Poppy's own tools, so rename this server.`)
    ]
    this.servers = parsed.servers.filter((c) => !reserved(c.name)).map((config) => ({
      config,
      status: { name: config.name, state: 'starting', message: '', tools: [] },
      stderr: '',
      tools: []
    }))
    this.changed()
    await Promise.all(this.servers.map((s) => this.connect(s, gen)))
  }

  private async connect(server: Server, gen: number): Promise<void> {
    const { config } = server
    const client = new Client({ name: 'poppy', version: '0.1.0' })
    try {
      const transport = this.transport(server)
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS })
      const tools: Server['tools'] = []
      let cursor: string | undefined
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, { timeout: CONNECT_TIMEOUT_MS })
        for (const t of page.tools) {
          if (!keepTool(t.name, config.filter)) continue
          tools.push({
            original: t.name,
            description: t.description ?? '',
            inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
            readOnly: t.annotations?.readOnlyHint === true
          })
        }
        cursor = page.nextCursor
      } while (cursor)
      if (gen !== this.generation) {
        await client.close().catch(() => {})
        return
      }
      server.client = client
      server.tools = tools
      server.status = { name: config.name, state: 'ready', message: '', tools: tools.map((t) => ({ name: t.original, readOnly: t.readOnly })) }
      console.log(`[tools] ${config.name}: ${tools.length} tools`)
    } catch (err) {
      await client.close().catch(() => {})
      if (gen !== this.generation) return
      const why = err instanceof Error ? err.message : String(err)
      const tail = server.stderr.trim().split('\n').slice(-2).join(' ').slice(-240)
      server.status = { name: config.name, state: 'error', message: tail ? `${why} (${tail})` : why, tools: [] }
      console.warn(`[tools] ${config.name} didn't start: ${server.status.message}`)
    }
    this.changed()
  }

  private transport(server: Server): Transport {
    const c = server.config
    if (c.kind === 'stdio') {
      const base = getDefaultEnvironment()
      const path = [...(base.PATH ?? '').split(':').filter(Boolean), ...EXTRA_PATH]
      const t = new StdioClientTransport({
        command: c.command!,
        args: c.args,
        cwd: c.cwd,
        env: { ...base, PATH: [...new Set(path)].join(':'), ...c.env },
        stderr: 'pipe'
      })
      t.stderr?.on('data', (chunk: Buffer) => {
        server.stderr = (server.stderr + chunk.toString()).slice(-2000)
      })
      return t
    }
    const url = new URL(c.url!)
    const requestInit = c.headers ? { headers: c.headers } : undefined
    return c.kind === 'sse' ? new SSEClientTransport(url, { requestInit }) : new StreamableHTTPClientTransport(url, { requestInit })
  }

  async stopAll(): Promise<void> {
    const old = this.servers
    this.servers = []
    await Promise.all(old.map((s) => s.client?.close().catch(() => {})))
  }

  /** Every tool of every server that's running, with unique names. */
  tools(): ToolInfo[] {
    if (!this.enabled) return []
    const own = this.builtins()
      .filter((b) => !b.problem)
      .flatMap((b) =>
        b.tools.map((t) => ({
          server: b.name,
          original: t.def.name,
          description: t.def.description,
          inputSchema: t.def.inputSchema,
          readOnly: t.def.readOnly,
          harmless: t.def.harmless
        }))
      )
    const flat = [...own, ...this.servers.flatMap((s) => (s.client ? s.tools.map((t) => ({ server: s.config.name, ...t })) : []))]
    const names = uniqueNames(flat.map((t) => ({ server: t.server, name: t.original })))
    return flat.map((t, i) => ({ ...t, name: names[i] }))
  }

  /** Runs one tool; the answer is text for the model (errors too, so the model can carry on). */
  async call(tool: ToolInfo, args: Record<string, unknown>, signal: AbortSignal): Promise<{ ok: boolean; text: string }> {
    const own = this.builtins().find((b) => b.name === tool.server)
    if (own) {
      const t = own.tools.find((x) => x.def.name === tool.original)
      if (own.problem || !t) return { ok: false, text: `The ${tool.server} tools can't be used right now${own.problem ? `: ${own.problem}` : '.'}` }
      return t.run(args, signal)
    }
    const server = this.servers.find((s) => s.config.name === tool.server)
    if (!server?.client) return { ok: false, text: `The ${tool.server} tools aren't running right now.` }
    try {
      const result = await server.client.callTool({ name: tool.original, arguments: args }, undefined, { signal, timeout: CALL_TIMEOUT_MS })
      // Old servers answer with { toolResult } instead of { content }.
      const r = ('toolResult' in result && !('content' in result) ? { content: [{ type: 'text', text: JSON.stringify(result.toolResult) }] } : result) as {
        content?: unknown
        isError?: unknown
        structuredContent?: unknown
      }
      return { ok: r.isError !== true, text: toolResultText(r) }
    } catch (err) {
      if (signal.aborted) throw err
      return { ok: false, text: `The tool failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
}
