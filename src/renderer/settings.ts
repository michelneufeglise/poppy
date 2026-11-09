import { followCharacter, me } from './character'
import {
  KOKORO_VOICES,
  LISTEN_LOCALES,
  type BrainStatus,
  type KokoroStatus,
  type ListenStatus,
  type MemoryStats,
  type Settings,
  type ToolKeys,
  type ToolsStatus
} from '../shared/types'

const api = window.poppy
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const url = $<HTMLInputElement>('url')
const model = $<HTMLSelectElement>('model')
const status = $<HTMLParagraphElement>('status')
const voiceOn = $<HTMLInputElement>('voice-on')
const voice = $<HTMLSelectElement>('voice')
const rate = $<HTMLInputElement>('rate')
const rateOut = $<HTMLSpanElement>('rate-out')
const sleep = $<HTMLInputElement>('sleep')
const long = $<HTMLSelectElement>('long')
const engine = $<HTMLSelectElement>('engine')
const kokoroBox = $<HTMLDivElement>('kokoro-box')
const kokoroVoice = $<HTMLSelectElement>('kokoro-voice')
const kokoroSpeed = $<HTMLInputElement>('kokoro-speed')
const kokoroSpeedOut = $<HTMLSpanElement>('kokoro-speed-out')
const kokoroStatus = $<HTMLParagraphElement>('kokoro-status')
const dutchVoice = $<HTMLSelectElement>('dutch-voice')
const listenOn = $<HTMLInputElement>('listen-on')
const listenLocale = $<HTMLSelectElement>('listen-locale')
const duckOn = $<HTMLInputElement>('duck-on')
const listenStatusEl = $<HTMLParagraphElement>('listen-status')
let listenStatus: ListenStatus = { state: 'off', message: '' }
/** What the last check said about permissions and the language (only checked while it's on). */
let listenCheck = ''
const memoryOn = $<HTMLInputElement>('memory-on')
const embedModel = $<HTMLSelectElement>('embed')
const memoryStatus = $<HTMLParagraphElement>('memory-status')
const character = $<HTMLSelectElement>('character')
const toolsOn = $<HTMLInputElement>('tools-on')
const toolsBox = $<HTMLDivElement>('tools-box')
const toolServers = $<HTMLDivElement>('tool-servers')
const toolsStatus = $<HTMLParagraphElement>('tools-status')
const toolRounds = $<HTMLInputElement>('tool-rounds')
let lastTools: ToolsStatus | null = null
const weatherOn = $<HTMLInputElement>('weather-on')
const homeCity = $<HTMLInputElement>('home-city')
const webOn = $<HTMLInputElement>('web-on')
const webSearch = $<HTMLSelectElement>('web-search')
const searxngUrl = $<HTMLInputElement>('searxng-url')
/** null = the local search engine answers; a string = why not; undefined = not checked yet. */
let localSearch: string | null | undefined
const ollamaKey = $<HTMLInputElement>('ollama-key')
const removeOllamaKey = $<HTMLButtonElement>('remove-ollama-key')
const musicOn = $<HTMLInputElement>('music-on')
const spotifyId = $<HTMLInputElement>('spotify-id')
const spotifySecret = $<HTMLInputElement>('spotify-secret')
const removeSpotify = $<HTMLButtonElement>('remove-spotify')
let toolKeys: ToolKeys = { ollama: null, spotify: null }
/** A message from the last key save, shown until the status changes. */
const keyNotes: Record<string, { ok: boolean; message: string } | undefined> = {}
const brainSel = $<HTMLSelectElement>('brain')
const claudeBox = $<HTMLDivElement>('claude-box')
const claudeKey = $<HTMLInputElement>('claude-key')
const keyStatus = $<HTMLParagraphElement>('key-status')
const removeKey = $<HTMLButtonElement>('remove-key')
const claudeModel = $<HTMLSelectElement>('claude-model')
const fallback = $<HTMLInputElement>('fallback')
let claude: BrainStatus & { masked: string | null } = { keySet: false, lastProblem: null, masked: null }

