import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { join } from 'node:path'
import { composeMessage, contextSize } from '../shared/attachments'
import { isForgetRequest } from '../shared/memory'
import { parseReply, splitReply, takeSentences } from '../shared/reply'
import {
  localize,
  pickLanguage,
  READ_ALONG_WORDS,
  SHORT_REST_WORDS,
  speechView,
  wordCount
} from '../shared/speech'
import { DEFAULT_SETTINGS, type ChatError, type ChatUpdate, type PastMessage, type Settings, type SpeechLang } from '../shared/types'
import { addFiles, forget, loadFiles } from './attachments'
import { Memory } from './memory'
import { Kokoro } from './kokoro'
import { Brain, BrainError } from './brain'
import { claudeProblem, listClaudeModels } from './claude'
import { listEmbedModels, listModels, OllamaError, type ChatMessage } from './ollama'
import { getApiKey, maskedApiKey, setApiKey } from './secrets'
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
Start every reply with exactly one mood tag in square brackets: the one that best fits how you feel as you say it.
Glad: [happy] [cheerful] [laughing] [excited] [playful] [proud] [clapping] [hopeful] [cuddly] [chilling]
Surprised: [surprised] [shocked] [wonder] [spooked]
Thinking: [thinking] [curious] [focused] [determined] [busy] [confused] [doubtful] [dreamy]
Sad or worried: [sad] [crying] [sighing] [anxious] [nervous] [scared] [shy]
Grumpy (only playfully, never at the user): [grumpy] [frustrated] [angry] [defiant] [disgusted] [bored] [sneaky]
Body: [tired] [lazy] [hungry] [thirsty] [sick]
Greetings: [hello] when greeting, [sad-hello] for a sad hello, [bye] when saying goodbye. Calm: [idle]
Example: "[happy] Nice, that worked!" Never use any other tags.`

let buddy: BrowserWindow | null = null
let settingsWin: BrowserWindow | null = null
let memoryWin: BrowserWindow | null = null
let tray: Tray | null = null
const brain = new Brain(getSettings, (patch) => setSettings(patch))
const kokoro = new Kokoro()
const voice = new Voice(kokoro)
let lastLang: SpeechLang = 'en'
let history: ChatMessage[] = []
let replyId = 0
let current: AbortController | null = null
let chatOpen = false
/** Poppy's memory (his own database in the data folder). Created when the app is ready. */
let memory: Memory | null = null
let conversationId = 0
/** Reply ids (per chat turn) → their message ids in memory, for the good / not quite links. */
const replyMessages = new Map<number, number>()
/** True from the moment a message comes in until Poppy has finished speaking: learning waits. */
let chatBusy = false
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

/** A paper window like the chat: no Mac title bar, the pencil frame is part of the page. */
function paperWindow(title: string, page: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 440,
    height: 700,
    title,
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
  win.once('ready-to-show', () => {
    win.show()
    app.focus({ steal: true })
  })
  load(win, page)
  return win
}

function openSettings(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show()
    settingsWin.focus()
    return
  }
  settingsWin = paperWindow('Poppy settings', 'settings.html')
  settingsWin.on('closed', () => (settingsWin = null))
}

/** Everything Poppy learned, where the user can look at it and delete things. */
function openMemory(): void {
  if (memoryWin && !memoryWin.isDestroyed()) {
    memoryWin.show()
    memoryWin.focus()
    return
  }
  memoryWin = paperWindow("Poppy's memory", 'memory.html')
  memoryWin.on('closed', () => (memoryWin = null))
}

function sendAll(channel: string, payload?: unknown): void {
  for (const win of [buddy, settingsWin, memoryWin]) {
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

/** Brain choice for the menus: Claude (when there's a key) or Ollama only. */
function brainMenu(s: Settings): Electron.MenuItemConstructorOptions[] {
  const hasKey = !!getApiKey()
  const claude = s.claudeModel.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2')
  return [
    {
      label: `Claude (${claude})${hasKey ? '' : ': add a key in Settings'}`,
      type: 'radio',
      checked: s.brain === 'claude' && hasKey,
      enabled: hasKey,
      click: () => setSettings({ brain: 'claude' })
    },
    {
      label: `Ollama only (${s.model || 'picked automatically'})`,
      type: 'radio',
      checked: s.brain !== 'claude' || !hasKey,
      click: () => setSettings({ brain: 'ollama' })
    }
  ]
}

function updateTrayMenu(): void {
  if (!tray) return
  const s = getSettings()
  const visible = buddy?.isVisible() ?? false
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: visible ? 'Hide Poppy' : 'Show Poppy', click: () => (visible ? hideBuddy() : showBuddy()) },
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
      ...brainMenu(s),
      { label: 'Settings…', click: openSettings },
      { label: 'Memory…', click: openMemory },
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
  chatBusy = false
}

/** An error whose message is already written for the user. */
class PoppyError extends Error {}

/** Poppy waves goodbye, then the window hides. */
function hideBuddy(): void {
  if (!buddy?.isVisible()) return
  sendBuddy('ui:bye')
  setTimeout(() => buddy?.hide(), 1200)
}

const CANT_REACH_OLLAMA = "I can't reach Ollama. Is it running?"

function friendlyError(err: unknown, model: string): string {
  if (err instanceof PoppyError || err instanceof BrainError) return err.message
  const msg = err instanceof Error ? err.message : String(err)
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(msg) || (err as { cause?: unknown })?.cause)
    return CANT_REACH_OLLAMA
  if (/not found/i.test(msg)) return `I can't find the model "${model}". Pick another one in settings.`
  if (err instanceof OllamaError) return `Ollama says: ${msg}`
  return `Something went wrong: ${msg}`
}

