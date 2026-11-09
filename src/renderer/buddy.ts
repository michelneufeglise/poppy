import { MAX_FILES } from '../shared/attachments'
import { buddyOf } from '../shared/buddy'
import { Blinker, type BlinkFrames } from './blink'
import { Motion } from './motion'
import {
  DESK_AFTER_MS,
  DESK_EVERY,
  EXTRA_POSES,
  HEARING_EVERY,
  basePose,
  between,
  nextRestPose,
  restStage,
  nextHearingPose,
  speakingPose,
  type Pose
} from './poses'
import { FIRST_CHANGE_MS, isWaitingPose, nextWaitingDelay, nextWaitingPose } from './waiting'
import { STATES, type AttachmentInfo, type AttachResult, type Character, type Mood, type PoppyState } from '../shared/types'

const api = window.poppy

// The user's own drawings, cut from the emotion sheets. Never redrawn. Male Poppy in assets/states,
// female Poppy in assets/female/states; the state names are hand-lettered on the same sheets.
// (Vite needs the glob options written inline.)
type Urls = Record<string, string>
const urls: Record<Character, Urls> = {
  male: import.meta.glob('../../assets/states/*.png', { eager: true, import: 'default' }) as Urls,
  female: import.meta.glob('../../assets/female/states/*.png', { eager: true, import: 'default' }) as Urls
}
const labelUrls: Record<Character, Urls> = {
  male: import.meta.glob('../../assets/chat/label-*.png', { eager: true, import: 'default' }) as Urls,
  female: import.meta.glob('../../assets/female/chat/label-*.png', { eager: true, import: 'default' }) as Urls
}
// Polly's blink frames (scripts/cut_blink_female.py): <state>-half.png and <state>-closed.png.
const blinkUrls = import.meta.glob('../../assets/female/blink/*.png', { eager: true, import: 'default' }) as Urls
let character: Character = 'male'
// listening-2 is Polly's second listening drawing (poses.ts); Poppy has none, so he shows his listening.
const urlFor = (s: Pose): string =>
  (character === 'female' && urls.female[`../../assets/female/states/${s}.png`]) || urls.male[`../../assets/states/${basePose(s)}.png`]
const labelFor = (pose: Pose): string => {
  const s = basePose(pose)
  return (character === 'female' && labelUrls.female[`../../assets/female/chat/label-${s}.png`]) || labelUrls.male[`../../assets/chat/label-${s}.png`]
}
const blinkFor = (s: Pose): BlinkFrames | null => {
  const closed = character === 'female' && blinkUrls[`../../assets/female/blink/${s}-closed.png`]
  return closed ? { closed, half: blinkUrls[`../../assets/female/blink/${s}-half.png`] } : null
}
const TWO_LINE_LABELS = new Set<PoppyState>(['sad-hello', 'bye', 'clapping'])
const closeIcon = new URL('../../assets/chat/close.png', import.meta.url).href

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const poppy = $<HTMLDivElement>('poppy')
const bubble = $<HTMLDivElement>('bubble')
const panel = $<HTMLElement>('panel')
const log = $<HTMLDivElement>('log')
const form = $<HTMLFormElement>('form')
const composer = form
const say = $<HTMLDivElement>('say')
const input = $<HTMLTextAreaElement>('input')
const label = $<HTMLImageElement>('label')
const chips = $<HTMLDivElement>('attachments')
const drop = $<HTMLDivElement>('drop')

label.addEventListener('load', () => (label.style.width = `${label.naturalWidth * 0.5}px`))

/** Message text goes in its own span, so it can use the empty paper inside the bubble's wide edge. */
function setText(el: HTMLElement, text: string): void {
  const span = document.createElement('span')
  span.className = 'text'
  span.textContent = text
  el.replaceChildren(span)
}

// ---------- drawings ----------

const POSES: readonly Pose[] = [...STATES, ...EXTRA_POSES]
const imgs = {} as Record<Pose, HTMLImageElement>
const masks = {} as Record<Pose, { w: number; h: number; alpha: Uint8ClampedArray } | undefined>