let settings: Settings

function option(value: string, label: string): HTMLOptionElement {
  const o = document.createElement('option')
  o.value = value
  o.textContent = label
  return o
}

async function loadModels(): Promise<void> {
  status.className = 'hint'
  status.textContent = 'Looking for models…'
  try {
    const models = await api.listModels(url.value.trim())
    model.replaceChildren(option('', 'Pick automatically'), ...models.map((m) => option(m, m)))
    if (settings.model && !models.includes(settings.model)) {
      model.append(option(settings.model, `${settings.model} (not installed)`))
    }
    model.value = settings.model
    status.textContent = `Connected to Ollama. ${models.length} chat models installed.`
  } catch {
    model.replaceChildren(option(settings.model, settings.model || 'Pick automatically'))
    status.className = 'hint error'
    status.textContent = "Can't reach Ollama at this address. Is it running?"
  }
}

async function loadVoices(): Promise<void> {
  const voices = await api.listVoices()
  const english = voices.filter((v) => v.lang.startsWith('en'))
  const others = voices.filter((v) => !v.lang.startsWith('en') && !v.lang.startsWith('nl'))
  voice.replaceChildren(
    option('', 'System voice'),
    ...[...english, ...others].map((v) => option(v.name, `${v.name} (${v.lang})`))
  )
  voice.value = settings.voice
  const dutch = voices.filter((v) => v.lang.startsWith('nl'))
  dutchVoice.replaceChildren(...dutch.map((v) => option(v.name, `${v.name} (${v.lang})`)))
  if (!dutch.some((v) => v.name === settings.dutchVoice)) {
    dutchVoice.append(option(settings.dutchVoice, `${settings.dutchVoice} (not installed)`))
  }
  dutchVoice.value = settings.dutchVoice
}

function showKokoroStatus(st: KokoroStatus): void {
  const text: Record<KokoroStatus['state'], string> = {
    off: 'Kokoro starts when it is first needed.',
    starting: st.message,
    copying: st.message,
    downloading: st.message,
    ready: 'Kokoro is ready.',
    error: `Kokoro isn't working, so the Mac voice is used: ${st.message}`
  }
  kokoroStatus.textContent = text[st.state]
  kokoroStatus.className = st.state === 'error' ? 'hint error' : st.state === 'ready' ? 'hint ok' : 'hint'
}

function render(): void {
  brainSel.value = settings.brain
  claudeBox.hidden = settings.brain !== 'claude'
  fallback.checked = settings.claudeFallback
  if (document.activeElement !== claudeModel && claudeModel.options.length) claudeModel.value = settings.claudeModel
  url.value = settings.ollamaUrl
  voiceOn.checked = settings.voiceEnabled
  for (const el of [voice, long, engine, kokoroVoice, kokoroSpeed, dutchVoice, rate]) el.disabled = !settings.voiceEnabled
  rate.value = String(settings.rate)
  rateOut.textContent = `(${settings.rate} words per minute)`
  long.value = settings.longReplies
  engine.value = settings.englishEngine
  kokoroBox.hidden = settings.englishEngine !== 'kokoro'
  kokoroVoice.value = settings.kokoroVoice
  kokoroSpeed.value = String(settings.kokoroSpeed)
  kokoroSpeedOut.textContent = `(${settings.kokoroSpeed.toFixed(2)}×)`
  if (document.activeElement !== dutchVoice && dutchVoice.options.length) dutchVoice.value = settings.dutchVoice
  sleep.value = String(settings.sleepAfterMinutes)
  listenOn.checked = settings.listenEnabled
  listenLocale.value = settings.listenLocale
  duckOn.checked = settings.duckMusic
  showListen()
  memoryOn.checked = settings.memoryEnabled
  if (document.activeElement !== embedModel && embedModel.options.length) embedModel.value = settings.embedModel
  character.value = settings.character
  toolsOn.checked = settings.toolsEnabled
  toolsBox.hidden = !settings.toolsEnabled
  toolRounds.value = String(settings.toolRounds)
  weatherOn.checked = settings.weatherTool
  webOn.checked = settings.webTool
  webSearch.value = settings.webSearch
  $('local-search-box').hidden = settings.webSearch !== 'local'
  $('ollama-search-box').hidden = settings.webSearch !== 'ollama'
  if (document.activeElement !== searxngUrl) searxngUrl.value = settings.searxngUrl
  musicOn.checked = settings.musicTool
  if (document.activeElement !== homeCity) homeCity.value = settings.homeCity
  showTools(lastTools)
}