/** A fixed reply without asking the model (e.g. after "forget that"). */
async function replyDirect(id: number, text: string, mood: ChatUpdate['mood']): Promise<void> {
  const s = getSettings()
  sendBuddy('chat:update', { id, text, mood, done: true, noRating: true } satisfies ChatUpdate)
  if (s.voiceEnabled) voice.speak(speechFor(text, lastLang, s))
  await voice.whenIdle()
  if (id === replyId) sendBuddy('chat:spoken', id)
}

async function runChat(text: string, attachmentIds: string[] = []): Promise<void> {
  stopReply()
  const id = replyId
  const ctrl = new AbortController()
  current = ctrl
  const s = getSettings()
  let userMsgId: number | null = null
  chatBusy = true
  memory?.touch()

  try {
    // "Forget that": undo what Poppy learned from the last exchange.
    if (memory && !attachmentIds.length && isForgetRequest(text)) {
      const n = memory.forgetLatest(conversationId)
      const answer = n
        ? lastLang === 'nl'
          ? 'Oké, dat ben ik vergeten.'
          : "Okay, I've forgotten that."
        : lastLang === 'nl'
          ? 'Ik had daar nog niets van onthouden.'
          : "I hadn't remembered anything from that."
      await replyDirect(id, answer, 'happy')
      return
    }
    // Attached files: text goes into the message (and stays in the history); images only go
    // along with this one message, so later replies stay fast.
    const loaded = attachmentIds.length ? await loadFiles(attachmentIds) : { files: [], images: [] }
    forget(attachmentIds)
    if (id !== replyId) return
    const content = loaded.files.length ? composeMessage(text, loaded.files) : text
    history.push({ role: 'user', content })
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY)
    const display = [text.trim(), ...loaded.files.map((f) => `(attached: ${f.name})`)].filter(Boolean).join('\n')
    userMsgId = memory?.store.addMessage(conversationId, 'user', content, display) ?? null
    // What Poppy remembers that fits this message goes into his instructions.
    let note = ''
    try {
      note = memory ? await memory.recall(text || display) : ''
    } catch (err) {
      console.warn('[memory] recall failed:', err instanceof Error ? err.message : err)
    }
    if (id !== replyId) return
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

    const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT + note }, ...history]
    if (loaded.images.length) messages[messages.length - 1] = { ...messages.at(-1)!, images: loaded.images }
    const chars = messages.reduce((n, m) => n + m.content.length, 0)
    const numCtx = contextSize(chars, loaded.images.length)
    for await (const chunk of brain.stream(messages, { signal: ctrl.signal, numCtx })) {
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
    const answer = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    history.push({ role: 'assistant', content: answer })
    const replyMsgId = memory?.store.addMessage(conversationId, 'assistant', answer, reply.text) ?? null
    if (replyMsgId) replyMessages.set(id, replyMsgId)
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
            brain,
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
    if (replyMsgId) memory?.learnFrom(replyMsgId)
  } catch (err) {
    if (ctrl.signal.aborted || id !== replyId) return
    if (history.at(-1)?.role === 'user') history.pop()
    if (userMsgId) memory?.store.deleteMessage(userMsgId)
    console.error('chat failed', err)
    const message = friendlyError(err, brain.lastModel || s.model)
    sendBuddy('chat:error', { id, message, mood: message === CANT_REACH_OLLAMA ? 'spooked' : 'sad' } satisfies ChatError)
  } finally {
    if (current === ctrl) current = null
    if (id === replyId) chatBusy = false
    memory?.touch()
  }
}

// ---------- memory ----------

