import { CUT_SHORT_NOTE, shouldFallBack, type BrainMessage } from '../shared/brain'
import { DEFAULT_SETTINGS, type BrainStatus, type Settings } from '../shared/types'
import { askClaude, claudeProblem, ClaudeRefusal, streamClaude } from './claude'
import { canSee, chatOnce, listModels, pickDefaultModel, streamChat } from './ollama'
import { getApiKey } from './secrets'

/** No first words from Claude within this time: Ollama answers instead. */
const FIRST_WORDS_TIMEOUT_MS = 20_000

/** An error whose message is already written for the user. */
export class BrainError extends Error {}

export interface StreamOptions {
  signal: AbortSignal
  /** Ollama's context size for this request. */
  numCtx?: number
}

export interface AskOptions {
  maxTokens: number
  /** JSON schema for the answer (Claude follows it exactly; Ollama gets JSON mode). */
  schema?: Record<string, unknown>
  temperature?: number
  signal: AbortSignal
}

/**
 * Poppy's brain: Claude when it's switched on and has a key, with Ollama as the backup,
 * or Ollama only. Memory search (embeddings) always stays on Ollama.
 */
export class Brain {
  private lastProblem: string | null = null
  /** Which model wrote the latest reply, for the menu and errors. */
  lastModel = ''
  private listeners = new Set<(s: BrainStatus) => void>()

  constructor(
    private settings: () => Settings,
    private saveSettings: (patch: Partial<Settings>) => void
  ) {}

  onStatus(fn: (s: BrainStatus) => void): void {
    this.listeners.add(fn)
  }

  status(): BrainStatus {
    return { keySet: !!getApiKey(), lastProblem: this.lastProblem }
  }

  private usesClaude(): boolean {
    return this.settings().brain === 'claude' && !!getApiKey()
  }

  private problem(text: string | null): void {
    if (text === this.lastProblem) return
    this.lastProblem = text
    for (const fn of this.listeners) fn(this.status())
  }

  /** The Ollama model to use: the chosen one, or the best installed one when none is chosen (or the default isn't installed). */
  async ollamaModel(): Promise<string> {
    const s = this.settings()
    let model = s.model
    const defaultMissing = model === DEFAULT_SETTINGS.model && !(await listModels(s.ollamaUrl)).includes(model)
    if (!model || defaultMissing) {
      model = await pickDefaultModel(s.ollamaUrl)
      this.saveSettings({ model })
    }
    return model
  }

  /** Streams a reply. Images go along with the last message. */
  async *stream(messages: BrainMessage[], opts: StreamOptions): AsyncGenerator<string> {
    const s = this.settings()
    if (this.usesClaude()) {
      const model = s.claudeModel || DEFAULT_SETTINGS.claudeModel
      // Claude gets its own abort, so a hang before the first words can hand over to Ollama.
      const ctrl = new AbortController()
      const onAbort = (): void => ctrl.abort()
      opts.signal.addEventListener('abort', onAbort)
      const timer = setTimeout(() => ctrl.abort(), FIRST_WORDS_TIMEOUT_MS)
      let gotText = false
      try {
        for await (const chunk of streamClaude(getApiKey()!, model, messages, ctrl.signal)) {
          if (!gotText) {
            gotText = true
            clearTimeout(timer)
            this.lastModel = model
          }
          yield chunk
        }
        this.problem(null)
        return
      } catch (err) {
        if (opts.signal.aborted) throw err
        const refused = err instanceof ClaudeRefusal
        const why = gotText || refused ? claudeProblem(err) : ctrl.signal.aborted ? 'Claude took too long' : claudeProblem(err)
        console.warn(`[brain] Claude failed: ${why}`)
        if (refused) throw new BrainError("I'd rather not answer that one.")
        this.problem(why)
        if (gotText) {
          yield `\n\n${CUT_SHORT_NOTE}`
          return
        }
        if (!shouldFallBack({ aborted: false, gotText, refused, fallbackEnabled: s.claudeFallback })) {
          throw new BrainError(`Claude didn't answer: ${why}. You can switch on the Ollama backup in settings.`)
        }
        console.warn('[brain] answering with Ollama instead')
      } finally {
        clearTimeout(timer)
        opts.signal.removeEventListener('abort', onAbort)
      }
    }
    yield* this.streamOllama(messages, opts)
  }

  private async *streamOllama(messages: BrainMessage[], opts: StreamOptions): AsyncGenerator<string> {
    const s = this.settings()
    const model = await this.ollamaModel()
    this.lastModel = model
    if (messages.some((m) => m.images?.length) && !(await canSee(s.ollamaUrl, model))) {
      throw new BrainError(`My model ${model} can't look at pictures. Pick one that can, like qwen3.6:35b-a3b, in settings.`)
    }
    yield* streamChat(s.ollamaUrl, model, messages, opts.signal, opts.numCtx)
  }

  /** One short answer for Poppy's own work (learning, reflection, the spoken wrap-up). */
  async ask(system: string, user: string, opts: AskOptions): Promise<string> {
    const s = this.settings()
    if (this.usesClaude()) {
      try {
        return await askClaude(getApiKey()!, s.claudeModel || DEFAULT_SETTINGS.claudeModel, system, user, opts)
      } catch (err) {
        if (opts.signal.aborted) throw err
        const refused = err instanceof ClaudeRefusal
        console.warn(`[brain] Claude failed (background): ${claudeProblem(err)}`)
        if (!shouldFallBack({ aborted: false, gotText: false, refused, fallbackEnabled: s.claudeFallback })) throw err
      }
    }
    const options: Record<string, unknown> = { num_predict: opts.maxTokens }
    if (opts.temperature !== undefined) options.temperature = opts.temperature
    return chatOnce(
      s.ollamaUrl,
      await this.ollamaModel(),
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      opts.signal,
      options,
      opts.schema ? { format: 'json' } : {}
    )
  }
}
