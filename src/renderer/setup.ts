import { followCharacter, me } from './character'
import { fill } from '../shared/buddy'
import {
  chatModels,
  EMBED_MODEL,
  hasModel,
  LISTEN_MACOS,
  macChecks,
  majorOf,
  MODELS,
  modelFor,
  poseFor,
  STEPS,
  type Check,
  type CheckState,
  type SetupStep,
  type StepMood
} from '../shared/setup'
import type { Character, KokoroStatus, SetupInstall, SetupProgress, SetupState, Settings } from '../shared/types'

/**
 * The setup guide: one step at a time, with her own drawing for how it's going and her words in the
 * speech balloon. It checks the Mac, Ollama and a model, her voice and her tools, and installs what's
 * missing only after the user's yes (main does the installing, see src/main/setup.ts).
 */
const api = window.poppy
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

// Her own drawings and their hand-lettered names (never redrawn). Vite needs the glob options inline.
type Urls = Record<string, string>
const POSES: Record<Character, Urls> = {
  male: import.meta.glob('../../assets/states/*.png', { eager: true, import: 'default' }) as Urls,
  female: import.meta.glob('../../assets/female/states/*.png', { eager: true, import: 'default' }) as Urls
}
const LABELS: Record<Character, Urls> = {
  male: import.meta.glob('../../assets/chat/label-*.png', { eager: true, import: 'default' }) as Urls,
  female: import.meta.glob('../../assets/female/chat/label-*.png', { eager: true, import: 'default' }) as Urls
}

const TITLES: Record<SetupStep, string> = {
  hello: 'Hi there!',
  mac: 'Your Mac',
  ollama: 'My brain: Ollama',
  model: 'Something to think with',
  voice: 'My voice',
  tools: 'My tools',
  done: 'All set!'
}
const MARKS: Record<CheckState, string> = { ok: 'ready', warn: 'okay', missing: 'missing' }

let step = 0
let settings: Settings | null = null
let character: Character = 'female'
let state: SetupState | null = null
let checking = false
let busy: SetupInstall['what'] | null = null
let progress: SetupProgress | null = null
/** What went wrong with the last install, and the download page that does it by hand. */
let problem: { text: string; page?: string } | null = null
let kokoro: KokoroStatus = { state: 'off', message: '' }
let modelPick = ''
let wantTools = true
let shownPose = ''

const t = (text: string): string => fill(text, me())

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

function button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, label)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

function checkList(checks: Check[]): HTMLUListElement {
  const ul = el('ul', 'checks')
  for (const c of checks) {
    const li = el('li')
    li.append(el('span', 'what', t(c.label)), el('span', `mark ${c.state}`, MARKS[c.state]), el('span', 'note', t(c.note)))
    ul.append(li)
  }
  return ul
}

const check = (id: string, ok: boolean | CheckState, label: string, note: string): Check => ({
  id,
  state: ok === true ? 'ok' : ok === false ? 'missing' : ok,
  label,
  note
})

// ---------- installing ----------

async function refresh(): Promise<void> {
  checking = true
  render()
  try {
    state = await api.setupState()
  } finally {
    checking = false
    render()
  }
}

async function run(job: SetupInstall): Promise<boolean> {
  busy = job.what
  progress = null
  problem = null
  render()
  const r = await api.setupInstall(job)
  busy = null
  progress = null
  if (!r.ok) problem = { text: r.message, page: r.page }
  await refresh()
  return r.ok
}

async function getModel(model: string): Promise<void> {
  if (!state) return
  if (!hasModel(state.ollama.models, model) && !(await run({ what: 'model', model }))) return
  await api.setSettings({ model })
  if (state && !hasModel(state.ollama.models, EMBED_MODEL.model)) await run({ what: 'model', model: EMBED_MODEL.model })
}

/** The yes/no under her question: "Yes, …" runs the job; without Homebrew it may be the download page. */
function ask(yes: string, job: SetupInstall | (() => void), no?: [string, () => void]): HTMLElement {
  const row = el('div', 'ask')
  row.append(button(yes, () => (typeof job === 'function' ? job() : void run(job))))
  if (no) row.append(button(no[0], no[1]))
  return row
}

