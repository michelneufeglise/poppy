/**
 * The setup guide's rules (no system access here, so they can be tested): what this Mac can run,
 * which model fits it, and how each step's result is told and drawn.
 */

export interface MacInfo {
  /** "26.6.2" */
  macos: string
  chip: 'apple' | 'intel'
  /** "Apple M1 Max" */
  chipName: string
  memGB: number
  /** Free space on the disk with the home folder. */
  freeGB: number
  /** The Swift compiler (Xcode or its command line tools): needed for voice input. */
  swift: boolean
  /** Homebrew, which the guide uses to install things (with your yes). */
  brew: boolean
}

export type CheckState = 'ok' | 'warn' | 'missing'

export interface Check {
  id: string
  state: CheckState
  /** "Apple M1 Max" */
  label: string
  /** What it means, short. */
  note: string
}

/** Electron 45 runs on macOS 12 and up. */
export const MIN_MACOS = 12
/** Voice input uses SpeechAnalyzer, new in macOS 26. */
export const LISTEN_MACOS = 26
/** Room left after a model download (GB). */
export const SPARE_GB = 5

export const majorOf = (version: string): number => Number.parseInt(version.split('.')[0] ?? '', 10) || 0

export interface ModelChoice {
  model: string
  /** Download size (GB). */
  sizeGB: number
  pictures: boolean
  /** Memory this model wants (GB). */
  minMemGB: number
  note: string
}

/** From the biggest to the smallest; the same list as the README. */
export const MODELS: ModelChoice[] = [
  { model: 'qwen3.6:35b-a3b', sizeGB: 23, pictures: true, minMemGB: 32, note: 'the best answers, and it can look at pictures' },
  { model: 'gemma3:4b', sizeGB: 3.3, pictures: true, minMemGB: 12, note: 'small, quick, and it can look at pictures' },
  { model: 'qwen3:4b-instruct-2507-q4_K_M', sizeGB: 2.5, pictures: false, minMemGB: 0, note: 'small and quick, for chatting' }
]

/** For memory search; small. */
export const EMBED_MODEL = { model: 'nomic-embed-text', sizeGB: 0.27 }

/** The biggest model this Mac has room and memory for (the smallest when nothing fits). */
export function modelFor(info: Pick<MacInfo, 'memGB' | 'freeGB' | 'chip'>): ModelChoice {
  // Intel Macs have no unified memory for the model: a small one is the only quick one there.
  const fits = MODELS.filter(
    (m) => info.memGB >= m.minMemGB && info.freeGB >= m.sizeGB + SPARE_GB && (info.chip === 'apple' || m.sizeGB < 5)
  )
  return fits[0] ?? MODELS[MODELS.length - 1]
}

/** Whether the model list has this model (Ollama adds ":latest" to names without a tag). */
export function hasModel(installed: string[], model: string): boolean {
  const full = model.includes(':') ? model : `${model}:latest`
  return installed.some((m) => m === model || m === full)
}

/** Installed chat models (not the embedding ones). */
export const chatModels = (installed: string[]): string[] => installed.filter((m) => !/embed/i.test(m))

const gb = (n: number): string => (n >= 10 ? `${Math.round(n)} GB` : `${Math.round(n * 10) / 10} GB`)

/** The Mac check's lines. */
export function macChecks(info: MacInfo): Check[] {
  const major = majorOf(info.macos)
  const model = modelFor(info)
  const checks: Check[] = [
    {
      id: 'macos',
      state: major < MIN_MACOS ? 'missing' : major < LISTEN_MACOS ? 'warn' : 'ok',
      label: `macOS ${info.macos}`,
      note:
        major < MIN_MACOS
          ? `{name} needs macOS ${MIN_MACOS} or newer`
          : major < LISTEN_MACOS
            ? `everything works, except listening for {his} name (macOS ${LISTEN_MACOS})`
            : 'everything works, voice input too'
    },
    {
      id: 'chip',
      state: info.chip === 'apple' ? 'ok' : 'warn',
      label: info.chipName || (info.chip === 'apple' ? 'Apple Silicon' : 'Intel'),
      note: info.chip === 'apple' ? 'fast enough for local models' : 'local models are slow here; a small one works'
    },
    {
      id: 'memory',
      state: info.memGB >= 16 ? 'ok' : 'warn',
      label: `${gb(info.memGB)} memory`,
      note: `enough for ${model.model} (${model.note})`
    },
    {
      id: 'disk',
      state: info.freeGB >= model.sizeGB + SPARE_GB ? 'ok' : info.freeGB >= MODELS[MODELS.length - 1].sizeGB + 1 ? 'warn' : 'missing',
      label: `${gb(info.freeGB)} free`,
      note:
        info.freeGB >= model.sizeGB + SPARE_GB
          ? `room for the model (${gb(model.sizeGB)})`
          : `tight: a model needs ${gb(model.sizeGB)} or more`
    },
    {
      id: 'swift',
      state: info.swift ? 'ok' : 'warn',
      label: info.swift ? 'Swift compiler' : 'No Swift compiler',
      note: info.swift ? 'for {his} ears (voice input)' : "only needed for voice input; Apple's command line tools have it"
    },
    {
      id: 'brew',
      state: info.brew ? 'ok' : 'warn',
      label: info.brew ? 'Homebrew' : 'No Homebrew',
      note: info.brew ? 'so {he} can install things for you (asks first)' : "{he}'ll open the download pages instead"
    }
  ]
  return checks
}

/** The guide's steps, in order. */
export const STEPS = ['hello', 'mac', 'ollama', 'model', 'voice', 'tools', 'done'] as const
export type SetupStep = (typeof STEPS)[number]

/** How a step is going: checking, all fine, something missing, installing, or it failed. */
export type StepMood = 'checking' | 'ok' | 'missing' | 'working' | 'failed'

/** Her pose for each step and mood: her own drawings (states in assets/<character>/states). */
export function poseFor(step: SetupStep, mood: StepMood): string {
  if (step === 'hello') return 'hello'
  if (step === 'done') return mood === 'ok' ? 'clapping' : 'hopeful'
  if (mood === 'checking') return step === 'mac' ? 'focused' : 'thinking'
  if (mood === 'working') return 'busy'
  if (mood === 'failed') return 'sad'
  if (mood === 'missing') return { mac: 'nervous', ollama: 'anxious', model: 'hungry', voice: 'shy', tools: 'curious' }[step]
  return { mac: 'proud', ollama: 'happy', model: 'cheerful', voice: 'listening', tools: 'excited' }[step]
}

/** One line of Ollama's /api/pull stream → what to show (percent null while it has no size yet). */
export function pullProgress(line: { status?: string; completed?: number; total?: number; error?: string }): {
  text: string
  percent: number | null
  error?: string
} {
  if (line.error) return { text: line.error, percent: null, error: line.error }
  const status = line.status ?? ''
  if (line.total && line.completed !== undefined) {
    const percent = Math.min(100, Math.floor((line.completed / line.total) * 100))
    return { text: `${gb(line.completed / 1e9)} of ${gb(line.total / 1e9)}`, percent }
  }
  if (status === 'success') return { text: 'done', percent: 100 }
  return { text: status.replace(/^pulling [0-9a-f]{6,}.*/, 'downloading'), percent: null }
}

/** The newest line of an installer's output worth showing (brew, pip). */
export function lastLine(out: string): string {
  const lines = out
    .split(/\r?\n|\r/)
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim())
    .filter((l) => l && !/^#+\s*[\d.]+%$/.test(l))
  return (lines[lines.length - 1] ?? '').slice(0, 120)
}
