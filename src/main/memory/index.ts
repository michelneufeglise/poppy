import { buddyOf, fill } from '../../shared/buddy'
import { parseReply } from '../../shared/reply'
import {
  asksWhatPoppyKnows,
  buildMemoryNote,
  cosine,
  keywordScore,
  looksLikeCorrection,
  norm,
  parseExtraction,
  parseNotebook,
  relationLine,
  sameMemory,
  topMatches,
  USER_ENTITY,
  firstJsonObject,
  type Extraction
} from '../../shared/memory'
import type { MemorySnapshot, MemoryStats, Settings } from '../../shared/types'
import type { Brain } from '../brain'
import { embed } from '../ollama'
import { MemoryStore, type Fact, type StoredMessage } from './db'

/** How long Poppy must be quiet before he reflects, and how often at most. */
const REFLECT_AFTER_IDLE_MS = 10 * 60_000
const REFLECT_EVERY_MS = 60 * 60_000
const LEARN_TIMEOUT_MS = 90_000
const EMBED_TIMEOUT_MS = 4_000
const DAY = 86_400

const LEARN_PROMPT = `You keep the long-term memory of {name}, a small desk buddy who chats with one user.
Read one exchange and return only what is worth remembering for future chats, as JSON.

facts: durable facts the USER stated about themselves: name, where they live, work, family, hobbies, preferences, projects, tools and things they own, ongoing plans.
- One short sentence each, in English, in the third person, starting with "The user" (or their name once known).
- NEVER: anything {name} said, facts about {name}, greetings, one-off moods ("tired today"), questions the user asked, hypotheticals, general knowledge.
- kind: "about" (who they are), "preference" (likes, dislikes, how they want things), "project" (what they work on), "other".

entities: people, organizations, projects, places, things and topics that matter to the user. type: person, organization, project, place, thing or topic.
The user is always the entity "the user": never add the user's own name as a separate entity (their name belongs in facts).
relations: links between those entities, e.g. {"from":"the user","type":"works_at","to":"Acme"} or {"from":"Sara","type":"sister_of","to":"the user"}. Use short snake_case verbs.
outdated: ids of KNOWN facts (listed below) that this exchange shows are no longer true.
lesson: if the user corrected {name}, complained about {his} answer, or clearly liked how {he} answered, ONE short rule for {name} for next time (e.g. "Keep answers about code short and skip the small talk."). Otherwise null.

Never invent anything. When nothing is worth keeping, return empty lists.
Answer with JSON only, exactly this shape:
{"facts":[{"text":"…","kind":"about"}],"entities":[{"name":"…","type":"person"}],"relations":[{"from":"…","type":"…","to":"…"}],"outdated":[],"lesson":null}`

const FEEDBACK_PROMPT = `You help {name}, a small desk buddy, learn how {his} user likes to be answered.
The user rated one of {name}'s answers. Write ONE short, general lesson for {name}'s future answers (not about this one topic), in English, max 20 words.
- GOOD: say what worked, as a soft preference ("Short, concrete explanations with an everyday comparison work well.").
- NOT QUITE: say what to do differently next time, based only on what you can see in this answer.
Never make the lesson stricter or broader than the evidence. If nothing general can be learned, use null.
Answer with JSON only: {"lesson":"…"} or {"lesson":null}`

const NOTEBOOK_PROMPT = `You are {name}, a small desk buddy. Below are lessons you learned about how your user likes to be answered.
Rewrite them into your own notebook: at most 10 short, clear rules for yourself, most important first.
Merge rules that say the same thing; when two disagree, keep the newer one (listed later). Drop anything vague.
Keep each rule exactly as soft or as strong as the lessons say; never make a rule stricter (no "always" or "exactly" unless a lesson says so).
Answer with JSON only: {"rules":["…","…"]}`

export interface MemoryDeps {
  file: string
  settings: () => Settings
  /** True while Poppy is answering or speaking: learning waits for quiet. */
  busy: () => boolean
  /** The same brain as the chat (Claude or Ollama); embeddings always use Ollama. */
  brain: Brain
}

