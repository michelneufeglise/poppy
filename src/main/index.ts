import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { join } from 'node:path'
import { composeMessage, contextSize } from '../shared/attachments'
import { parseReply, splitReply, takeSentences } from '../shared/reply'
import {
  localize,
  pickLanguage,
  READ_ALONG_WORDS,
  SHORT_REST_WORDS,
  speechView,
  wordCount
} from '../shared/speech'
import { DEFAULT_SETTINGS, type ChatError, type ChatUpdate, type Settings, type SpeechLang } from '../shared/types'
import { addFiles, forget, loadFiles } from './attachments'
import { Kokoro } from './kokoro'
import { canSee, listModels, OllamaError, pickDefaultModel, streamChat, type ChatMessage } from './ollama'
import { getSettings, onSettingsChanged, updateSettings } from './settings'
import { spokenWrapUp } from './summary'
import { listVoices, Voice, type Speech } from './voice'

const BUDDY_W = 380
const BUDDY_H = 560
/** While the chat balloon is open the window grows upward to this height; Poppy stays where he is. */
const CHAT_H = 800
const MAX_HISTORY = 20

const SYSTEM_PROMPT = `You are Poppy, a small, warm and slightly playful desk buddy who lives on the user's Mac.
You talk like a friendly co-worker: short, natural replies of one to three sentences unless the user asks for more.
Your words are spoken out loud, so never use markdown, lists, code blocks or emoji.
Start every reply with exactly one mood tag in square brackets, picked from:
[happy] [sad] [surprised] [curious] [focused] [determined] [thinking] [hello] [idle]
Use [hello] when greeting.
Example: "[happy] Nice, that worked!" Never use any other tags.`

let buddy: BrowserWindow | null = null
let settingsWin: BrowserWindow | null = null
let tray: Tray | null = null
const kokoro = new Kokoro()
const voice = new Voice(kokoro)
let lastLang: SpeechLang = 'en'
let history: ChatMessage[] = []
let replyId = 0
let current: AbortController | null = null
let chatOpen = false
/** How far the window had to move down to fit on screen when the chat opened (undone when it closes). */
let pushedDown = 0

// ---------- windows ----------