/** Loads a drawing and keeps its transparency, so only Poppy himself (or herself) catches the mouse. */
function load(s: Pose): void {
  const img = imgs[s]
  const src = urlFor(s)
  if (img.src === new URL(src, location.href).href) return
  img.src = src
  img.decode().then(() => {
    if (img.src !== new URL(urlFor(s), location.href).href) return // switched again meanwhile
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0)
    masks[s] = { w: c.width, h: c.height, alpha: ctx.getImageData(0, 0, c.width, c.height).data }
  })
}

// Motion layers (see motion.ts): lean while dragged > one-shot moves > the state's loop > the drawings.
const layer = (parent: HTMLElement): HTMLDivElement => parent.appendChild(Object.assign(document.createElement('div'), { className: 'layer' }))
const leanLayer = layer(poppy)
const reactLayer = layer(leanLayer)
const loopLayer = layer(reactLayer)
for (const s of POSES) {
  const img = document.createElement('img')
  img.alt = ''
  img.draggable = false
  loopLayer.appendChild(img)
  imgs[s] = img
}
const blinker = new Blinker(loopLayer)
const motion = new Motion({ lean: leanLayer, react: reactLayer, loop: loopLayer, shadow: poppy.querySelector<HTMLElement>('.shadow') ?? undefined })

/** Poppy (male) or Polly (female): swaps every drawing, the state's name and what she's called. */
function useCharacter(next: Character): void {
  const first = !imgs.idle.src
  if (next === character && !first) return
  character = next
  const name = buddyOf(next).name
  if (!hearing) $<HTMLTextAreaElement>('input').placeholder = `Ask ${name} anything…`
  $('panel').setAttribute('aria-label', `Chat with ${name}`)
  for (const attr of ['aria-label', 'title']) $('hide').setAttribute(attr, `Hide ${name}`)
  for (const s of POSES) load(s)
  if (!first) label.src = labelFor(state)
  blinker.show(blinkFor(first ? 'idle' : state)) // (state isn't set up yet on the first call)
}
useCharacter('male')

// ---------- state ----------

let state: Pose = 'idle'
let holdTimer = 0
/** A mood shown for a while (holdMs): the waiting poses leave it alone until then. */
let holdUntil = 0
let lastActivity = Date.now()
let sleepAfterMs = 10 * 60_000

function setState(next: Pose, holdMs = 0, then: Pose = 'idle'): void {
  window.clearTimeout(holdTimer)
  holdUntil = holdMs ? Date.now() + holdMs : 0
  if (next !== state) {
    imgs[state].classList.remove('on')
    imgs[next].classList.add('on')
    state = next
    poppy.className = `poppy s-${basePose(next)}`
    label.src = labelFor(next)
    label.classList.toggle('two-lines', TWO_LINE_LABELS.has(basePose(next)))
    motion.setState(basePose(next))
    blinker.show(blinkFor(next))
  }
  // "listening" only makes sense while the chat is open; it may have closed during the hold.
  if (holdMs) holdTimer = window.setTimeout(() => setState(then === 'listening' && panel.hidden ? 'idle' : then), holdMs)
}

function touch(): void {
  lastActivity = Date.now()
}

// While the chat is open and waiting for the user, she switches between calm waiting poses (waiting.ts).
let waitTimer = 0
let waitSince = 0
/** Starts the wait over: listening first, the next pose after a few seconds. */
function restartWaiting(): void {
  window.clearTimeout(waitTimer)
  waitSince = Date.now()
  waitTimer = window.setTimeout(waitStep, FIRST_CHANGE_MS)
}
function waitStep(): void {
  if (panel.hidden) return
  const quiet = !replying && !hearing && Date.now() >= holdUntil && isWaitingPose(basePose(state)) && !input.value
  if (quiet) setState(nextWaitingPose(basePose(state), Date.now() - waitSince))
  waitTimer = window.setTimeout(waitStep, nextWaitingDelay())
}

