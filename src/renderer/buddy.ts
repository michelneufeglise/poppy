import { MAX_FILES } from '../shared/attachments'
import { STATES, type AttachmentInfo, type AttachResult, type Mood, type PoppyState } from '../shared/types'

const api = window.poppy

// The user's own drawings, cut from the emotion sheet. Never redrawn.
const urls = import.meta.glob('../../assets/states/*.png', { eager: true, import: 'default' }) as Record<
  string,
  string
>
const urlFor = (s: PoppyState): string => urls[`../../assets/states/${s}.png`]
// The state names, hand-lettered on the same sheet.
const labelUrls = import.meta.glob('../../assets/chat/label-*.png', { eager: true, import: 'default' }) as Record<
  string,
  string
>
const labelFor = (s: PoppyState): string => labelUrls[`../../assets/chat/label-${s}.png`]
const closeIcon = new URL('../../assets/chat/close.png', import.meta.url).href

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const poppy = $<HTMLDivElement>('poppy')
const bubble = $<HTMLDivElement>('bubble')
const panel = $<HTMLElement>('panel')
const log = $<HTMLDivElement>('log')
const form = $<HTMLFormElement>('form')
const input = $<HTMLInputElement>('input')
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

const imgs = {} as Record<PoppyState, HTMLImageElement>
const masks = {} as Record<PoppyState, { w: number; h: number; alpha: Uint8ClampedArray } | undefined>

for (const s of STATES) {
  const frame = document.createElement('div')
  frame.className = 'frame'
  const img = document.createElement('img')
  img.src = urlFor(s)
  img.alt = ''
  img.draggable = false
  img.decode().then(() => {
    // Keep each drawing's transparency so only Poppy itself catches the mouse.
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0)
    masks[s] = { w: c.width, h: c.height, alpha: ctx.getImageData(0, 0, c.width, c.height).data }
  })
  frame.appendChild(img)
  poppy.appendChild(frame)
  imgs[s] = img
}

// ---------- state ----------

let state: PoppyState = 'idle'
let holdTimer = 0
let lastActivity = Date.now()
let sleepAfterMs = 10 * 60_000

function setState(next: PoppyState, holdMs = 0, then: PoppyState = 'idle'): void {
  window.clearTimeout(holdTimer)
  if (next !== state) {
    imgs[state].classList.remove('on')
    imgs[next].classList.add('on')
    state = next
    poppy.className = `poppy s-${next}`
    label.src = labelFor(next)
  }
  if (holdMs) holdTimer = window.setTimeout(() => setState(then), holdMs)
}

function touch(): void {
  lastActivity = Date.now()
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

// Fall asleep after a while without anything happening.
window.setInterval(() => {
  if (state === 'idle' && panel.hidden && !replying && Date.now() - lastActivity > sleepAfterMs) {
    bubble.hidden = true
    setState('sleeping')
  }
}, 15_000)

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
  return !!el?.closest('#panel, #bubble')
}

let interactive = false
let drag: { sx: number; sy: number; wx: number; wy: number; moved: boolean } | null = null
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
  drag = { sx: e.screenX, sy: e.screenY, wx, wy, moved: false }
}

function moveDrag(e: PointerEvent): void {
  if (!drag) return
  const dx = e.screenX - drag.sx
  const dy = e.screenY - drag.sy
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return
  drag.moved = true
  api.setPosition(drag.wx + dx, drag.wy + dy)
}