function load(win: BrowserWindow, page: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}/${page}`)
  else void win.loadFile(join(__dirname, `../renderer/${page}`))
}

function preload(): string {
  return join(__dirname, '../preload/index.js')
}

function defaultPosition(): { x: number; y: number } {
  const wa = screen.getPrimaryDisplay().workArea
  return { x: wa.x + wa.width - BUDDY_W - 16, y: wa.y + wa.height - BUDDY_H - 4 }
}

/** Keeps a saved position on a screen that still exists. */
function onScreen(p: { x: number; y: number }): { x: number; y: number } {
  const wa = screen.getDisplayMatching({ ...p, width: BUDDY_W, height: BUDDY_H }).workArea
  return {
    x: Math.min(Math.max(p.x, wa.x - BUDDY_W / 2), wa.x + wa.width - BUDDY_W / 2),
    y: Math.min(Math.max(p.y, wa.y), wa.y + wa.height - BUDDY_H / 2)
  }
}

function createBuddy(): void {
  const saved = getSettings().position
  const pos = saved ? onScreen(saved) : defaultPosition()
  buddy = new BrowserWindow({
    width: BUDDY_W,
    height: BUDDY_H,
    x: pos.x,
    y: pos.y,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: preload(), contextIsolation: true, sandbox: true }
  })
  buddy.setAlwaysOnTop(true, 'floating')
  buddy.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Clicks go through the empty parts of the window; the page switches this per element.
  buddy.setIgnoreMouseEvents(true, { forward: true })
  buddy.once('ready-to-show', () => buddy?.showInactive())
  buddy.on('show', updateTrayMenu)
  buddy.on('hide', updateTrayMenu)
  load(buddy, 'index.html')
}

/**
 * Grows the window upward for the chat balloon, or shrinks it back, keeping Poppy (at the bottom) in place.
 * Near the top of the screen the window moves down just enough to fit, and moves back when the chat closes.
 */
function setChatOpen(open: boolean): void {
  if (!buddy || open === chatOpen) return
  chatOpen = open
  const b = buddy.getBounds()
  if (open) {
    const wanted = b.y - (CHAT_H - BUDDY_H)
    const y = Math.max(wanted, screen.getDisplayMatching(b).workArea.y)
    pushedDown = y - wanted
    buddy.setBounds({ x: b.x, y, width: BUDDY_W, height: CHAT_H })
  } else {
    buddy.setBounds({ x: b.x, y: b.y + (CHAT_H - BUDDY_H) - pushedDown, width: BUDDY_W, height: BUDDY_H })
    pushedDown = 0
  }
}

/** Puts Poppy at a saved or default spot (the top-left of the window as it is with the chat closed). */
function placeBuddy(p: { x: number; y: number }): void {
  if (!buddy) return
  const h = buddy.getBounds().height
  pushedDown = 0
  buddy.setBounds({ x: p.x, y: p.y - (h - BUDDY_H), width: BUDDY_W, height: h })
}

function openSettings(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show()
    settingsWin.focus()
    return
  }
  // A paper window like the chat: no Mac title bar, the pencil frame is part of the page.
  settingsWin = new BrowserWindow({
    width: 440,
    height: 700,
    title: 'Poppy settings',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: { preload: preload(), contextIsolation: true, sandbox: true }
  })
  settingsWin.once('ready-to-show', () => {
    settingsWin?.show()
    app.focus({ steal: true })
  })
  settingsWin.on('closed', () => (settingsWin = null))
  load(settingsWin, 'settings.html')
}

function sendAll(channel: string, payload?: unknown): void {
  for (const win of [buddy, settingsWin]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function sendBuddy(channel: string, payload?: unknown): void {
  if (buddy && !buddy.isDestroyed()) buddy.webContents.send(channel, payload)
}

function showBuddy(): void {
  buddy?.showInactive()
}

// ---------- tray ----------

function createTray(): void {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'assets/tray/trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Poppy')
  updateTrayMenu()
}

function updateTrayMenu(): void {
  if (!tray) return
  const s = getSettings()
  const visible = buddy?.isVisible() ?? false
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: visible ? 'Hide Poppy' : 'Show Poppy', click: () => (visible ? buddy?.hide() : showBuddy()) },
      {
        label: 'Chat with Poppy',
        click: () => {
          showBuddy()
          buddy?.focus()
          sendBuddy('ui:open-chat')
        }
      },
      { type: 'separator' },
      {
        label: 'Voice',
        type: 'checkbox',
        checked: s.voiceEnabled,
        click: (item) => setSettings({ voiceEnabled: item.checked })
      },
      { label: `Model: ${s.model || 'picked automatically'}`, enabled: false },
      { label: 'Settings…', click: openSettings },
      {
        label: 'Reset position',
        click: () => {
          placeBuddy(defaultPosition())
          setSettings({ position: null })
        }
      },
      { type: 'separator' },
      { label: 'Quit Poppy', click: () => app.quit() }
    ])
  )
}

function setSettings(patch: Partial<Settings>): Settings {
  if (patch.voiceEnabled === false) voice.stop()
  const s = updateSettings(patch)
  warmKokoro(s)
  return s
}

/** Start Kokoro early so the first sentence doesn't wait for it to load. */
function warmKokoro(s: Settings): void {
  if (s.voiceEnabled && s.englishEngine === 'kokoro') void kokoro.start()
}

/** How a sentence is spoken: Dutch with the Mac Dutch voice, English with Kokoro or the Mac voice. */
function speechFor(text: string, lang: SpeechLang, s: Settings): Speech {
  if (lang === 'nl') {
    return { text: localize(text, lang), kokoroVoice: null, kokoroSpeed: s.kokoroSpeed, macVoice: s.dutchVoice, rate: s.rate }
  }
  const useKokoro = s.englishEngine === 'kokoro'
  return { text, kokoroVoice: useKokoro ? s.kokoroVoice : null, kokoroSpeed: s.kokoroSpeed, macVoice: s.voice, rate: s.rate }
}

// ---------- chat ----------

function stopReply(): void {
  replyId++
  current?.abort()
  current = null
  voice.stop()
}

/** An error whose message is already written for the user. */
class PoppyError extends Error {}

function friendlyError(err: unknown, model: string): string {
  if (err instanceof PoppyError) return err.message
  const msg = err instanceof Error ? err.message : String(err)
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(msg) || (err as { cause?: unknown })?.cause)
    return "I can't reach Ollama. Is it running?"
  if (/not found/i.test(msg)) return `I can't find the model "${model}". Pick another one in settings.`
  if (err instanceof OllamaError) return `Ollama says: ${msg}`
  return `Something went wrong: ${msg}`
}