const pageButton = (label: string, key: string): HTMLButtonElement => button(label, () => api.openSetupPage(key))

// ---------- the steps ----------

interface View {
  mood: StepMood
  say: (string | HTMLElement)[]
  body?: HTMLElement[]
  next?: string
}

function macView(): View {
  if (!state) return { mood: 'checking', say: ['Let me have a look at your Mac…'] }
  const checks = macChecks(state.mac)
  const by = (id: string): Check => checks.find((c) => c.id === id)!
  const body: HTMLElement[] = [checkList(checks)]
  if (!state.mac.brew) {
    const p = el('p', 'hint', 'With Homebrew I can install things for you. ')
    const a = el('a', 'link', 'Get Homebrew')
    a.addEventListener('click', () => api.openSetupPage('brew'))
    p.append(a)
    body.push(p)
  }
  if (by('macos').state === 'missing') return { mood: 'missing', say: ['Oh no. I need a newer macOS: 12 or later.'], body }
  if (by('disk').state === 'missing') return { mood: 'missing', say: ['Your disk is very full. I need a few GB for my brain.'], body }
  const say: (string | HTMLElement)[] = []
  if (!state.mac.swift) {
    say.push(t("Your Mac is fine for me! For voice input (saying my name) I'd need Apple's command line tools. Want them?"))
    say.push(ask("Yes, open Apple's installer", { what: 'swift' }))
    return { mood: 'ok', say, body }
  }
  const great = checks.every((c) => c.state === 'ok')
  say.push(great ? `Ooh, ${state.mac.chipName || 'a fast Mac'} with ${state.mac.memGB} GB. That's a great home for me!` : 'Your Mac works for me! A few extras are missing, but I can do without them.')
  return { mood: 'ok', say, body }
}

function ollamaView(): View {
  if (!state) return { mood: 'checking', say: ['Looking for Ollama…'] }
  const o = state.ollama
  const body = [
    checkList([
      check('installed', o.installed, 'Ollama installed', 'the app that runs language models on your Mac'),
      check('running', o.running, o.running ? 'Ollama is running' : 'Ollama is not running', o.running ? `${chatModels(o.models).length} chat model(s)` : 'it has to run for me to think')
    ])
  ]
  if (!o.installed) {
    const say: (string | HTMLElement)[] = ["I think with Ollama, and it isn't on your Mac yet. May I install it for you?"]
    if (state.mac.brew) say.push(ask('Yes, install Ollama', { what: 'ollama' }, ['Download page', () => api.openSetupPage('ollama')]))
    else say.push(ask('Open the download page', () => api.openSetupPage('ollama'), ["I've installed it", () => void refresh()]))
    return { mood: 'missing', say, body }
  }
  if (!o.running) return { mood: 'missing', say: ["Ollama is here, but it's asleep. May I wake it up?", ask('Yes, start Ollama', { what: 'start-ollama' })], body }
  return { mood: 'ok', say: ['Ollama is awake. I can think!'], body }
}