/** Voice input: listening, or why not. */
function showListen(): void {
  const st = listenStatus
  const text: Record<ListenStatus['state'], string> = {
    off: settings?.listenEnabled ? '' : 'Off.',
    building: st.message,
    starting: st.message || 'Starting…',
    waiting: `Listening for "${me().name}".`,
    hearing: 'Listening to your question…',
    paused: `Not listening while ${me().name} answers.`,
    error: st.message
  }
  const parts = [text[st.state], st.state === 'error' || st.state === 'off' ? '' : listenCheck].filter(Boolean)
  listenStatusEl.textContent = parts.join(' ')
  listenStatusEl.className = st.state === 'error' ? 'hint error' : st.state === 'waiting' ? 'hint ok' : 'hint'
}

async function checkListen(): Promise<void> {
  if (!settings.listenEnabled) {
    listenCheck = ''
    return showListen()
  }
  const said = await api.checkListen()
  // Only the parts that add something to the status line.
  listenCheck = /works on this Mac/.test(said) ? '' : said
  showListen()
}

/** Each server from the tools file: running or not, its tools, and "don't ask first". */
function showTools(st: ToolsStatus | null): void {
  lastTools = st
  if (!settings || !st) return
  const trusted = settings.toolsTrusted
  showOwnTools(st)
  toolServers.replaceChildren(
    ...st.servers.filter((srv) => !srv.builtin).map((srv) => {
      const box = document.createElement('div')
      box.className = 'tool-server'
      const head = document.createElement('p')
      head.className = srv.state === 'error' ? 'hint error' : 'hint'
      const changes = srv.tools.filter((t) => !t.readOnly).length
      head.textContent =
        srv.state === 'starting'
          ? `${srv.name}: starting…`
          : srv.state === 'error'
            ? `${srv.name}: didn't start. ${srv.message}`
            : `${srv.name}: ${srv.tools.length} tools${changes ? `, ${changes} can change things` : ''}`
      head.title = srv.tools.map((t) => t.name + (t.readOnly ? ' (reads only)' : '')).join('\n')
      box.append(head)
      if (srv.state === 'ready' && changes) {
        const label = document.createElement('label')
        label.className = 'check'
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.checked = trusted.includes(srv.name)
        cb.addEventListener('change', () => {
          const others = settings!.toolsTrusted.filter((n) => n !== srv.name)
          void save({ toolsTrusted: cb.checked ? [...others, srv.name] : others })
        })
        label.append(cb, ` Let ${srv.name} change things without asking`)
        box.append(label)
      }
      return box
    })
  )
  const lines = [...st.problems]
  if (!st.servers.some((srv) => !srv.builtin) && !st.problems.length) lines.push('No servers in the tools file yet. Add one with "Edit tools file…" (see the README for examples).')
  lines.push(`Tools file: ${st.file}`)
  toolsStatus.textContent = lines.join(' ')
  toolsStatus.className = st.problems.length ? 'hint error' : 'hint'
}