async function runChat(text: string, attachmentIds: string[] = []): Promise<void> {
  stopReply()
  const id = replyId
  const ctrl = new AbortController()
  current = ctrl
  const s = getSettings()
  let model = s.model

  try {
    // No model chosen yet, or still the default but it isn't installed here: use the best one that is.
    const defaultMissing = model === DEFAULT_SETTINGS.model && !(await listModels(s.ollamaUrl)).includes(model)
    if (!model || defaultMissing) {
      model = await pickDefaultModel(s.ollamaUrl)
      setSettings({ model })
    }
    // Attached files: text goes into the message (and stays in the history); images only go
    // along with this one message, so later replies stay fast.
    const loaded = attachmentIds.length ? await loadFiles(attachmentIds) : { files: [], images: [] }
    forget(attachmentIds)
    if (loaded.images.length && !(await canSee(s.ollamaUrl, model))) {
      throw new PoppyError(`My model ${model} can't look at pictures. Pick one that can, like qwen3.6:35b-a3b, in settings.`)
    }
    if (id !== replyId) return
    history.push({ role: 'user', content: loaded.files.length ? composeMessage(text, loaded.files) : text })
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY)
    let raw = ''
    let reply = parseReply('')
    let view = ''
    let spokenTo = 0
    let lang: SpeechLang | null = null
    const said: string[] = []
    const held: string[] = [] // sentences past the read-along limit, for the wrap-up
    const speakParts = (parts: string[]): void => {
      for (const part of parts) {
        lang ??= pickLanguage(view, text, lastLang)
        const words = wordCount(part)
        const overLimit = said.length > 0 && wordCount(said.join(' ')) + words > READ_ALONG_WORDS
        if (s.longReplies === 'summary' && (held.length > 0 || overLimit)) {
          held.push(part)
          continue
        }
        said.push(part)
        voice.speak(speechFor(part, lang, s))
      }
    }

    const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...history]
    if (loaded.images.length) messages[messages.length - 1] = { ...messages.at(-1)!, images: loaded.images }
    const chars = messages.reduce((n, m) => n + m.content.length, 0)
    const numCtx = contextSize(chars, loaded.images.length)
    for await (const chunk of streamChat(s.ollamaUrl, model, messages, ctrl.signal, numCtx)) {
      if (id !== replyId) return
      raw += chunk
      reply = parseReply(raw)
      sendBuddy('chat:update', { id, text: reply.text, mood: reply.mood, done: false } satisfies ChatUpdate)
      if (s.voiceEnabled) {
        view = speechView(splitReply(raw).body)
        const r = takeSentences(view, spokenTo, false)
        spokenTo = r.next
        speakParts(r.parts)
      }
    }
    if (id !== replyId) return
    sendBuddy('chat:update', { id, text: reply.text, mood: reply.mood, done: true } satisfies ChatUpdate)
    history.push({ role: 'assistant', content: raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() })
    if (s.voiceEnabled) {
      view = speechView(splitReply(raw).body)
      speakParts(takeSentences(view, spokenTo, true).parts)
      if (lang) lastLang = lang
      if (held.length && lang) {
        const rest = held.join(' ')
        if (wordCount(rest) <= SHORT_REST_WORDS) {
          for (const part of held) voice.speak(speechFor(part, lang, s))
        } else {
          const wrap = await spokenWrapUp({
            baseUrl: s.ollamaUrl,
            model,
            said: said.join(' '),
            rest,
            lang,
            signal: ctrl.signal
          })
          if (id !== replyId) return
          console.log(`[voice] read ${wordCount(said.join(' '))} words, wrap-up (${lang}): ${wrap}`)
          if (wrap) voice.speak(speechFor(wrap, lang, s))
        }
      }
    }
    await voice.whenIdle()
    if (id === replyId) sendBuddy('chat:spoken', id)
  } catch (err) {
    if (ctrl.signal.aborted || id !== replyId) return
    if (history.at(-1)?.role === 'user') history.pop()
    console.error('chat failed', err)
    sendBuddy('chat:error', { id, message: friendlyError(err, model) } satisfies ChatError)
  } finally {
    if (current === ctrl) current = null
  }
}

// ---------- IPC ----------