function modelView(): View {
  if (!state) return { mood: 'checking', say: ['Checking my models…'] }
  if (!state.ollama.running) return { mood: 'missing', say: ['Ollama has to run first. Go back one step and wake it up.'] }
  const models = state.ollama.models
  const rec = modelFor(state.mac)
  if (!modelPick) modelPick = settings && hasModel(models, settings.model) ? settings.model : rec.model
  const choice = MODELS.find((m) => m.model === modelPick)
  const have = hasModel(models, modelPick)
  const memory = hasModel(models, EMBED_MODEL.model)

  const select = el('select')
  select.id = 'model'
  const names = [...new Set([...MODELS.map((m) => m.model), ...chatModels(models)])]
  for (const name of names) {
    const m = MODELS.find((x) => x.model === name)
    const o = el('option', '', m ? `${name} · ${m.sizeGB} GB${name === rec.model ? ' · best here' : ''}` : `${name} · installed`)
    o.value = name
    o.selected = name === modelPick
    select.append(o)
  }
  select.disabled = !!busy
  select.addEventListener('change', () => {
    modelPick = select.value
    if (hasModel(models, modelPick)) void api.setSettings({ model: modelPick })
    render()
  })
  const field = el('span', 'field select')
  field.append(select)
  const label = el('label', 'pick-label', 'Pick my brain')
  label.htmlFor = 'model'
  const body = [
    checkList([
      check('model', have, have ? `${modelPick} is here` : `${modelPick} isn't downloaded`, choice ? choice.note : 'one of your own models'),
      check('embed', memory, memory ? `${EMBED_MODEL.model} is here` : `${EMBED_MODEL.model} isn't downloaded`, 'for searching my memory (small)')
    ]),
    label,
    field
  ]
  if (have && memory) return { mood: 'ok', say: [`Yum! ${modelPick} to think with and ${EMBED_MODEL.model} for my memory.`], body }
  const size = (have ? 0 : (choice?.sizeGB ?? 0)) + (memory ? 0 : EMBED_MODEL.sizeGB)
  const what = have ? `${EMBED_MODEL.model} for my memory` : memory ? `${modelPick} as my brain` : `${modelPick} as my brain and ${EMBED_MODEL.model} for my memory`
  return {
    mood: 'missing',
    say: [`I'd love ${what}. That's about ${Math.round(size * 10) / 10} GB to download. May I?`, ask('Yes, download it', () => void getModel(modelPick))],
    body
  }
}

function voiceView(): View {
  if (!state) return { mood: 'checking', say: ['Clearing my throat…'] }
  const v = state.voice
  const listen = majorOf(state.mac.macos) >= LISTEN_MACOS && state.mac.swift
  const files = v.files || kokoro.state === 'ready'
  const body = [
    checkList([
      check('python', !!v.python, v.python ? 'Python 3' : 'No Python 3.10 or newer', v.python ? v.python : 'Kokoro (my nice voice) runs on Python'),
      check('kokoro', v.kokoro, v.kokoro ? 'Kokoro installed' : 'Kokoro not installed', 'a natural English voice that runs on your Mac'),
      check(
        'files',
        files ? 'ok' : v.kokoro ? 'warn' : 'missing',
        files ? 'Voice files downloaded' : 'Voice files not downloaded yet',
        kokoro.message || 'about 350 MB, fetched once'
      ),
      check('listen', listen ? 'ok' : 'warn', listen ? 'Voice input possible' : 'No voice input', listen ? 'turn on "Listen for {name}" in Settings' : `needs macOS ${LISTEN_MACOS} and Apple's command line tools`)
    ])
  ]
  const skip: [string, () => void] = ['Skip, use a Mac voice', () => go(1)]
  if (!v.python) {
    const say: (string | HTMLElement)[] = ['For my nice voice I need Python. May I install it with Homebrew?']
    say.push(state.mac.brew ? ask('Yes, install Python', { what: 'python' }, skip) : ask('Python download page', () => api.openSetupPage('python'), skip))
    return { mood: 'missing', say, body }
  }
  if (!v.kokoro) return { mood: 'missing', say: ['Almost! May I install my voice, Kokoro? It runs on your Mac.', ask('Yes, install my voice', { what: 'kokoro' }, skip)], body }
  if (kokoro.state === 'downloading' || kokoro.state === 'starting' || kokoro.state === 'copying')
    return { mood: 'working', say: [kokoro.message || 'Getting my voice ready…'], body }
  if (kokoro.state === 'error') return { mood: 'failed', say: [`My voice didn't start: ${kokoro.message}`, ask('Try again', () => api.testVoice('en'))], body }
  return { mood: 'ok', say: ['My voice is ready. Want to hear it?', ask('Hear my voice', () => api.testVoice('en'))], body }
}