let bubbleTimer = 0
function showBubble(text: string, hideAfterMs = 0): void {
  window.clearTimeout(bubbleTimer)
  if (!panel.hidden || !text) {
    bubble.hidden = true
    return
  }
  setText(bubble, text)
  bubble.hidden = false
  const span = bubble.firstElementChild as HTMLElement
  span.scrollTop = span.scrollHeight
  if (hideAfterMs) bubbleTimer = window.setTimeout(() => (bubble.hidden = true), hideAfterMs)
}

function wake(): void {
  touch()
  setState('hello', 2500)
  showBubble('Oh! Hi again.', 3500)
}

// Resting on the desktop (poses.ts): awake with a calm pose every 30-60 seconds, then drowsy (sleepier
// poses and short naps; sooner when nobody uses the Mac), a yawn a minute before she dozes off (the
// "tired" drawing), then sleep until hovered or called.
let macIdleMs = 0
window.setInterval(() => {
  api.macIdleSeconds().then((s) => (macIdleMs = s * 1000), () => (macIdleMs = 0))
}, 15_000)
let nextRestAt = Date.now() + DESK_EVERY[0]
window.setInterval(() => {
  const quiet = panel.hidden && !replying
  const idleFor = Date.now() - lastActivity
  const yawnAt = sleepAfterMs - Math.min(60_000, sleepAfterMs / 2)
  // (A tired pose that is being held is a drowsy pose, not the yawn: it ends by itself.)
  if (state === 'tired' && Date.now() >= holdUntil && (!quiet || idleFor < yawnAt)) setState('idle')
  if (!quiet || (state !== 'idle' && state !== 'tired')) return
  if (idleFor > sleepAfterMs) {
    bubble.hidden = true
    setState('sleeping')
  } else if (idleFor > yawnAt) {
    if (state === 'idle') setState('tired')
  } else if (state === 'idle' && idleFor > DESK_AFTER_MS && Date.now() >= nextRestAt) {
    const { pose, holdMs } = nextRestPose(restStage(idleFor, macIdleMs), state)
    nextRestAt = Date.now() + between(DESK_EVERY)
    if (pose === 'sleeping') bubble.hidden = true // a nap
    setState(pose, holdMs, 'idle')
  }
}, 5_000)

// ---------- mouse: click-through, drag, click ----------

function overPoppy(e: MouseEvent): boolean {
  const r = poppy.getBoundingClientRect()
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return false
  const m = masks[state]
  if (!m) return true
  const scale = Math.min(r.width / m.w, r.height / m.h)
  const ox = r.left + (r.width - m.w * scale) / 2
  const oy = r.top + (r.height - m.h * scale) / 2
  const x = Math.floor((e.clientX - ox) / scale)
  const y = Math.floor((e.clientY - oy) / scale)
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return false
  return m.alpha[(y * m.w + x) * 4 + 3] > 24
}

function overUi(e: MouseEvent): boolean {
  const el = document.elementFromPoint(e.clientX, e.clientY)
  return !!el?.closest('#form, #say, #log, #bubble')
}

let interactive = false
let drag: { sx: number; sy: number; wx: number; wy: number; lx: number; ly: number; moved: boolean } | null = null
let pressed = false

window.addEventListener('mousemove', (e) => {
  const onPoppy = overPoppy(e)
  // With the chat open the whole window takes the mouse, so files can be dropped on it.
  const want = pressed || onPoppy || !panel.hidden || overUi(e)
  if (want !== interactive) {
    interactive = want
    api.setInteractive(want)
  }
  if (onPoppy && state === 'sleeping') wake()
})

/** Dragging Poppy, or the chat window's header, moves the whole window. */
async function startDrag(e: PointerEvent, el: HTMLElement): Promise<void> {
  pressed = true
  el.setPointerCapture(e.pointerId)
  const [wx, wy] = await api.getPosition()
  drag = { sx: e.screenX, sy: e.screenY, wx, wy, lx: e.screenX, ly: e.screenY, moved: false }
}