/** The status line under each of Poppy's own tools. */
function showOwnTools(st: ToolsStatus): void {
  const line = (name: 'weather' | 'web' | 'music', on: boolean, extra = ''): void => {
    const el = $<HTMLParagraphElement>(`${name}-status`)
    const srv = st.servers.find((x) => x.builtin && x.name === name)
    const note = keyNotes[name]
    let text = !on ? 'Off.' : !srv ? '' : srv.state === 'error' ? srv.message : `Ready: ${srv.tools.map((t) => t.name).join(', ')}.`
    if (on && srv?.state !== 'error' && extra) text += ` ${extra}`
    if (note) text = note.message
    el.textContent = text
    el.className = note ? (note.ok ? 'hint ok' : 'hint error') : on && srv?.state === 'error' ? 'hint error' : 'hint'
  }
  line('weather', settings!.weatherTool, settings!.homeCity ? '' : 'No home city yet.')
  line(
    'web',
    settings!.webTool,
    settings!.webSearch === 'ollama'
      ? toolKeys.ollama
        ? `Key saved (${toolKeys.ollama}).`
        : ''
      : localSearch === undefined
        ? 'Checking the local search engine…'
        : localSearch === null
          ? 'The local search engine is running.'
          : `But ${localSearch}.`
  )
  if (settings!.webTool && settings!.webSearch === 'local' && localSearch) $('web-status').className = 'hint error'
  line('music', settings!.musicTool, toolKeys.spotify ? `Spotify keys saved (${toolKeys.spotify}): plays songs by name.` : 'No Spotify keys: opens searches in Spotify.')
  removeOllamaKey.hidden = !toolKeys.ollama
  removeSpotify.hidden = !toolKeys.spotify
  ollamaKey.placeholder = toolKeys.ollama ?? 'from ollama.com'
  spotifyId.placeholder = toolKeys.spotify ?? ''
}

async function checkLocalSearch(): Promise<void> {
  if (settings?.webSearch !== 'local') return
  localSearch = undefined
  if (lastTools) showOwnTools(lastTools)
  localSearch = await api.checkLocalSearch()
  if (lastTools) showOwnTools(lastTools)
}

async function saveToolKey(which: 'ollama' | 'spotify', first: string, second?: string): Promise<void> {
  const name = which === 'ollama' ? 'web' : 'music'
  keyNotes[name] = { ok: true, message: first ? 'Checking…' : 'Removing…' }
  if (lastTools) showOwnTools(lastTools)
  const res = await api.setToolKey(which, first, second)
  if (res.ok) {
    ollamaKey.value = which === 'ollama' ? '' : ollamaKey.value
    if (which === 'spotify') spotifyId.value = spotifySecret.value = ''
  }
  keyNotes[name] = res
  toolKeys = await api.toolKeys()
  if (lastTools) showOwnTools(lastTools)
  setTimeout(() => {
    if (keyNotes[name] === res) keyNotes[name] = undefined
    if (lastTools) showOwnTools(lastTools)
  }, res.ok ? 3000 : 8000)
}

async function loadEmbedModels(): Promise<void> {
  let models: string[] = []
  try {
    models = await api.listEmbedModels(url.value.trim())
  } catch {
    // Ollama not reachable: the brain section already says so.
  }
  embedModel.replaceChildren(option('', 'None (search by keywords)'), ...models.map((m) => option(m, m)))
  const short = (m: string): string => m.replace(/:latest$/, '')
  const match = models.find((m) => short(m) === short(settings.embedModel))
  if (match) embedModel.value = match
  else if (settings.embedModel) {
    embedModel.append(option(settings.embedModel, `${settings.embedModel} (not installed)`))
    embedModel.value = settings.embedModel
  } else embedModel.value = ''
}

function showMemoryStats(st: MemoryStats | null): void {
  if (!st) {
    memoryStatus.textContent = `${me().name}'s memory couldn't start.`
    return
  }
  const parts = [`${st.facts} facts`, `${st.entities} people and things`, `${st.lessons} lessons`]
  let text = `${me().name} knows ${parts.join(', ')}.`
  if (st.embeddings === 'missing') text += ` The search model isn't installed: run "ollama pull ${settings?.embedModel || 'nomic-embed-text'}". Until then ${me().name} searches by keywords.`
  memoryStatus.textContent = text
  memoryStatus.className = st.embeddings === 'missing' ? 'hint error' : 'hint'
}