function toolsView(): View {
  if (!state) return { mood: 'checking', say: ['Looking in my toolbox…'] }
  const tl = state.tools
  const box = el('label', 'check')
  const input = el('input')
  input.type = 'checkbox'
  input.checked = wantTools
  input.addEventListener('change', () => (wantTools = input.checked))
  box.append(input, t(' Let {name} use tools: weather, web search, Spotify'))
  const body: HTMLElement[] = [
    box,
    checkList([
      check('docker', tl.dockerInstalled, tl.dockerInstalled ? 'Docker installed' : 'No Docker', 'runs my search engine (and MCP servers that need it)'),
      check('search', tl.search ? 'ok' : tl.dockerInstalled ? 'warn' : 'missing', tl.search ? 'Local web search is running' : 'Local web search is off', 'searches the web from your Mac, no account needed'),
      check('npx', !!tl.npx ? 'ok' : 'warn', tl.npx ? 'Node (npx)' : 'No Node found', tl.npx ? 'for MCP servers like the files server' : 'MCP servers that start with npx need it')
    ])
  ]
  if (!tl.npx) {
    const p = el('p', 'hint')
    const a = el('a', 'link', 'Get Node')
    a.addEventListener('click', () => api.openSetupPage('node'))
    p.append(a)
    body.push(p)
  }
  const skip: [string, () => void] = ['Skip web search', () => go(1)]
  if (!tl.dockerInstalled) {
    const say: (string | HTMLElement)[] = ['For web search that stays on your Mac I use Docker. May I install Docker Desktop? (It\'s big: about 2 GB.)']
    say.push(state.mac.brew ? ask('Yes, install Docker', { what: 'docker' }, skip) : ask('Docker download page', () => api.openSetupPage('docker'), skip))
    return { mood: 'missing', say, body }
  }
  if (!tl.search) return { mood: 'missing', say: ['Docker is here. May I start it and my little search engine?', ask('Yes, start it', { what: 'search' }, skip)], body }
  return { mood: 'ok', say: ['My toolbox is ready! Web search runs right here on your Mac.'], body }
}

function doneView(): View {
  const s = state
  const brain = !!s && s.ollama.running && chatModels(s.ollama.models).length > 0
  const checks = s
    ? [
        check('brain', brain, brain ? `Thinking with ${settings?.model ?? 'Ollama'}` : 'No brain yet', brain ? 'Ollama, on this Mac' : 'Ollama and a model are needed'),
        check('memory', hasModel(s.ollama.models, EMBED_MODEL.model) ? 'ok' : 'warn', 'Memory', hasModel(s.ollama.models, EMBED_MODEL.model) ? 'I remember what you tell me' : 'works, searching by keywords'),
        check('voice', s.voice.kokoro ? 'ok' : 'warn', s.voice.kokoro ? 'Kokoro voice' : 'Mac voice', s.voice.kokoro ? 'my nice voice' : 'Kokoro can be added later'),
        check('tools', wantTools ? (s.tools.search ? 'ok' : 'warn') : 'warn', wantTools ? 'Tools on' : 'Tools off', wantTools ? (s.tools.search ? 'weather, web search, Spotify' : 'weather and Spotify; web search asks to start Docker') : 'turn them on in Settings any time')
      ]
    : []
  const body = [checkList(checks)]
  if (brain) return { mood: 'ok', say: ["I'm ready! Click me any time to chat. My menu-bar icon has everything else."], body, next: "Let's chat!" }
  return { mood: 'missing', say: ['I still need Ollama and a model to think. You can run this check again from my menu-bar icon → Setup check…'], body, next: 'Close' }
}

function helloView(): View {
  const pick = el('div', 'pick')
  for (const c of ['female', 'male'] as const) {
    const b = button(c === 'female' ? 'Polly' : 'Poppy', () => void api.setSettings({ character: c }), `btn${character === c ? ' on' : ''}`)
    pick.append(b)
  }
  return {
    mood: 'ok',
    say: ["Hi, I'm {name}! I'll check your Mac and set up everything I need. I always ask before I install anything."].map(t),
    body: [el('label', '', 'Who lives on your desk?'), pick]
  }
}

const VIEWS: Record<SetupStep, () => View> = {
  hello: helloView,
  mac: macView,
  ollama: ollamaView,
  model: modelView,
  voice: voiceView,
  tools: toolsView,
  done: doneView
}

// ---------- drawing it ----------