// JSON shapes for the learner. Claude follows them exactly; Ollama gets JSON mode and the prompt.
const LEARN_SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, kind: { type: 'string', enum: ['about', 'preference', 'project', 'other'] } },
        required: ['text', 'kind'],
        additionalProperties: false
      }
    },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['person', 'organization', 'project', 'place', 'thing', 'topic'] }
        },
        required: ['name', 'type'],
        additionalProperties: false
      }
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { from: { type: 'string' }, type: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'type', 'to'],
        additionalProperties: false
      }
    },
    outdated: { type: 'array', items: { type: 'integer' } },
    lesson: { anyOf: [{ type: 'string' }, { type: 'null' }] }
  },
  required: ['facts', 'entities', 'relations', 'outdated', 'lesson'],
  additionalProperties: false
}
const LESSON_SCHEMA = {
  type: 'object',
  properties: { lesson: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
  required: ['lesson'],
  additionalProperties: false
}
const NOTEBOOK_SCHEMA = {
  type: 'object',
  properties: { rules: { type: 'array', items: { type: 'string' } } },
  required: ['rules'],
  additionalProperties: false
}

/**
 * Poppy's memory loop: recall before a reply, learn after it, take feedback, and reflect when quiet.
 * The thinking runs on Poppy's brain (Claude or Ollama); everything is stored in Poppy's own database on this Mac.
 */
export class Memory {
  readonly store: MemoryStore
  private jobs: ({ kind: 'learn'; replyId: number } | { kind: 'feedback'; replyId: number; value: 'good' | 'not_quite' })[] = []
  private working = false
  private retryTimer: NodeJS.Timeout | null = null
  private reflectTimer: NodeJS.Timeout
  private lastActivity = Date.now()
  private embeddings: 'ok' | 'missing' | 'unknown' = 'unknown'
  private statusListeners = new Set<() => void>()

  /** Poppy or Polly, whoever the user picked. */
  private get me(): string {
    return buddyOf(this.deps.settings().character).name
  }

  private fill(prompt: string): string {
    return fill(prompt, buddyOf(this.deps.settings().character))
  }

  constructor(private deps: MemoryDeps) {
    this.store = new MemoryStore(deps.file)
    this.reflectTimer = setInterval(() => void this.maybeReflect(), 60_000)
    // Replies from last time that Poppy didn't get to learn from.
    for (const id of this.store.unlearnedReplies(5)) this.jobs.push({ kind: 'learn', replyId: id })
    setTimeout(() => this.kick(), 30_000)
  }

  close(): void {
    clearInterval(this.reflectTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.store.close()
  }

  onStatus(fn: () => void): void {
    this.statusListeners.add(fn)
  }

  /** Something happened in the chat: reflection waits for quiet. */
  touch(): void {
    this.lastActivity = Date.now()
  }

  stats(): MemoryStats {
    return { ...this.store.stats(), embeddings: this.embeddings, learning: this.deps.settings().memoryEnabled }
  }

  // ---------- embeddings ----------

  /** Embeddings with the right prefixes for the model; nulls when there's no embedding model. */
  async vectors(texts: string[], as: 'query' | 'document'): Promise<(Float32Array | null)[]> {
    const s = this.deps.settings()
    const model = s.embedModel.trim()
    if (!model || !texts.length) return texts.map(() => null)
    const prefix = /nomic/i.test(model)
      ? as === 'query'
        ? 'search_query: '
        : 'search_document: '
      : /mxbai/i.test(model) && as === 'query'
        ? 'Represent this sentence for searching relevant passages: '
        : ''
    try {
      const out = await embed(s.ollamaUrl, model, texts.map((t) => prefix + t), AbortSignal.timeout(EMBED_TIMEOUT_MS))
      this.setEmbeddings('ok')
      return out.map((v) => Float32Array.from(v))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/not found|pull/i.test(msg)) this.setEmbeddings('missing')
      else console.warn('[memory] embedding failed:', msg)
      return texts.map(() => null)
    }
  }

  private setEmbeddings(state: 'ok' | 'missing'): void {
    if (this.embeddings === state) return
    this.embeddings = state
    for (const fn of this.statusListeners) fn()
  }

  // ---------- recall ----------

  /** The memory note for Poppy's instructions before he answers this message. */
  async recall(text: string): Promise<string> {
    this.touch()
    const store = this.store
    const facts = store.facts()
    const notebook = store.notebook()
    const entities = store.entities()
    if (!facts.length && !notebook.length && !entities.length) return ''

    const [qv] = await this.vectors([text], 'query')
    const score = (item: { text: string; vec: Float32Array | null }): number =>
      qv && item.vec && item.vec.length === qv.length ? cosine(qv, item.vec) : keywordScore(text, item.text) * 0.9
    const min = qv ? 0.5 : 0.2

    const known = facts.filter((f) => f.kind !== 'lesson')
    const lessons = facts.filter((f) => f.kind === 'lesson')
    let chosen: Fact[]
    if (asksWhatPoppyKnows(text)) {
      chosen = [...known].sort((a, b) => b.confidence - a.confidence).slice(0, 25)
    } else {
      // Who the user is always comes along; the rest only when it matches what they're asking.
      const core = known
        .filter((f) => f.kind === 'about')
        .sort((a, b) => b.confidence - a.confidence || b.uses - a.uses)
        .slice(0, 4)
      const matches = topMatches(known, score, 8, min).map((m) => m.item)
      chosen = [...core, ...matches.filter((m) => !core.includes(m))]
    }

    const rules = notebook.length
      ? [...notebook, ...topMatches(lessons, score, 3, min).map((m) => m.item.text)]
      : [...lessons].sort((a, b) => b.confidence - a.confidence).slice(0, 6).map((l) => l.text)
    const ruleLines = rules.filter((r, i) => rules.findIndex((x) => norm(x) === norm(r)) === i)

    // Knowledge graph: the things this message is about, plus the user, one step out.
    const q = ` ${norm(text)} `
    const named = entities.filter((e) => e.name !== USER_ENTITY && norm(e.name).length > 2 && q.includes(` ${norm(e.name)} `))
    const similar = qv
      ? topMatches(entities.filter((e) => e.vec), (e) => cosine(qv, e.vec), 3, 0.62).map((m) => m.item)
      : []
    const user = entities.find((e) => e.name === USER_ENTITY)
    const focus = [...new Set([...named, ...similar, ...(user ? [user] : [])])]
    const byId = new Map(entities.map((e) => [e.id, e]))
    const graph = store
      .relationsOf(focus.map((e) => e.id))
      .slice(0, 12)
      .map((r) => relationLine(byId.get(r.src)?.name ?? '?', r.type, byId.get(r.dst)?.name ?? '?'))

    store.markUsed(chosen.map((f) => f.id))
    return buildMemoryNote({ facts: chosen.map((f) => f.text), lessons: ruleLines.slice(0, 12), graph })
  }

  // ---------- learning ----------

  /** Learn from this reply (and the message it answered) once Poppy is quiet. */
  learnFrom(replyMessageId: number): void {
    if (!this.deps.settings().memoryEnabled) {
      this.store.markLearned(replyMessageId)
      return
    }
    this.jobs.push({ kind: 'learn', replyId: replyMessageId })
    this.kick()
  }

  /** The user rated a reply with "good" or "not quite". */
  feedback(replyMessageId: number, value: 'good' | 'not_quite'): void {
    this.store.setFeedback(replyMessageId, value)
    this.touch()
    if (!this.deps.settings().memoryEnabled) return
    this.jobs.push({ kind: 'feedback', replyId: replyMessageId, value })
    this.kick()
  }

  /** Works through the queue, one job at a time, only while Poppy isn't answering. */
  kick(): void {
    if (this.working || !this.jobs.length) return
    if (this.deps.busy()) {
      if (!this.retryTimer) this.retryTimer = setTimeout(() => ((this.retryTimer = null), this.kick()), 3_000)
      return
    }
    this.working = true
    const job = this.jobs.shift()!
    const run = job.kind === 'learn' ? this.learn(job.replyId) : this.learnFromFeedback(job.replyId, job.value)
    run
      .catch((err) => console.warn('[memory] learning failed:', err instanceof Error ? err.message : err))
      .finally(() => {
        this.working = false
        this.kick()
      })
  }

  /** Undo what was learned from the latest exchange ("forget that"). Returns how many memories went. */
  forgetLatest(conversationId: number): number {
    const recent = this.store.recentMessages(conversationId, 2).map((m) => m.id)
    this.jobs = this.jobs.filter((j) => !recent.includes(j.replyId))
    for (const id of recent) this.store.markLearned(id)
    return this.store.forgetFromMessages(recent)
  }

  private askJson(system: string, user: string, maxTokens: number, schema: Record<string, unknown>): Promise<string> {
    return this.deps.brain.ask(system, user, { maxTokens, schema, temperature: 0, signal: AbortSignal.timeout(LEARN_TIMEOUT_MS) })
  }

  private async learn(replyId: number): Promise<void> {
    const reply = this.store.message(replyId)
    const asked = reply ? this.store.previousMessage(replyId) : null
    if (!reply || reply.role !== 'assistant' || !asked || asked.role !== 'user') {
      this.store.markLearned(replyId)
      return
    }
    const before = this.store.previousMessage(asked.id)
    const related = await this.relatedFacts(`${asked.display}\n${reply.display}`)
    const prompt = [
      related.length
        ? `Known facts that may be related (id: text):\n${related.map((f) => `${f.id}: ${f.text}`).join('\n')}`
        : 'Known facts that may be related: none',
      before?.role === 'assistant' ? `${this.me}'s previous answer:\n"""\n${clip(before.display, 1200)}\n"""` : '',
      `The user:\n"""\n${clip(asked.content, 3000)}\n"""`,
      `${this.me}:\n"""\n${clip(parseReply(reply.content).text, 1500)}\n"""`,
      looksLikeCorrection(asked.display) ? `(The user's message sounds like a correction of ${this.me}'s previous answer.)` : ''
    ]
      .filter(Boolean)
      .join('\n\n')
    const raw = await this.askJson(this.fill(LEARN_PROMPT), prompt, 700, LEARN_SCHEMA)
    const found = parseExtraction(raw, related.map((f) => f.id))
    await this.save(found, asked.id)
    this.store.markLearned(replyId)
    const n = found.facts.length + found.relations.length + (found.lesson ? 1 : 0)
    if (n || found.outdated.length) console.log(`[memory] learned ${n} things, ${found.outdated.length} outdated`)
  }

  private async relatedFacts(text: string): Promise<Fact[]> {
    const facts = this.store.facts().filter((f) => f.kind !== 'lesson')
    if (!facts.length) return []
    const [v] = await this.vectors([text], 'query')
    const score = (f: Fact): number => (v && f.vec && f.vec.length === v.length ? cosine(v, f.vec) : keywordScore(text, f.text))
    return topMatches(facts, score, 8, v ? 0.45 : 0.15).map((m) => m.item)
  }

  private async save(found: Extraction, sourceMsg: number): Promise<void> {
    const store = this.store
    store.deactivateFacts(found.outdated)
    const texts = [...found.facts.map((f) => f.text), ...(found.lesson ? [found.lesson] : [])]
    const vecs = await this.vectors(texts, 'document')
    found.facts.forEach((f, i) => store.addFact({ text: f.text, kind: f.kind, confidence: 0.8, sourceMsg, vec: vecs[i] }))
    if (found.lesson) store.addFact({ text: found.lesson, kind: 'lesson', confidence: 0.8, sourceMsg, vec: vecs.at(-1) ?? null })

    if (!found.entities.length && !found.relations.length) return
    const names = new Map<string, { name: string; type: (typeof found.entities)[number]['type'] }>()
    for (const e of found.entities) names.set(norm(e.name), e)
    for (const r of found.relations)
      for (const n of [r.from, r.to]) if (!names.has(norm(n))) names.set(norm(n), { name: n, type: 'thing' })
    const list = [...names.values()]
    const evecs = await this.vectors(list.map((e) => e.name), 'document')
    const ids = new Map<string, number>()
    list.forEach((e, i) => {
      const id = store.upsertEntity(e.name, e.type, evecs[i])
      ids.set(norm(e.name), id)
      store.addMention(id, sourceMsg)
    })
    for (const r of found.relations) {
      const src = ids.get(norm(r.from))
      const dst = ids.get(norm(r.to))
      if (src && dst) store.addRelation(src, dst, r.type, sourceMsg)
    }
  }

  private async learnFromFeedback(replyId: number, value: 'good' | 'not_quite'): Promise<void> {
    const reply = this.store.message(replyId)
    const asked = reply ? this.store.previousMessage(replyId) : null
    if (!reply || !asked) return
    const prompt = `Rating: ${value === 'good' ? 'GOOD (the user liked this answer)' : 'NOT QUITE (the user was not happy with this answer)'}

The user asked:
"""
${clip(asked.display, 1200)}
"""

${this.me} answered:
"""
${clip(parseReply(reply.content).text, 1500)}
"""`
    const raw = await this.askJson(this.fill(FEEDBACK_PROMPT), prompt, 120, LESSON_SCHEMA)
    const data = firstJsonObject(raw) as { lesson?: unknown } | null
    const lesson = typeof data?.lesson === 'string' ? data.lesson.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
    if (lesson.length < 8) return
    const [vec] = await this.vectors([lesson], 'document')
    this.store.addFact({ text: lesson, kind: 'lesson', confidence: value === 'good' ? 0.7 : 0.85, sourceMsg: reply.id, vec })
    console.log(`[memory] lesson from "${value}": ${lesson}`)
  }

  // ---------- reflection ----------

  private async maybeReflect(): Promise<void> {
    if (this.working || this.deps.busy() || !this.deps.settings().memoryEnabled) return
    if (Date.now() - this.lastActivity < REFLECT_AFTER_IDLE_MS) return
    const last = Number(this.store.getMeta('last_reflect') ?? 0)
    if (Date.now() / 1000 - last < REFLECT_EVERY_MS / 1000) return
    if (last && !this.store.changedSince(last)) return
    await this.reflect()
  }

  /** Tidies memory: merges duplicates, lets unused facts fade, and rewrites the notebook. */
  async reflect(): Promise<{ merged: number; faded: number; entities: number; rules: number }> {
    this.working = true
    try {
      const store = this.store
      const result = { merged: 0, faded: 0, entities: 0, rules: store.notebook().length }

      // Same fact twice: keep the surer (or newer) one.
      const facts = [...store.facts()].sort((a, b) => b.confidence - a.confidence || b.createdAt - a.createdAt)
      const kept: Fact[] = []
      const drop: number[] = []
      for (const f of facts) {
        if (kept.some((k) => (k.kind === 'lesson') === (f.kind === 'lesson') && sameMemory(k, f))) drop.push(f.id)
        else kept.push(f)
      }
      store.deactivateFacts(drop)
      result.merged = drop.length

      // Facts that haven't come up in a month fade a little; very weak ones are switched off.
      const nowS = Date.now() / 1000
      const fade: number[] = []
      for (const f of kept) {
        const seen = f.lastUsed ?? f.createdAt
        if (nowS - seen < 30 * DAY) continue
        const c = Math.round((f.confidence - 0.05) * 100) / 100
        if (c < 0.35 && f.kind !== 'about') fade.push(f.id)
        else store.setConfidence(f.id, Math.max(0.35, c))
      }
      store.deactivateFacts(fade)
      result.faded = fade.length

      // Two names for one thing ("Acme" and "Acme Inc."): merge them.
      const ents = store.entities()
      for (let i = 0; i < ents.length; i++) {
        for (let j = i + 1; j < ents.length; j++) {
          const a = ents[i]
          const b = ents[j]
          const same =
            a.type === b.type &&
            (norm(a.name).replace(/\b(the|de|het|inc|bv|ltd)\b/g, '').trim() === norm(b.name).replace(/\b(the|de|het|inc|bv|ltd)\b/g, '').trim() ||
              (a.vec && b.vec && cosine(a.vec, b.vec) >= 0.96))
          if (same && a.name !== USER_ENTITY && b.name !== USER_ENTITY) {
            store.mergeEntity(b.id, a.id)
            result.entities++
            ents.splice(j, 1)
            j--
          }
        }
      }

      // The notebook: lessons rewritten into a few clear rules.
      const lessons = store
        .facts()
        .filter((f) => f.kind === 'lesson')
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-30)
      if (lessons.length) {
        const { good, notQuite } = store.feedbackCounts()
        const raw = await this.askJson(
          this.fill(NOTEBOOK_PROMPT),
          `Lessons, oldest first:\n${lessons.map((l) => `- ${l.text}`).join('\n')}\n\nRatings so far: ${good} good, ${notQuite} not quite.`,
          500,
          NOTEBOOK_SCHEMA
        )
        const rules = parseNotebook(raw)
        if (rules.length) {
          store.setNotebook(rules)
          result.rules = rules.length
        }
      }
      store.setMeta('last_reflect', String(Date.now() / 1000))
      console.log(`[memory] reflected: ${JSON.stringify(result)}`)
      return result
    } finally {
      this.working = false
      this.kick()
    }
  }

  // ---------- memory window ----------

  snapshot(): MemorySnapshot {
    const store = this.store
    const facts = store.facts()
    const entities = store.entities()
    const byId = new Map(entities.map((e) => [e.id, e]))
    const relations = store.allRelations()
    const shown = (name: string): string => (name === USER_ENTITY ? 'you' : name)
    return {
      stats: this.stats(),
      facts: facts
        .filter((f) => f.kind !== 'lesson')
        .map((f) => ({ id: f.id, text: f.text, kind: f.kind, confidence: f.confidence })),
      lessons: facts.filter((f) => f.kind === 'lesson').map((f) => ({ id: f.id, text: f.text })),
      notebook: store.notebook(),
      entities: entities
        .map((e) => ({
          id: e.id,
          name: shown(e.name),
          type: e.type,
          links: relations
            .filter((r) => r.src === e.id || r.dst === e.id)
            .map((r) => ({
              id: r.id,
              text: relationLine(shown(byId.get(r.src)?.name ?? '?'), r.type, shown(byId.get(r.dst)?.name ?? '?'))
            }))
        }))
        .sort((a, b) => (a.name === 'you' ? -1 : b.name === 'you' ? 1 : b.links.length - a.links.length))
    }
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export type { StoredMessage }