function registerIpc(): void {
  ipcMain.on('buddy:set-interactive', (_e, on: boolean) => {
    buddy?.setIgnoreMouseEvents(!on, { forward: true })
  })
  ipcMain.handle('buddy:get-position', () => buddy?.getPosition() ?? [0, 0])
  ipcMain.on('buddy:set-position', (_e, x: number, y: number) => {
    buddy?.setPosition(Math.round(x), Math.round(y))
    pushedDown = 0 // moved by hand: stay where the user puts him
  })
  ipcMain.on('buddy:save-position', () => {
    if (!buddy) return
    // Saved as the closed window's top-left, whatever size the window has right now.
    const b = buddy.getBounds()
    setSettings({ position: { x: b.x, y: b.y + b.height - BUDDY_H } })
  })
  ipcMain.on('buddy:chat-open', (_e, open: boolean) => setChatOpen(!!open))
  ipcMain.on('buddy:focus', () => {
    app.focus({ steal: true })
    buddy?.focus()
  })

  ipcMain.on('chat:send', (_e, text: string, ids: unknown) => {
    const attachmentIds = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
    void runChat(String(text).slice(0, 4000), attachmentIds)
  })
  ipcMain.handle('attach:pick', async (_e, already: number) => {
    app.focus({ steal: true })
    const res = await dialog.showOpenDialog({
      title: 'Attach files for Poppy',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images, PDFs and text', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf', 'txt', 'md', 'csv', 'json', 'html', 'xml', 'yaml', 'yml', 'log', 'py', 'js', 'ts', 'swift', 'java', 'go', 'rs', 'rb', 'sh', 'css', 'sql'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    buddy?.focus()
    return addFiles(res.canceled ? [] : res.filePaths, Number(already) || 0)
  })
  ipcMain.handle('attach:add', (_e, paths: unknown, already: number) =>
    addFiles(Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : [], Number(already) || 0)
  )
  ipcMain.on('attach:forget', (_e, ids: unknown) => {
    if (Array.isArray(ids)) forget(ids.filter((x): x is string => typeof x === 'string'))
  })
  // The header from the user's picture: – hides Poppy to the menu bar, the menu icon opens this menu.
  ipcMain.on('buddy:hide', () => buddy?.hide())
  ipcMain.on('buddy:menu', () => {
    const s = getSettings()
    Menu.buildFromTemplate([
      { label: 'New chat', click: () => sendBuddy('ui:new-chat') },
      { label: 'Attach file…', click: () => sendBuddy('ui:attach') },
      { type: 'separator' },
      { label: 'Voice', type: 'checkbox', checked: s.voiceEnabled, click: (item) => setSettings({ voiceEnabled: item.checked }) },
      { label: 'Settings…', click: openSettings },
      { type: 'separator' },
      { label: 'Hide Poppy', click: () => buddy?.hide() },
      { label: 'Quit Poppy', click: () => app.quit() }
    ]).popup({ window: buddy ?? undefined })
  })
  ipcMain.on('chat:stop', () => stopReply())
  ipcMain.on('chat:reset', () => {
    stopReply()
    history = []
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => setSettings(patch))
  ipcMain.on('settings:open', () => openSettings())
  ipcMain.on('settings:close', () => settingsWin?.close())
  ipcMain.handle('ollama:models', async (_e, url?: string) => listModels(url || getSettings().ollamaUrl))
  ipcMain.handle('voice:list', () => listVoices())
  ipcMain.handle('voice:kokoro-status', () => kokoro.status)
  ipcMain.on('voice:test', (_e, lang: SpeechLang) => {
    const s = getSettings()
    stopReply()
    const line = lang === 'nl' ? 'Hoi, ik ben Poppy. Zo klink ik in het Nederlands.' : "Hi, I'm Poppy. This is how I sound."
    voice.speak(speechFor(line, lang === 'nl' ? 'nl' : 'en', s))
  })
}

// ---------- app ----------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showBuddy())

  app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.hide()
    registerIpc()
    voice.on('speaking', (on: boolean) => sendBuddy('voice:speaking', on))
    kokoro.on('status', (status) => sendAll('voice:kokoro-status', status))
    warmKokoro(getSettings())
    onSettingsChanged((s) => {
      sendAll('settings:changed', s)
      updateTrayMenu()
    })
    createBuddy()
    createTray()
  })

  // Poppy lives in the menu bar; closing the settings window doesn't quit.
  app.on('window-all-closed', () => {})
  app.on('before-quit', () => {
    voice.stop()
    kokoro.shutdown()
  })
}
