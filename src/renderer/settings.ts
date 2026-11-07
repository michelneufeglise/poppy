import { KOKORO_VOICES, type KokoroStatus, type Settings } from '../shared/types'

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
  await Promise.all([loadModels(), loadVoices()])
})

// No Mac title bar: the drawn × and Esc close the window.
$('close').addEventListener('click', () => api.closeSettings())
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.closeSettings()
})
$('minimize').addEventListener('click', () => api.closeSettings())