function showClaude(st: typeof claude, note?: { ok: boolean; message: string }): void {
  claude = st
  removeKey.hidden = !st.keySet
  claudeKey.placeholder = st.masked ?? 'sk-ant-…'
  let text: string
  let cls = 'hint'
  if (note) {
    text = note.message
    cls = note.ok ? 'hint ok' : 'hint error'
  } else if (!st.keySet) {
    text = `No key yet: ${me().name} uses Ollama until you add one.`
  } else if (st.lastProblem) {
    text = `Key saved (${st.masked}). Last time Claude didn't answer: ${st.lastProblem}.`
    cls = 'hint error'
  } else text = `Key saved (${st.masked}).`
  keyStatus.textContent = text
  keyStatus.className = cls
}

async function loadClaudeModels(): Promise<void> {
  const res = claude.keySet ? await api.listClaudeModels() : { ok: false, models: [], message: '' }
  const models = res.models.length ? res.models : [settings.claudeModel]
  if (!models.includes(settings.claudeModel)) models.unshift(settings.claudeModel)
  claudeModel.replaceChildren(...models.map((m) => option(m, m)))
  claudeModel.value = settings.claudeModel
  if (!res.ok && res.message && claude.keySet) showClaude(claude, { ok: false, message: res.message })
}

async function saveKey(value: string): Promise<void> {
  keyStatus.className = 'hint'
  keyStatus.textContent = value ? 'Checking the key…' : 'Removing the key…'
  const res = await api.setClaudeKey(value)
  claudeKey.value = ''
  showClaude(await api.claudeStatus(), res)
  if (res.ok) await loadClaudeModels()
}

async function save(patch: Partial<Settings>): Promise<void> {
  settings = await api.setSettings(patch)
  render()
}

