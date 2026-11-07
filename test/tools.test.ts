import { describe, expect, it } from 'vitest'
import {
  callArguments,
  describeCall,
  keepTool,
  MAX_TOOL_RESULT_CHARS,
  needsAsk,
  parseToolsFile,
  toOllamaTools,
  toolResultText,
  toolRules,
  uniqueNames,
  type ToolInfo
} from '../src/shared/tools'
import { toClaudeRequest, trimHistory, type BrainMessage } from '../src/shared/brain'
import { parseReply } from '../src/shared/reply'

const tool = (over: Partial<ToolInfo> = {}): ToolInfo => ({
  server: 'files',
  name: 'read_file',
  original: 'read_file',
  description: 'Reads a file',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  readOnly: true,
  ...over
})

describe('the tools file', () => {
  it("reads ollama-mcp-bridge's format: programs, urls, sse, filters and variables", () => {
    const { servers, problems } = parseToolsFile(
      JSON.stringify({
        mcpServers: {
          files: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '~/Documents/Poppy', '${userHome}/x'],
            env: { TOKEN: '${env:MY_TOKEN}' },
            toolFilter: { mode: 'exclude', tools: ['delete_file'] }
          },
          web: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${env:MY_TOKEN}' } },
          old: { url: 'https://example.com/sse' },
          off: { command: 'x', disabled: true },
          broken: { args: ['no command'] }
        }
      }),
      { MY_TOKEN: 'abc' },
      '/Users/me'
    )
    expect(servers.map((s) => [s.name, s.kind])).toEqual([
      ['files', 'stdio'],
      ['web', 'http'],
      ['old', 'sse']
    ])
    expect(servers[0].args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/Documents/Poppy', '/Users/me/x'])
    expect(servers[0].env).toEqual({ TOKEN: 'abc' })
    expect(servers[0].filter).toEqual({ mode: 'exclude', tools: ['delete_file'] })
    expect(servers[1].headers).toEqual({ Authorization: 'Bearer abc' })
    expect(problems).toEqual(['broken: needs a "command" or an http(s) "url".'])
  })

  it('explains a broken file instead of failing', () => {
    expect(parseToolsFile('{ nope', {}, '/h').problems[0]).toMatch(/isn't valid JSON/)
    expect(parseToolsFile('{}', {}, '/h').problems).toEqual(['The tools file needs an "mcpServers" object.'])
    expect(parseToolsFile('{"mcpServers":{}}', {}, '/h')).toEqual({ servers: [], problems: [] })
  })
})

describe('which tools are offered', () => {
  it('follows include and exclude filters', () => {
    expect(keepTool('a')).toBe(true)
    expect(keepTool('a', { mode: 'include', tools: ['a'] })).toBe(true)
    expect(keepTool('b', { mode: 'include', tools: ['a'] })).toBe(false)
    expect(keepTool('a', { mode: 'exclude', tools: ['a'] })).toBe(false)
    expect(keepTool('b', { mode: 'exclude', tools: ['a'] })).toBe(true)
  })

  it('renames tools only when two servers share a name', () => {
    expect(
      uniqueNames([
        { server: 'one', name: 'search' },
        { server: 'two', name: 'search' },
        { server: 'two', name: 'fetch' }
      ])
    ).toEqual(['one_search', 'two_search', 'fetch'])
  })

  it("turns tools into Ollama's format", () => {
    expect(toOllamaTools([tool({ inputSchema: {} })])).toEqual([
      { type: 'function', function: { name: 'read_file', description: 'Reads a file', parameters: { type: 'object', properties: {} } } }
    ])
  })
})

describe('asking first', () => {
  it('asks for tools that can change things, unless the server is trusted', () => {
    expect(needsAsk(tool(), [])).toBe(false)
    expect(needsAsk(tool({ readOnly: false }), [])).toBe(true)
    expect(needsAsk(tool({ readOnly: false }), ['files'])).toBe(false)
  })

  it('shows the call in one short line', () => {
    expect(describeCall('write_file', { path: 'notes.txt', content: 'Hello\nthere' })).toBe(
      'write_file (path: notes.txt, content: Hello there)'
    )
    expect(describeCall('list', {})).toBe('list')
    expect(describeCall('w', { content: 'x'.repeat(100) })).toBe(`w (content: ${'x'.repeat(39)}…)`)
    expect(describeCall('edit_file', { path: '/Users/me/Documents/Poppy/lists/shopping-list.txt' })).toBe(
      'edit_file (path: …Documents/Poppy/lists/shopping-list.txt)'
    )
  })
})

describe('tool calls and results', () => {
  it('reads arguments as an object or a JSON string', () => {
    expect(callArguments({ function: { name: 'a', arguments: { x: 1 } } })).toEqual({ x: 1 })
    expect(callArguments({ function: { name: 'a', arguments: '{"x":1}' } })).toEqual({ x: 1 })
    expect(callArguments({ function: { name: 'a', arguments: 'nope' } })).toEqual({})
  })

  it('turns results into text, marks errors and cuts long ones', () => {
    expect(toolResultText({ content: [{ type: 'text', text: 'hi' }, { type: 'image', data: 'x' }] })).toBe('hi\n(image left out)')
    expect(toolResultText({ content: [{ type: 'text', text: 'no such file' }], isError: true })).toBe(
      'The tool reported an error: no such file'
    )
    expect(toolResultText({ content: [] })).toBe('(no output)')
    expect(toolResultText({ content: [{ type: 'text', text: 'x'.repeat(MAX_TOOL_RESULT_CHARS + 5) }] })).toMatch(/cut: the result was/)
  })
})

describe('tool turns in the history', () => {
  it('starts the history with a user message after trimming', () => {
    const h: BrainMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_note', arguments: {} } }] },
      { role: 'tool', tool_name: 'read_note', content: 'x' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' }
    ]
    expect(trimHistory(h, 4).map((m) => m.content)).toEqual(['c'])
    expect(trimHistory(h, 5)).toHaveLength(5)
  })

  it("leaves Ollama's tool turns out of a Claude request", () => {
    const req = toClaudeRequest([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_note', arguments: {} } }] },
      { role: 'tool', tool_name: 'read_note', content: 'x' },
      { role: 'assistant', content: 'b' }
    ])
    expect(req.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('hides a made-up tag at the start of a later tool round', () => {
    expect(parseReply('[happy] Let me look.\n\n[calm] You have a dentist visit.').text).toBe('Let me look.\n\nYou have a dentist visit.')
  })
})

describe('when to use which tool', () => {
  it('only gives rules for the tools that are on', () => {
    const all = toolRules(['web_search', 'web_fetch', 'get_weather', 'play_music'])
    expect(all).toMatch(/call web_search right away/)
    expect(all).toMatch(/get_weather/)
    expect(all).toMatch(/music tools/)
    const none = toolRules(['read_file'])
    expect(none).not.toMatch(/web_search|get_weather|music/)
    expect(none).toMatch(/latest message/)
  })
})