function moveDrag(e: PointerEvent): void {
  if (!drag) return
  const dx = e.screenX - drag.sx
  const dy = e.screenY - drag.sy
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return
  drag.moved = true
  api.setPosition(drag.wx + dx, drag.wy + dy)
  motion.dragMove(e.screenX - drag.lx, e.screenY - drag.ly) // she leans into the move
  drag.lx = e.screenX
  drag.ly = e.screenY
}

/** Returns true when the press was a click rather than a drag. */
function endDrag(): boolean {
  const wasDrag = drag?.moved ?? false
  pressed = false
  drag = null
  touch()
  if (wasDrag) {
    api.savePosition()
    motion.dragEnd() // and wobbles when let go
  }
  return !wasDrag
}

poppy.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !overPoppy(e)) return
  void startDrag(e, poppy)
})
poppy.addEventListener('pointermove', moveDrag)
poppy.addEventListener('pointerup', () => {
  if (!pressed) return
  if (!endDrag()) return
  motion.poke()
  if (state === 'sleeping') wake()
  else togglePanel()
})

const head = $<HTMLElement>('panel-head')
head.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
  void startDrag(e, head)
})
head.addEventListener('pointermove', moveDrag)
head.addEventListener('pointerup', () => {
  if (pressed) endDrag()
})

// ---------- chat: a comic strip ----------
// The user's balloon (top right) is where they type; Poppy's answer goes in her own balloon under it.
// When the user starts the next question, the last pair moves up into the faded earlier balloons.

let replying = false
/** Voice input: the name was heard and the user is saying the question (main follows the words). */
let hearing = false
let latestId = -1
let replyMood: Mood | null = null
let rateable = true
/** The question and answer in the two big balloons right now (null: nothing sent yet). */
/** `moved`: the question already went up with the earlier balloons (the answer is in). */
let current: { question: string; files: AttachmentInfo[]; answer: string; error: boolean; moved: boolean } | null = null

function sayText(): HTMLSpanElement {
  let span = say.querySelector<HTMLSpanElement>(':scope > .text')
  if (!span) {
    span = document.createElement('span')
    span.className = 'text'
    say.appendChild(span)
  }
  return span
}

/** Poppy's balloon: tool lines and questions above, her words below. */
function setSay(text: string, cls: '' | 'hint' | 'error' = ''): void {
  say.hidden = false
  say.classList.toggle('hint', cls === 'hint')
  say.classList.toggle('error', cls === 'error')
  const span = sayText()
  span.textContent = text
  span.scrollTop = span.scrollHeight
}

function clearSay(): void {
  say.replaceChildren()
  say.hidden = true
  say.classList.remove('hint', 'error')
}

/** With nothing said yet, Poppy's balloon gives a hint. */
function showHint(): void {
  if (current || replying || log.childElementCount) return
  clearSay()
  setSay('Ask me anything.\nI run on your own Ollama model.', 'hint')
}

// The earlier balloons shrink while Poppy's answer grows: keep the latest of them in view.
new ResizeObserver(() => (log.scrollTop = log.scrollHeight)).observe(log)

/** An earlier balloon, faded above the user's balloon. */
function addOld(who: 'you' | 'poppy', text: string, files: AttachmentInfo[] = [], error = false): void {
  const el = document.createElement('div')
  el.className = `msg ${who === 'you' ? 'you' : 'bot'}${error ? ' error' : ''}`
  setText(el, text)
  showFilesIn(el, files)
  log.appendChild(el)
  log.scrollTop = log.scrollHeight
}

/** The user starts a new question: the last pair goes up with the earlier balloons. */
function turnPage(): void {
  if (current) {
    if (!current.moved) addOld('you', current.question, current.files)
    if (current.answer) addOld('poppy', current.answer, [], current.error)
    current = null
  }
  composer.classList.remove('sent')
  input.readOnly = false
  input.value = ''
  clearSay()
  renderChips()
  fitInput()
}

/** The text field grows with the question, up to a few lines. */
function fitInput(): void {
  input.style.height = 'auto'
  input.style.height = `${input.scrollHeight}px`
}

