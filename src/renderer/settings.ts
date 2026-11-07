import { KOKORO_VOICES, type BrainStatus, type KokoroStatus, type MemoryStats, type Settings, type ToolsStatus } from '../shared/types'

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
const memoryOn = $<HTMLInputElement>('memory-on')
const embedModel = $<HTMLSelectElement>('embed')
const memoryStatus = $<HTMLParagraphElement>('memory-status')
const toolsOn = $<HTMLInputElement>('tools-on')
const toolsBox = $<HTMLDivElement>('tools-box')
const toolServers = $<HTMLDivElement>('tool-servers')
const toolsStatus = $<HTMLParagraphElement>('tools-status')
const toolRounds = $<HTMLInputElement>('tool-rounds')
let lastTools: ToolsStatus | null = null
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
  memoryOn.checked = settings.memoryEnabled
  if (document.activeElement !== embedModel && embedModel.options.length) embedModel.value = settings.embedModel
  toolsOn.checked = settings.toolsEnabled
  toolsBox.hidden = !settings.toolsEnabled
  toolRounds.value = String(settings.toolRounds)
  showTools(lastTools)
}

/** Each server from the tools file: running or not, its tools, and "don't ask first". */
function showTools(st: ToolsStatus | null): void {
  lastTools = st
  if (!settings || !st) return
  const trusted = settings.toolsTrusted
  toolServers.replaceChildren(
    ...st.servers.map((srv) => {
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
  if (!st.servers.length && !st.problems.length) lines.push('No servers in the tools file yet. Add one with "Edit tools file…" (see the README for examples).')
  lines.push(`Tools file: ${st.file}`)
  toolsStatus.textContent = lines.join(' ')
  toolsStatus.className = st.problems.length ? 'hint error' : 'hint'
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
    memoryStatus.textContent = "Poppy's memory couldn't start."
    return
  }
  const parts = [`${st.facts} facts`, `${st.entities} people and things`, `${st.lessons} lessons`]
  let text = `Poppy knows ${parts.join(', ')}.`
  if (st.embeddings === 'missing') text += ` The search model isn't installed: run "ollama pull ${settings?.embedModel || 'nomic-embed-text'}". Until then Poppy searches by keywords.`
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
    text = 'No key yet: Poppy uses Ollama until you add one.'
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
memoryOn.addEventListener('change', () => save({ memoryEnabled: memoryOn.checked }))
embedModel.addEventListener('change', () => save({ embedModel: embedModel.value }))
$('open-memory').addEventListener('click', () => api.openMemory())
toolsOn.addEventListener('change', () => save({ toolsEnabled: toolsOn.checked }))
toolRounds.addEventListener('change', () => {
  const n = Math.min(10, Math.max(1, Math.round(Number(toolRounds.value) || 5)))
  void save({ toolRounds: n })
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
  await Promise.all([loadModels(), loadVoices(), loadEmbedModels(), loadClaudeModels()])
})

// No Mac title bar: the drawn × and Esc close the window.
$('close').addEventListener('click', () => api.closeSettings())
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.closeSettings()
})
$('minimize').addEventListener('click', () => api.closeSettings())
