/** Every state Poppy can show. Each one maps to assets/states/<state>.png. */
export const STATES = [
  'idle',
  'listening',
  'thinking',
  'talking',
  'happy',
  'sad',
  'surprised',
  'curious',
  'focused',
  'determined',
  'sleeping',
  'hello'
] as const
export type PoppyState = (typeof STATES)[number]

/** Moods the model may tag a reply with. Each one is also a state. */
export const MOODS = [
  'happy',
  'sad',
  'surprised',
  'curious',
  'focused',
  'determined',
  'thinking',
  'hello',
  'idle'
] as const
export type Mood = (typeof MOODS)[number]

/** English Kokoro voices (Kokoro has no Dutch). */
export const KOKORO_VOICES = [
  { id: 'af_heart', label: 'Heart (US, warm)' },
  { id: 'af_bella', label: 'Bella (US, bright, playful)' },
  { id: 'af_nicole', label: 'Nicole (US, clear)' },
  { id: 'af_sarah', label: 'Sarah (US, calm)' },
  { id: 'af_sky', label: 'Sky (US, airy)' },
  { id: 'af_aoede', label: 'Aoede (US, melodic)' },
  { id: 'am_adam', label: 'Adam (US, deep)' },
  { id: 'am_michael', label: 'Michael (US, confident)' },
  { id: 'am_liam', label: 'Liam (US, smooth)' },
  { id: 'am_puck', label: 'Puck (US, playful)' },
  { id: 'bf_emma', label: 'Emma (UK, refined)' },
  { id: 'bf_alice', label: 'Alice (UK, warm)' },
  { id: 'bf_isabella', label: 'Isabella (UK, elegant)' },
  { id: 'bm_george', label: 'George (UK, deep)' },
  { id: 'bm_daniel', label: 'Daniel (UK, news anchor)' },
  { id: 'bm_fable', label: 'Fable (UK, storyteller)' }
] as const

export type SpeechLang = 'en' | 'nl'

export interface Settings {
  ollamaUrl: string
  /** Empty means: pick a sensible installed model on first use. */
  model: string
  voiceEnabled: boolean
  /** Which voice speaks English replies. Dutch always uses the Mac voice below. */
  englishEngine: 'kokoro' | 'mac'
  kokoroVoice: string
  /** Kokoro speed, 0.5 to 2. */
  kokoroSpeed: number
  /** macOS voice for English (when Kokoro is off or fails). Empty means the system voice. */
  voice: string
  /** macOS voice for Dutch replies. */
  dutchVoice: string
  /** Words per minute for `say`. */
  rate: number
  /** 'summary': read along up to about 40 words, then say a short wrap-up of the rest. */
  longReplies: 'summary' | 'full'
  sleepAfterMinutes: number
  position: { x: number; y: number } | null
  /** Learn from chats (facts, knowledge graph, lessons). What's already known is still used when off. */
  memoryEnabled: boolean
  /** Ollama embedding model for memory search. Without one, memory search falls back to keywords. */
  embedModel: string
}

export const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: 'http://127.0.0.1:11434',
  model: 'qwen3.6:35b-a3b',
  voiceEnabled: true,
  englishEngine: 'kokoro',
  kokoroVoice: 'af_heart',
  kokoroSpeed: 1,
  voice: '',
  dutchVoice: 'Xander',
  rate: 185,
  longReplies: 'summary',
  sleepAfterMinutes: 10,
  position: null,
  memoryEnabled: true,
  embedModel: 'nomic-embed-text'
}

export interface ChatUpdate {
  id: number
  /** Full visible reply so far (mood tags and thinking removed). */
  text: string
  mood: Mood | null
  done: boolean
  /** A fixed answer (like after "forget that"): no good / not quite links under it. */
  noRating?: boolean
}

export interface ChatError {
  id: number
  message: string
}

export interface VoiceInfo {
  name: string
  lang: string
}

export interface KokoroStatus {
  state: 'off' | 'starting' | 'copying' | 'downloading' | 'ready' | 'error'
  message: string
}

export interface AttachmentInfo {
  id: string
  name: string
  kind: 'image' | 'text' | 'pdf'
  size: number
  /** Small preview for images (data URL). */
  thumb?: string
}

export interface AttachResult {
  added: AttachmentInfo[]
  refused: { name: string; reason: string }[]
}

/** A chat message restored from Poppy's memory when he starts. */
export interface PastMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface MemoryStats {
  facts: number
  lessons: number
  entities: number
  relations: number
  messages: number
  /** Whether memory search uses embeddings ('ok'), keywords only ('missing'), or hasn't been tried yet. */
  embeddings: 'ok' | 'missing' | 'unknown'
  learning: boolean
}

/** Everything Poppy knows, for the memory window. */
export interface MemorySnapshot {
  stats: MemoryStats
  facts: { id: number; text: string; kind: string; confidence: number }[]
  lessons: { id: number; text: string }[]
  notebook: string[]
  entities: {
    id: number
    name: string
    type: string
    links: { id: number; text: string }[]
  }[]
}