/** "good" / "not quite" under Poppy's latest reply: feedback she learns from. Handwritten, no drawings added. */
function addRating(replyId: number): void {
  say.querySelectorAll(':scope > .rate').forEach((r) => r.remove())
  const box = document.createElement('span')
  box.className = 'rate'
  for (const [value, word] of [
    ['good', 'good'],
    ['not_quite', 'not quite']
  ] as const) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = word
    b.addEventListener('click', () => {
      api.rateReply(replyId, value)
      box.replaceChildren(Object.assign(document.createElement('span'), { className: 'thanks', textContent: 'thanks, noted!' }))
      window.setTimeout(() => box.remove(), 2500)
    })
    box.appendChild(b)
  }
  say.appendChild(box)
}

/** The answer is in (or stopped): the question goes up and a fresh, empty balloon pops in for the next one. */
function finishReply(): void {
  replying = false
  input.readOnly = false
  restartWaiting()
  if (!current || current.moved) return
  addOld('you', current.question, current.files)
  current.moved = true
  composer.classList.remove('sent')
  input.value = ''
  renderChips()
  fitInput()
  composer.animate([{ transform: 'scale(0.92)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' })
  if (!panel.hidden) input.focus()
}

/** The window grows upward for the balloons (main does that); wait for it, so Poppy never jumps. */
function afterGrow(then: () => void): void {
  let done = false
  const go = (): void => {
    if (done) return
    done = true
    window.removeEventListener('resize', onResize)
    then()
  }
  const onResize = (): void => {
    if (window.innerHeight > CLOSED_HEIGHT) go()
  }
  window.addEventListener('resize', onResize)
  window.setTimeout(go, 250)
}
const CLOSED_HEIGHT = 560

/** `focus`: take the keyboard (not when opened by voice: the user may be typing in another app). */
function openPanel(focus = true): void {
  touch()
  bubble.hidden = true
  if (!panel.hidden) return
  api.setChatOpen(true)
  afterGrow(() => {
    panel.hidden = false
    document.body.classList.add('chat-open')
    showHint()
    fitInput()
    if (focus) {
      api.focus()
      input.focus()
    }
  })
  if (!replying) setState('listening')
  restartWaiting()
}

function closePanel(): void {
  window.clearTimeout(waitTimer)
  panel.hidden = true
  document.body.classList.remove('chat-open', 'whole')
  api.setChatOpen(false)
  if (!replying && isWaitingPose(basePose(state))) setState('bye', 1800)
}

function togglePanel(): void {
  if (panel.hidden) openPanel()
  else closePanel()
}

form.addEventListener('submit', (e) => {
  e.preventDefault()
  if (replying || composer.classList.contains('sent')) return
  const text = input.value.trim()
  if (!text && !attached.length) return
  touch()
  const question = text || 'Have a look at this.'
  const files = attached
  turnPage() // the earlier pair (if any) moves up
  attached = []
  refused = []
  current = { question, files, answer: '', error: false, moved: false }
  input.value = question
  input.readOnly = true
  composer.classList.add('sent')
  document.body.classList.remove('whole')
  renderChips()
  showFilesIn(chips, files)
  fitInput()
  setSay('…')
  replying = true
  replyMood = null
  speakStep = -1
  latestId = Number.MAX_SAFE_INTEGER // accept the next reply id from main
  setState(files.length ? 'busy' : 'thinking') // busy: reading the attached files
  api.sendChat(text, files.map((f) => f.id))
})

// Enter sends, Shift+Enter starts a new line.
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    form.requestSubmit()
  }
})
input.addEventListener('input', () => {
  fitInput()
  if (hearing) {
    // Typing instead of talking: the voice question is off, what's typed stays.
    endHearing()
    api.cancelVoice()
  }
  // Typing: she listens again, and the waiting starts over.
  if (!replying && Date.now() >= holdUntil && isWaitingPose(basePose(state))) setState('listening')
  restartWaiting()
})
input.addEventListener('focus', () => {
  if (!replying && Date.now() >= holdUntil) setState('listening')
})
input.addEventListener('blur', () => {
  if (!replying && basePose(state) === 'listening') setState('idle')
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (hearing) {
      api.cancelVoice() // main answers with voice:cancel
      return
    }
    if (replying) {
      api.stopChat()
      finishReply()
    }
    closePanel()
  }
})