function render(): void {
  const name = STEPS[step]
  let view = VIEWS[name]()
  if (checking && !state) view = { ...view, mood: 'checking' }
  if (busy) view = { ...view, mood: 'working', say: [busyText()] }
  else if (problem) {
    const row = el('div', 'ask')
    if (problem.page) row.append(pageButton('Open the download page', problem.page))
    row.append(button('Check again', () => ((problem = null), void refresh())))
    view = { ...view, mood: 'failed', say: [`Hmm, that didn't work: ${problem.text}`, row] }
  }

  $('step-of').textContent = `Step ${step + 1} of ${STEPS.length}`
  $('title').textContent = TITLES[name]
  const say = $('say')
  say.replaceChildren(...view.say.map((x) => (typeof x === 'string' ? el('div', '', t(x)) : x)))
  if (busy) say.append(ask('Stop', () => api.stopSetupInstall()))
  $('body').replaceChildren(...(view.body ?? []))

  const pose = poseFor(name, view.mood)
  if (pose !== shownPose) {
    shownPose = pose
    const img = $<HTMLImageElement>('pose')
    img.src = POSES[character][`../../assets/${character === 'female' ? 'female/' : ''}states/${pose}.png`] ?? ''
    $<HTMLImageElement>('label').src = LABELS[character][`../../assets/${character === 'female' ? 'female/' : ''}chat/label-${pose}.png`] ?? ''
    img.alt = `${me().name}, ${pose}`
    img.classList.remove('pop')
    void img.offsetWidth
    img.classList.add('pop')
  }

  $('work').hidden = !busy
  const bar = $('work-bar').parentElement!
  bar.classList.toggle('busy', !!busy && progress?.percent == null)
  $('work-bar').style.width = progress?.percent != null ? `${progress.percent}%` : ''
  $('work-text').textContent = progress?.text ?? ''

  $<HTMLButtonElement>('back').hidden = step === 0 || !!busy
  const next = $<HTMLButtonElement>('next')
  next.hidden = !!busy || (checking && !state && step > 0)
  next.textContent = view.next ?? (step === 0 ? "Let's go" : 'Next')
}

function busyText(): string {
  switch (busy) {
    case 'ollama':
      return 'Installing Ollama… This takes a few minutes.'
    case 'start-ollama':
      return 'Waking up Ollama…'
    case 'model':
      return 'Downloading my brain… nom nom.'
    case 'python':
      return 'Installing Python…'
    case 'kokoro':
      return 'Installing my voice…'
    case 'docker':
      return 'Installing Docker… It is a big one.'
    case 'search':
      return 'Starting Docker and my search engine…'
    case 'swift':
      return "Apple's installer is open: click Install there, I'll wait."
    default:
      return 'Working on it…'
  }
}

function go(by: number): void {
  const name = STEPS[step]
  if (by > 0 && name === 'tools') void api.setSettings({ toolsEnabled: wantTools })
  if (by > 0 && name === 'done') {
    if (state?.ollama.running && chatModels(state.ollama.models).length > 0) api.finishSetup()
    else api.closeSetup()
    return
  }
  problem = null
  step = Math.max(0, Math.min(STEPS.length - 1, step + by))
  render()
  if (STEPS[step] === 'mac' && !state && !checking) void refresh()
}

$('next').addEventListener('click', () => go(1))
$('back').addEventListener('click', () => go(-1))
$('close').addEventListener('click', () => api.closeSetup())
$('minimize').addEventListener('click', () => api.closeSetup())
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.closeSetup()
})

api.onSetupProgress((p) => {
  if (p.what !== busy) return
  progress = p
  render()
})
api.onKokoroStatus((s) => {
  kokoro = s
  if (!busy) render()
})

followCharacter(() => render())
api.onSettingsChanged((s) => {
  settings = s
  if (s.character !== character) {
    character = s.character
    shownPose = ''
  }
  render()
})

void (async () => {
  const [s, first, k] = await Promise.all([api.getSettings(), api.setupFirst(), api.getKokoroStatus()])
  settings = s
  kokoro = k
  wantTools = first ? true : s.toolsEnabled
  // A brand-new install starts with Polly picked; the hello step can switch to Poppy.
  if (first && s.character !== 'female') settings = await api.setSettings({ character: 'female' })
  character = settings.character
  render()
  // Look at the Mac right away, so the next steps are quick.
  void refresh()
})()