/** Returns true when the press was a click rather than a drag. */
function endDrag(): boolean {
  const wasDrag = drag?.moved ?? false
  pressed = false
  drag = null
  touch()
  if (wasDrag) api.savePosition()
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

// ---------- chat panel ----------

let replying = false
let latestId = -1
let replyEl: HTMLDivElement | null = null
let replyMood: Mood | null = null

function addMessage(who: 'you' | 'poppy', text: string): HTMLDivElement {
  log.querySelector('.empty')?.remove()
  const el = document.createElement('div')
  el.className = `msg ${who === 'you' ? 'you' : 'bot'}`
  setText(el, text)
  log.appendChild(el)
  log.scrollTop = log.scrollHeight
  return el
}

function showEmpty(): void {
  log.innerHTML = '<div class="empty">Ask me anything.<br>I run on your own Ollama model.</div>'
}

/** The window grows upward for the balloon (main does that); wait for it, so Poppy never jumps. */
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

function openPanel(): void {
  touch()
  bubble.hidden = true
  if (!panel.hidden) return
  api.setChatOpen(true)
  afterGrow(() => {
    panel.hidden = false
    document.body.classList.add('chat-open')
    if (!log.childElementCount) showEmpty()
    api.focus()
    input.focus()
  })
  if (!replying) setState('listening')
}

function closePanel(): void {
  panel.hidden = true
  document.body.classList.remove('chat-open')
  api.setChatOpen(false)
  if (!replying && state === 'listening') setState('idle')
}

function togglePanel(): void {
  if (panel.hidden) openPanel()
  else closePanel()
}

form.addEventListener('submit', (e) => {
  e.preventDefault()
  const text = input.value.trim()
  if (!text && !attached.length) return
  touch()
  input.value = ''
  const you = addMessage('you', text || 'Have a look at this.')
  showFilesIn(you, attached)
  const ids = attached.map((a) => a.id)
  attached = []
  renderChips()
  replyEl = addMessage('poppy', '…')
  replying = true
  replyMood = null
  latestId = Number.MAX_SAFE_INTEGER // accept the next reply id from main
  setState('thinking')
  api.sendChat(text, ids)
})

input.addEventListener('focus', () => {
  if (!replying) setState('listening')
})
input.addEventListener('blur', () => {
  if (!replying && state === 'listening') setState('idle')
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (replying) api.stopChat()
    closePanel()
  }
})

function newChat(): void {
  api.resetChat()
  api.forgetFiles(attached.map((a) => a.id))
  attached = []
  renderChips()
  replying = false
  replyEl = null
  showEmpty()
  setState('listening')
  input.focus()
}

// The pencil icons from the user's picture: – hides Poppy, × closes the chat, gear = settings, menu.
$('hide').addEventListener('click', () => {
  closePanel()
  api.hide()
})
$('close').addEventListener('click', closePanel)
$('settings').addEventListener('click', () => api.openSettings())
$('menu').addEventListener('click', () => api.showMenu())
api.onNewChat(() => {
  if (panel.hidden) openPanel()
  newChat()
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
      renderChips()
    }, 6000)
  }
  renderChips()
  input.focus()
}

async function pickFiles(): Promise<void> {
  if (panel.hidden) openPanel()
  took(await api.pickFiles(attached.length))
}

/** Small previews and names of the files under the user's message. */
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
  log.scrollTop = log.scrollHeight
}

$('attach').addEventListener('click', () => void pickFiles())
api.onAttach(() => void pickFiles())

// Drag files from Finder onto the chat window.
let dragDepth = 0
const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || panel.hidden) return
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
  if (e.dataTransfer) e.dataTransfer.dropEffect = panel.hidden ? 'none' : 'copy'
})
window.addEventListener('drop', async (e) => {
  e.preventDefault()
  dragDepth = 0
  drop.hidden = true
  const files = [...(e.dataTransfer?.files ?? [])]
  if (!files.length || panel.hidden) return
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
  replyMood = u.mood
  if (u.text) {
    if (state !== 'talking') setState('talking')
    if (replyEl) {
      setText(replyEl, u.text)
      log.scrollTop = log.scrollHeight
    }
    showBubble(u.text)
  }
})

api.onSpeaking((speaking) => {
  if (speaking && replying) setState('talking')
})

api.onChatSpoken((id) => {
  if (!replying || id !== latestId) return
  replying = false
  touch()
  const mood = replyMood && replyMood !== 'idle' ? replyMood : null
  if (mood) setState(mood, 6000, panel.hidden ? 'idle' : 'listening')
  else setState(panel.hidden ? 'idle' : 'listening')
  if (panel.hidden) bubbleTimer = window.setTimeout(() => (bubble.hidden = true), 9000)
})

api.onChatError((err) => {
  if (!replying || !acceptId(err.id)) return
  replying = false
  if (replyEl) {
    setText(replyEl, err.message)
    replyEl.classList.add('error')
  }
  setState('sad', 8000)
  showBubble(err.message, 9000)
})

api.onOpenChat(() => openPanel())

api.getSettings().then((s) => (sleepAfterMs = s.sleepAfterMinutes * 60_000))
api.onSettingsChanged((s) => (sleepAfterMs = s.sleepAfterMinutes * 60_000))

// ---------- start ----------

imgs.idle.classList.add('on')
poppy.className = 'poppy s-idle'
label.src = labelFor('idle')
setState('hello', 3500)
showBubble("Hi! I'm Poppy. Click me to chat.", 6000)