function newChat(): void {
  api.resetChat()
  api.forgetFiles(attached.map((a) => a.id))
  attached = []
  current = null
  finishReply()
  log.replaceChildren()
  turnPage()
  showHint()
  setState('listening')
  input.focus()
}

// The pencil icons from the user's picture: – hides Poppy, × closes the chat, gear = settings, menu.
$('hide').addEventListener('click', () => {
  closePanel()
  setState('bye', 2000)
  window.setTimeout(() => api.hide(), 1200) // a short wave first
})
// Hide from the menu-bar icon or the ≡ menu: main waits for the wave.
api.onBye(() => {
  if (!panel.hidden) closePanel()
  setState('bye', 2000)
})
$('close').addEventListener('click', closePanel)
$('settings').addEventListener('click', () => api.openSettings())
$('menu').addEventListener('click', () => api.showMenu())
api.onNewChat(() => {
  if (panel.hidden) openPanel()
  newChat()
})
// ≡ → Show whole chat: the earlier balloons at full strength, with more room.
api.onWholeChat(() => {
  if (panel.hidden) openPanel()
  document.body.classList.toggle('whole')
  log.scrollTop = log.scrollHeight
})

// ---------- attachments ----------

let attached: AttachmentInfo[] = []
let refused: AttachResult['refused'] = []
let refusedTimer = 0

function renderChips(): void {
  const els: HTMLElement[] = attached.map((a) => {
    const chip = document.createElement('div')
    chip.className = 'chip'
    if (a.thumb) {
      const img = document.createElement('img')
      img.className = 'thumb'
      img.src = a.thumb
      img.alt = ''
      chip.appendChild(img)
    }
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = a.name
    name.title = a.name
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.setAttribute('aria-label', `Remove ${a.name}`)
    remove.innerHTML = `<img src="${closeIcon}" alt="" draggable="false">`
    remove.addEventListener('click', () => {
      attached = attached.filter((x) => x.id !== a.id)
      api.forgetFiles([a.id])
      renderChips()
    })
    chip.append(name, remove)
    return chip
  })
  for (const r of refused) {
    const chip = document.createElement('div')
    chip.className = 'chip refused'
    chip.textContent = `${r.name}: ${r.reason}`
    els.push(chip)
  }
  chips.replaceChildren(...els)
  $('attach').hidden = attached.length >= MAX_FILES
}

function took(result: AttachResult): void {
  attached = [...attached, ...result.added]
  refused = result.refused
  window.clearTimeout(refusedTimer)
  if (refused.length) {
    refusedTimer = window.setTimeout(() => {
      refused = []
      if (!composer.classList.contains('sent')) renderChips()
    }, 6000)
  }
  renderChips()
  input.focus()
}

async function pickFiles(): Promise<void> {
  if (panel.hidden) openPanel()
  took(await api.pickFiles(attached.length))
}

/** Small previews and names of the files with the user's question. */
function showFilesIn(el: HTMLElement, files: AttachmentInfo[]): void {
  if (!files.length) return
  const box = document.createElement('span')
  box.className = 'files'
  for (const f of files) {
    if (f.thumb) {
      const img = document.createElement('img')
      img.src = f.thumb
      img.alt = f.name
      img.title = f.name
      box.appendChild(img)
    } else {
      const name = document.createElement('span')
      name.textContent = `attached: ${f.name}`
      box.appendChild(name)
    }
  }
  el.appendChild(box)
}

$('attach').addEventListener('click', () => void pickFiles())
api.onAttach(() => void pickFiles())

// Drag files from Finder onto the chat.
let dragDepth = 0
const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || panel.hidden || replying) return
  dragDepth++
  drop.hidden = false
})
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) drop.hidden = true
})
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = panel.hidden || replying ? 'none' : 'copy'
})
window.addEventListener('drop', async (e) => {
  e.preventDefault()
  dragDepth = 0
  drop.hidden = true
  const files = [...(e.dataTransfer?.files ?? [])]
  if (!files.length || panel.hidden || replying) return
  touch()
  took(await api.addDroppedFiles(files, attached.length))
})