url.addEventListener('change', async () => {
  await save({ ollamaUrl: url.value.trim().replace(/\/+$/, '') || 'http://127.0.0.1:11434' })
  await loadModels()
})
model.addEventListener('change', () => save({ model: model.value }))
brainSel.addEventListener('change', () => save({ brain: brainSel.value as Settings['brain'] }))
claudeModel.addEventListener('change', () => save({ claudeModel: claudeModel.value }))
fallback.addEventListener('change', () => save({ claudeFallback: fallback.checked }))
$('save-key').addEventListener('click', () => {
  if (claudeKey.value.trim()) void saveKey(claudeKey.value)
})
claudeKey.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && claudeKey.value.trim()) void saveKey(claudeKey.value)
})
removeKey.addEventListener('click', () => void saveKey(''))
api.onClaudeStatus((st) => showClaude(st))
$('refresh').addEventListener('click', () => loadModels())
voiceOn.addEventListener('change', () => save({ voiceEnabled: voiceOn.checked }))
voice.addEventListener('change', () => save({ voice: voice.value }))
rate.addEventListener('input', () => (rateOut.textContent = `(${rate.value} words per minute)`))
rate.addEventListener('change', () => save({ rate: Number(rate.value) }))
sleep.addEventListener('change', () => {
  const minutes = Math.min(240, Math.max(1, Math.round(Number(sleep.value) || 10)))
  void save({ sleepAfterMinutes: minutes })
})
$('test-en').addEventListener('click', () => api.testVoice('en'))
$('test-nl').addEventListener('click', () => api.testVoice('nl'))
long.addEventListener('change', () => save({ longReplies: long.value as Settings['longReplies'] }))
engine.addEventListener('change', () => save({ englishEngine: engine.value as Settings['englishEngine'] }))
kokoroVoice.addEventListener('change', () => save({ kokoroVoice: kokoroVoice.value }))
kokoroSpeed.addEventListener('input', () => (kokoroSpeedOut.textContent = `(${Number(kokoroSpeed.value).toFixed(2)}×)`))
kokoroSpeed.addEventListener('change', () => save({ kokoroSpeed: Number(kokoroSpeed.value) }))
dutchVoice.addEventListener('change', () => save({ dutchVoice: dutchVoice.value }))
listenLocale.replaceChildren(...LISTEN_LOCALES.map((l) => option(l.id, l.label)))
listenOn.addEventListener('change', async () => {
  await save({ listenEnabled: listenOn.checked })
  void checkListen()
})
listenLocale.addEventListener('change', async () => {
  await save({ listenLocale: listenLocale.value as Settings['listenLocale'] })
  void checkListen()
})
duckOn.addEventListener('change', () => save({ duckMusic: duckOn.checked }))
api.onListenStatus((st) => {
  listenStatus = st
  showListen()
})
memoryOn.addEventListener('change', () => save({ memoryEnabled: memoryOn.checked }))
embedModel.addEventListener('change', () => save({ embedModel: embedModel.value }))
$('open-memory').addEventListener('click', () => api.openMemory())
character.addEventListener('change', () => save({ character: character.value as Settings['character'] }))
toolsOn.addEventListener('change', () => save({ toolsEnabled: toolsOn.checked }))
toolRounds.addEventListener('change', () => {
  const n = Math.min(10, Math.max(1, Math.round(Number(toolRounds.value) || 5)))
  void save({ toolRounds: n })
})
weatherOn.addEventListener('change', () => save({ weatherTool: weatherOn.checked }))
webOn.addEventListener('change', () => save({ webTool: webOn.checked }))
webSearch.addEventListener('change', async () => {
  await save({ webSearch: webSearch.value as Settings['webSearch'] })
  void checkLocalSearch()
})
searxngUrl.addEventListener('change', async () => {
  await save({ searxngUrl: searxngUrl.value.trim().replace(/\/+$/, '') || 'http://127.0.0.1:8890' })
  void checkLocalSearch()
})
musicOn.addEventListener('change', () => save({ musicTool: musicOn.checked }))
homeCity.addEventListener('change', () => save({ homeCity: homeCity.value.trim().slice(0, 100) }))
$('save-ollama-key').addEventListener('click', () => {
  if (ollamaKey.value.trim()) void saveToolKey('ollama', ollamaKey.value)
})
ollamaKey.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && ollamaKey.value.trim()) void saveToolKey('ollama', ollamaKey.value)
})
removeOllamaKey.addEventListener('click', () => void saveToolKey('ollama', ''))
$('save-spotify').addEventListener('click', () => {
  if (spotifyId.value.trim() || spotifySecret.value.trim()) void saveToolKey('spotify', spotifyId.value, spotifySecret.value)
})
removeSpotify.addEventListener('click', () => void saveToolKey('spotify', '', ''))
api.onToolKeys((k) => {
  toolKeys = k
  if (lastTools) showOwnTools(lastTools)
})
void api.toolKeys().then((k) => {
  toolKeys = k
  if (lastTools) showOwnTools(lastTools)
})
$('edit-tools').addEventListener('click', () => api.openToolsFile())
$('reload-tools').addEventListener('click', () => api.reloadTools())
api.onToolsStatus(showTools)
void api.toolsStatus().then(showTools)
api.onMemoryChanged(showMemoryStats)
void api.memoryStats().then(showMemoryStats)
kokoroVoice.replaceChildren(...KOKORO_VOICES.map((v) => option(v.id, v.label)))
api.onKokoroStatus(showKokoroStatus)
void api.getKokoroStatus().then(showKokoroStatus)

api.onSettingsChanged((s) => {
  settings = s
  render()
  if (document.activeElement !== model) model.value = s.model
})

api.getSettings().then(async (s) => {
  settings = s
  render()
  showClaude(await api.claudeStatus())
  void checkLocalSearch()
  listenStatus = await api.listenStatus()
  void checkListen()
  await Promise.all([loadModels(), loadVoices(), loadEmbedModels(), loadClaudeModels()])
})

// No Mac title bar: the drawn × and Esc close the window.
$('close').addEventListener('click', () => api.closeSettings())
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.closeSettings()
})
$('minimize').addEventListener('click', () => api.closeSettings())

// Poppy or Polly: names in the page follow the choice; re-render the texts made in code.
followCharacter(() => {
  void api.memoryStats().then(showMemoryStats)
  showClaude(claude)
  if (settings) showListen()
})