function startMemory(): void {
  try {
    memory = new Memory({ file: join(app.getPath('userData'), 'memory.db'), settings: getSettings, busy: () => chatBusy, brain })
  } catch (err) {
    console.error('Memory could not start; Poppy carries on without it.', err)
    return
  }
  conversationId = memory.store.latestConversation()
  history = memory.store.recentMessages(conversationId, MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }))
  let pending: NodeJS.Timeout | null = null
  const changed = (): void => {
    // Learning can change many things at once; tell the windows once.
    if (pending) return
    pending = setTimeout(() => {
      pending = null
      if (memory) sendAll('memory:changed', memory.stats())
    }, 300)
  }
  memory.store.onChange(changed)
  memory.onStatus(changed)
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
      { type: 'separator' },
      ...brainMenu(s),
      { type: 'separator' },
      { label: 'Settings…', click: openSettings },
      { label: 'Memory…', click: openMemory },
      { type: 'separator' },
      { label: 'Hide Poppy', click: () => hideBuddy() },
      { label: 'Quit Poppy', click: () => app.quit() }
    ]).popup({ window: buddy ?? undefined })
  })
  ipcMain.on('chat:stop', () => stopReply())
  ipcMain.on('chat:reset', () => {
    stopReply()
    history = []
    if (memory) conversationId = memory.store.newConversation()
  })
  // The last conversation, shown again in the balloon after a restart.
  ipcMain.handle('chat:history', (): PastMessage[] =>
    memory ? memory.store.recentMessages(conversationId, MAX_HISTORY).map((m) => ({ role: m.role, text: m.display })) : []
  )
  ipcMain.on('chat:rate', (_e, replyId: number, value: string) => {
    const msg = replyMessages.get(Number(replyId))
    if (memory && msg && (value === 'good' || value === 'not_quite')) memory.feedback(msg, value)
  })

  // ---------- memory window ----------
  ipcMain.on('memory:open', () => openMemory())
  ipcMain.on('memory:close', () => memoryWin?.close())
  ipcMain.handle('memory:snapshot', () => memory?.snapshot() ?? null)
  ipcMain.handle('memory:stats', () => memory?.stats() ?? null)
  ipcMain.on('memory:delete', (_e, what: string, id: number) => {
    if (!memory) return
    const n = Number(id)
    if (what === 'fact') memory.store.deleteFact(n)
    else if (what === 'entity') memory.store.deleteEntity(n)
    else if (what === 'relation') memory.store.deleteRelation(n)
    else if (what === 'rule') memory.store.setNotebook(memory.store.notebook().filter((_, i) => i !== n))
  })
  ipcMain.handle('memory:forget-all', async () => {
    if (!memory) return false
    const owner = memoryWin && !memoryWin.isDestroyed() ? memoryWin : undefined
    const opts = {
      type: 'warning' as const,
      buttons: ['Forget everything', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Forget everything?',
      detail: 'Poppy forgets all chats, everything he learned about you, the people and things he knows, and his notebook. This cannot be undone.'
    }
    const { response } = owner ? await dialog.showMessageBox(owner, opts) : await dialog.showMessageBox(opts)
    if (response !== 0) return false
    stopReply()
    memory.store.forgetEverything()
    history = []
    conversationId = memory.store.newConversation()
    sendBuddy('ui:forgot-all')
    return true
  })
  ipcMain.handle('memory:reflect', async () => (memory ? memory.reflect() : null))
  ipcMain.handle('ollama:embed-models', async (_e, url?: string) => listEmbedModels(url || getSettings().ollamaUrl))

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => setSettings(patch))
  ipcMain.on('settings:open', () => openSettings())
  ipcMain.on('settings:close', () => settingsWin?.close())
  ipcMain.handle('ollama:models', async (_e, url?: string) => listModels(url || getSettings().ollamaUrl))
  // Claude: the key goes from the settings page to main once and is never sent back.
  ipcMain.handle('claude:status', () => ({ ...brain.status(), masked: maskedApiKey() }))
  ipcMain.handle('claude:set-key', async (_e, value: string) => {
    const clean = String(value ?? '').trim()
    if (clean) {
      try {
        await listClaudeModels(clean)
      } catch (err) {
        return { ok: false, message: `That key didn't work: ${claudeProblem(err)}.` }
      }
    }
    try {
      setApiKey(clean)
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
    // A new key means the user wants Claude; removing it goes back to Ollama only.
    setSettings({ brain: clean ? 'claude' : 'ollama' })
    sendAll('claude:status', { ...brain.status(), masked: maskedApiKey() })
    return { ok: true, message: clean ? 'Key saved. Poppy now answers with Claude.' : 'Key removed. Poppy uses Ollama only.' }
  })
  ipcMain.handle('claude:models', async () => {
    const key = getApiKey()
    if (!key) return { ok: false, models: [], message: 'No API key yet.' }
    try {
      return { ok: true, models: await listClaudeModels(key), message: '' }
    } catch (err) {
      return { ok: false, models: [], message: `Claude: ${claudeProblem(err)}.` }
    }
  })
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

// For testing a first start: POPPY_DATA_DIR=/some/empty/folder keeps settings, voice files and memory there.
if (process.env.POPPY_DATA_DIR) app.setPath('userData', process.env.POPPY_DATA_DIR)

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
    startMemory()
    brain.onStatus(() => sendAll('claude:status', { ...brain.status(), masked: maskedApiKey() }))
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
    memory?.close()
    memory = null
  })
}