// ---------- replies from main ----------

function acceptId(id: number): boolean {
  if (latestId === Number.MAX_SAFE_INTEGER) latestId = id
  return id === latestId
}

api.onChatUpdate((u) => {
  if (!replying || !acceptId(u.id)) return
  touch()
  const newMood = u.mood !== replyMood
  replyMood = u.mood
  rateable = !u.noRating
  if (u.text) {
    // The first words, or a new mood (the answer after a tool round): show it now. Without a voice,
    // the next pose comes every few seconds of text.
    if (speakStep < 0 || newMood) {
      speakStep = 0
      stepSpeaking()
    } else if (Date.now() - lastStepAt > STEP_WITHOUT_VOICE_MS) stepSpeaking()
    if (current) current.answer = u.text
    setSay(u.text)
    showBubble(u.text)
  }
})

// Each spoken sentence: talking and her mood (or a close relative) take turns (poses.ts).
api.onSpeaking((speaking) => {
  if (speaking && replying) stepSpeaking()
})
let speakStep = -1
let lastStepAt = 0
const STEP_WITHOUT_VOICE_MS = 3000
function stepSpeaking(): void {
  setState(speakingPose(replyMood, Math.max(0, speakStep++)))
  lastStepAt = Date.now()
}

api.onChatSpoken((id) => {
  if (!replying || id !== latestId) return
  finishReply()
  touch()
  if (rateable && !current?.error) addRating(id)
  const mood = replyMood && replyMood !== 'idle' ? replyMood : null
  if (mood) setState(mood, 6000, panel.hidden ? 'idle' : 'listening')
  else setState(panel.hidden ? 'idle' : 'listening')
  if (panel.hidden) bubbleTimer = window.setTimeout(() => (bubble.hidden = true), 9000)
})

api.onChatError((err) => {
  if (!replying || !acceptId(err.id)) return
  finishReply()
  if (current) {
    current.answer = err.message
    current.error = true
  }
  setSay(err.message, 'error')
  setState(err.mood ?? 'sad', 8000)
  showBubble(err.message, 9000)
})

// ---------- tools ----------

/** A small handwritten line in Poppy's balloon, above her words: which tool she is using or used. */
function toolNote(text: string, cls = ''): HTMLDivElement {
  const el = document.createElement('div')
  el.className = `tool-note ${cls}`.trim()
  el.textContent = text
  say.hidden = false
  say.insertBefore(el, sayText())
  return el
}

const notes = new Map<string, HTMLDivElement>()

api.onToolUse((u) => {
  if (!replying || !acceptId(u.id)) return
  touch()
  const words = {
    running: u.note ?? `using ${u.tool}…`,
    done: `used ${u.tool}`,
    failed: `${u.tool} didn't work`,
    refused: `didn't use ${u.tool}`
  }[u.state]
  const key = `${u.id}:${u.tool}`
  const el = notes.get(key)
  if (el && u.state !== 'running') {
    el.textContent = words
    notes.delete(key)
  } else if (el && u.note) el.textContent = words
  else if (u.state === 'running') notes.set(key, toolNote(words))
  else toolNote(words)
  if (u.state === 'running') setState('busy')
  else if (u.state === 'failed') setState('confused', 3000, 'thinking')
  else setState('thinking')
})

/** "May I?" with handwritten yes / no links, like the good / not quite ones. */
const askBoxes = new Map<number, HTMLDivElement>()

