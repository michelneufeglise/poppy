import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type {
  AttachResult,
  BrainStatus,
  ChatError,
  ChatUpdate,
  KokoroStatus,
  MemorySnapshot,
  MemoryStats,
  PastMessage,
  Settings,
  SpeechLang,
  VoiceInfo
} from '../shared/types'

type ClaudeStatus = BrainStatus & { masked: string | null }

function on<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  // buddy window
  setInteractive: (interactive: boolean) => ipcRenderer.send('buddy:set-interactive', interactive),
  getPosition: () => ipcRenderer.invoke('buddy:get-position') as Promise<[number, number]>,
  setPosition: (x: number, y: number) => ipcRenderer.send('buddy:set-position', x, y),
  savePosition: () => ipcRenderer.send('buddy:save-position'),
  /** Grow the window for the chat balloon (true) or shrink it back (false). */
  setChatOpen: (open: boolean) => ipcRenderer.send('buddy:chat-open', open),
  focus: () => ipcRenderer.send('buddy:focus'),
  onOpenChat: (cb: () => void) => on('ui:open-chat', cb),
  onNewChat: (cb: () => void) => on('ui:new-chat', cb),
  onAttach: (cb: () => void) => on('ui:attach', cb),
  hide: () => ipcRenderer.send('buddy:hide'),
  showMenu: () => ipcRenderer.send('buddy:menu'),

  // attachments: the page only ever gets ids back; main keeps the paths
  pickFiles: (already: number) => ipcRenderer.invoke('attach:pick', already) as Promise<AttachResult>,
  addDroppedFiles: (files: File[], already: number) =>
    ipcRenderer.invoke('attach:add', files.map((f) => webUtils.getPathForFile(f)).filter(Boolean), already) as Promise<AttachResult>,
  forgetFiles: (ids: string[]) => ipcRenderer.send('attach:forget', ids),

  // chat
  sendChat: (text: string, attachmentIds: string[] = []) => ipcRenderer.send('chat:send', text, attachmentIds),
  stopChat: () => ipcRenderer.send('chat:stop'),
  resetChat: () => ipcRenderer.send('chat:reset'),
  onChatUpdate: (cb: (u: ChatUpdate) => void) => on('chat:update', cb),
  onChatSpoken: (cb: (id: number) => void) => on('chat:spoken', cb),
  onChatError: (cb: (e: ChatError) => void) => on('chat:error', cb),
  onSpeaking: (cb: (speaking: boolean) => void) => on('voice:speaking', cb),
  /** The last conversation, to show again after a restart. */
  chatHistory: () => ipcRenderer.invoke('chat:history') as Promise<PastMessage[]>,
  /** The "good" / "not quite" links under Poppy's reply. */
  rateReply: (replyId: number, value: 'good' | 'not_quite') => ipcRenderer.send('chat:rate', replyId, value),
  onForgotAll: (cb: () => void) => on('ui:forgot-all', cb),

  // memory
  openMemory: () => ipcRenderer.send('memory:open'),
  closeMemory: () => ipcRenderer.send('memory:close'),
  memorySnapshot: () => ipcRenderer.invoke('memory:snapshot') as Promise<MemorySnapshot | null>,
  memoryStats: () => ipcRenderer.invoke('memory:stats') as Promise<MemoryStats | null>,
  deleteMemory: (what: 'fact' | 'entity' | 'relation' | 'rule', id: number) => ipcRenderer.send('memory:delete', what, id),
  forgetEverything: () => ipcRenderer.invoke('memory:forget-all') as Promise<boolean>,
  reflectNow: () => ipcRenderer.invoke('memory:reflect') as Promise<unknown>,
  onMemoryChanged: (cb: (stats: MemoryStats) => void) => on('memory:changed', cb),
  listEmbedModels: (url?: string) => ipcRenderer.invoke('ollama:embed-models', url) as Promise<string[]>,

  // settings
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch) as Promise<Settings>,
  onSettingsChanged: (cb: (s: Settings) => void) => on('settings:changed', cb),
  openSettings: () => ipcRenderer.send('settings:open'),
  closeSettings: () => ipcRenderer.send('settings:close'),
  listModels: (url?: string) => ipcRenderer.invoke('ollama:models', url) as Promise<string[]>,
  // Claude: the key only ever goes one way, from this page to main.
  claudeStatus: () => ipcRenderer.invoke('claude:status') as Promise<ClaudeStatus>,
  setClaudeKey: (key: string) => ipcRenderer.invoke('claude:set-key', key) as Promise<{ ok: boolean; message: string }>,
  listClaudeModels: () => ipcRenderer.invoke('claude:models') as Promise<{ ok: boolean; models: string[]; message: string }>,
  onClaudeStatus: (cb: (s: ClaudeStatus) => void) => on('claude:status', cb),
  listVoices: () => ipcRenderer.invoke('voice:list') as Promise<VoiceInfo[]>,
  testVoice: (lang: SpeechLang) => ipcRenderer.send('voice:test', lang),
  getKokoroStatus: () => ipcRenderer.invoke('voice:kokoro-status') as Promise<KokoroStatus>,
  onKokoroStatus: (cb: (s: KokoroStatus) => void) => on('voice:kokoro-status', cb)
}

contextBridge.exposeInMainWorld('poppy', api)

export type PoppyApi = typeof api