api.onToolAsk((a) => {
  if (!replying || !acceptId(a.id)) {
    api.answerTool(a.askId, false)
    return
  }
  touch()
  if (panel.hidden) openPanel()
  const box = toolNote('', 'ask')
  // A tool's own question goes right above its "using …" line.
  const running = a.tool ? notes.get(`${a.id}:${a.tool}`) : undefined
  if (running?.isConnected) running.before(box)
  const q = document.createElement('span')
  q.className = 'question'
  q.textContent = a.question ?? 'May I use this?'
  const call = document.createElement('span')
  call.className = 'call'
  call.textContent = a.call
  call.hidden = !a.call
  const links = document.createElement('span')
  links.className = 'rate'
  for (const [yes, word] of [
    [true, 'yes'],
    [false, 'no']
  ] as const) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = word
    b.addEventListener('click', () => {
      askBoxes.delete(a.askId)
      api.answerTool(a.askId, yes)
      links.replaceChildren(Object.assign(document.createElement('span'), { className: 'thanks', textContent: yes ? 'okay!' : "okay, I won't" }))
    })
    links.appendChild(b)
  }
  box.append(q, call, links)
  askBoxes.set(a.askId, box)
  setState('hopeful')
  showBubble(a.question ? 'I have a question. Have a look in the chat.' : 'May I use a tool? Have a look in the chat.')
})

api.onToolAsked((askId) => {
  const box = askBoxes.get(askId)
  if (!box) return
  askBoxes.delete(askId)
  box.querySelector('.rate')?.replaceChildren(
    Object.assign(document.createElement('span'), { className: 'thanks', textContent: "no answer, so I didn't" })
  )
})

// ---------- voice input ----------
// Main hears the name (listen.ts), then sends the words so far and the finished question. They go in the
// user's balloon as if typed, and the finished question is sent the same way as a typed one.

let draft = ''
// While she hears a spoken question: listening drawings (Polly has two) and attentive poses (poses.ts).
let hearTimer = 0
function hearStep(): void {
  if (!hearing) return
  if (!replying) setState(nextHearingPose(state, character))
  hearTimer = window.setTimeout(hearStep, between(HEARING_EVERY))
}

function endHearing(): void {
  window.clearTimeout(hearTimer)
  hearing = false
  composer.classList.remove('hearing')
  input.placeholder = `Ask ${buddyOf(character).name} anything…`
}

api.onVoiceWake(() => {
  touch()
  bubble.hidden = true
  if (replying) return
  if (panel.hidden) openPanel(false)
  if (!hearing) draft = input.value
  hearing = true
  composer.classList.add('hearing')
  input.value = ''
  input.placeholder = 'listening…'
  fitInput()
  if (!current && !log.childElementCount) setSay("I'm listening…", 'hint')
  // Her name was heard: listening at once, then its versions while the question comes in.
  setState('listening')
  window.clearTimeout(hearTimer)
  hearTimer = window.setTimeout(hearStep, between(HEARING_EVERY))
  restartWaiting()
})
api.onVoiceHeard((text) => {
  if (!hearing) return
  touch()
  input.value = text
  fitInput()
})
api.onVoiceAsk((text) => {
  if (!hearing) return
  endHearing()
  input.value = text
  fitInput()
  form.requestSubmit()
})
api.onVoiceCancel(() => {
  if (!hearing) return
  endHearing()
  input.value = draft
  fitInput()
  showHint()
  setState('listening')
})

api.onOpenChat(() => openPanel())
api.onForgotAll(() => {
  current = null
  finishReply()
  log.replaceChildren()
  turnPage()
  showHint()
})

// The last conversation, from Poppy's memory, so a restart doesn't wipe the chat: the earlier balloons.
api.chatHistory().then((past) => {
  if (!past.length || current || log.childElementCount) return
  for (const m of past) addOld(m.role === 'user' ? 'you' : 'poppy', m.text)
})

api.getSettings().then((s) => {
  sleepAfterMs = s.sleepAfterMinutes * 60_000
  useCharacter(s.character)
  showBubble(`Hi! I'm ${buddyOf(s.character).name}. Click me to chat.`, 6000)
})
api.onSettingsChanged((s) => {
  sleepAfterMs = s.sleepAfterMinutes * 60_000
  useCharacter(s.character)
})

// ---------- start ----------

imgs.idle.classList.add('on')
poppy.className = 'poppy s-idle'
motion.setState('idle')
label.src = labelFor('idle')
setState('hello', 3500) // the greeting itself waits for the settings: Poppy or Polly
