/**
 * Poppy's memory: the pure parts (no database, no network), so they can be tested.
 * What Poppy learns from chats: facts about the user, a small knowledge graph (entities and
 * relations) and lessons about how to answer. All of it stays on the user's Mac.
 */

export type FactKind = 'about' | 'preference' | 'project' | 'lesson' | 'other'
export const FACT_KINDS: FactKind[] = ['about', 'preference', 'project', 'lesson', 'other']

export type EntityType = 'person' | 'organization' | 'project' | 'place' | 'thing' | 'topic'
export const ENTITY_TYPES: EntityType[] = ['person', 'organization', 'project', 'place', 'thing', 'topic']

/** The name the knowledge graph uses for the person Poppy talks to. */
export const USER_ENTITY = 'the user'

export interface ExtractedFact {
  text: string
  kind: FactKind
}
export interface ExtractedEntity {
  name: string
  type: EntityType
}
export interface ExtractedRelation {
  from: string
  type: string
  to: string
}
export interface Extraction {
  facts: ExtractedFact[]
  entities: ExtractedEntity[]
  relations: ExtractedRelation[]
  /** Ids of known facts that the new information makes outdated. */
  outdated: number[]
  /** A lesson about how Poppy should answer, when the user corrected or praised him. */
  lesson: string | null
}

export const EMPTY_EXTRACTION: Extraction = { facts: [], entities: [], relations: [], outdated: [], lesson: null }

const MAX_FACTS = 6
const MAX_ENTITIES = 8
const MAX_RELATIONS = 8
const MAX_TEXT = 200

/** Lowercase, no accents, no punctuation, single spaces: for matching names and spotting duplicates. */
export function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const clean = (v: unknown, max = MAX_TEXT): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''

/** The first JSON object in a model reply, also when it's wrapped in a code fence or chatter. */
export function firstJsonObject(raw: string): unknown {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

/** Reads the learner model's JSON. Anything malformed is dropped rather than trusted. */
export function parseExtraction(raw: string, knownFactIds: number[] = []): Extraction {
  const data = firstJsonObject(raw) as Record<string, unknown> | null
  if (!data || typeof data !== 'object') return { ...EMPTY_EXTRACTION }
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

  const facts: ExtractedFact[] = []
  for (const f of list(data.facts)) {
    const text = clean(f.text ?? f.fact)
    const kind = FACT_KINDS.includes(f.kind as FactKind) ? (f.kind as FactKind) : 'other'
    if (text.length >= 8 && !facts.some((x) => norm(x.text) === norm(text))) facts.push({ text, kind })
  }

  const entities: ExtractedEntity[] = []
  for (const e of list(data.entities)) {
    const name = clean(e.name, 80)
    const type = ENTITY_TYPES.includes(e.type as EntityType) ? (e.type as EntityType) : 'thing'
    if (name && norm(name) && !entities.some((x) => norm(x.name) === norm(name))) entities.push({ name, type })
  }

  const relations: ExtractedRelation[] = []
  for (const r of list(data.relations)) {
    const from = clean(r.from, 80)
    const to = clean(r.to, 80)
    const type = clean(r.type, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    if (from && to && type && norm(from) !== norm(to)) relations.push({ from, type, to })
  }

  const outdated = Array.isArray(data.outdated)
    ? data.outdated.map(Number).filter((id) => Number.isInteger(id) && knownFactIds.includes(id))
    : []
  const lesson = clean(data.lesson) || null

  return {
    facts: facts.slice(0, MAX_FACTS),
    entities: entities.slice(0, MAX_ENTITIES),
    relations: relations.slice(0, MAX_RELATIONS),
    outdated,
    lesson: lesson && lesson.length >= 8 ? lesson : null
  }
}

/** Cosine similarity of two embeddings (0 when either is missing or they differ in size). */
export function cosine(a: ArrayLike<number> | null, b: ArrayLike<number> | null): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

const STOP = new Set(
  (
    'a an and are as at be but by do for from has have i in is it its me my of on or our so that the their them ' +
    'they this to was we were what when where which who why with you your de het een en ik is je jij mijn van ' +
    'wat wie waar hoe dat die dit er op in te met voor naar niet ook maar'
  ).split(' ')
)

function words(text: string): Set<string> {
  return new Set(norm(text).split(' ').filter((w) => w.length > 2 && !STOP.has(w)))
}

/** Word overlap between a query and a memory, for when there are no embeddings. */
export function keywordScore(query: string, text: string): number {
  const q = words(query)
  if (!q.size) return 0
  const t = words(text)
  let hit = 0
  for (const w of q) if (t.has(w)) hit++
  return hit / Math.sqrt(q.size * Math.max(1, t.size))
}

/** Similar enough to be the same memory said differently. */
export function sameMemory(a: { text: string; vec: ArrayLike<number> | null }, b: { text: string; vec: ArrayLike<number> | null }): boolean {
  if (norm(a.text) === norm(b.text)) return true
  if (a.vec && b.vec && a.vec.length === b.vec.length) return cosine(a.vec, b.vec) >= 0.93
  return keywordScore(a.text, b.text) >= 0.85
}

export interface Scored<T> {
  item: T
  score: number
}

/** The best matches above a minimum score. */
export function topMatches<T>(items: T[], score: (item: T) => number, limit: number, min: number): Scored<T>[] {
  return items
    .map((item) => ({ item, score: score(item) }))
    .filter((s) => s.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** The user pushing back on Poppy's last answer, in English or Dutch. */
export function looksLikeCorrection(text: string): boolean {
  return /^(no|nope|nee|neen)\b|\b(that'?s (not|wrong|incorrect)|not what i|i meant|you'?re wrong|too long|too short|shorter|stop (saying|doing)|don'?t (say|do|use)|klopt niet|dat is niet|bedoelde|te lang|te kort|korter|niet zo)\b/i.test(
    text.trim()
  )
}

/** "Forget that" / "vergeet dat": drop what was learned from the last exchange. */
export function isForgetRequest(text: string): boolean {
  return /^(please\s+|poppy,?\s+)?(forget|vergeet)\s+(that|this|it|what i (just )?said|dat|dit|het|wat ik (net )?zei)\b/i.test(
    text.trim()
  )
}

/** "What do you know about me?": recall everything about the user, not just what matches. */
export function asksWhatPoppyKnows(text: string): boolean {
  return /\b(what do you (know|remember) about me|wat (weet|onthoud) je (allemaal )?(over|van) mij)\b/i.test(text)
}

export interface MemoryNoteParts {
  facts: string[]
  lessons: string[]
  graph: string[]
}

const MAX_NOTE_CHARS = 2400

/** The block added to Poppy's instructions before a reply. Empty when there's nothing to say. */
export function buildMemoryNote(parts: MemoryNoteParts): string {
  const sections: string[] = []
  if (parts.facts.length) sections.push(`What you know about the user:\n${parts.facts.map((f) => `- ${f}`).join('\n')}`)
  if (parts.graph.length) sections.push(`Related things you know:\n${parts.graph.map((g) => `- ${g}`).join('\n')}`)
  if (parts.lessons.length)
    sections.push(`Your own notes on how to answer this user:\n${parts.lessons.map((l) => `- ${l}`).join('\n')}`)
  if (!sections.length) return ''
  let note =
    `\n\nYour memory (learned from earlier chats with this user):\n${sections.join('\n\n')}\n` +
    "Use this naturally when it helps. Don't recite it or mention your memory unless the user asks what you know."
  if (note.length > MAX_NOTE_CHARS) note = `${note.slice(0, MAX_NOTE_CHARS)}…`
  return note
}

/** One knowledge-graph link as a readable line: "the user — works at → Acme". */
export function relationLine(from: string, type: string, to: string): string {
  return `${from} — ${type.replace(/_/g, ' ')} → ${to}`
}

/** Notebook rules from the reflection model: a short list of plain sentences. */
export function parseNotebook(raw: string, max = 10): string[] {
  const data = firstJsonObject(raw) as { rules?: unknown } | null
  const rules = Array.isArray(data?.rules) ? data.rules : []
  const out: string[] = []
  for (const r of rules) {
    const text = clean(r, 160)
    if (text.length >= 8 && !out.some((x) => norm(x) === norm(text))) out.push(text)
  }
  return out.slice(0, max)
}

/** Embeddings are stored as little-endian float32 blobs. */
export function toBlob(vec: number[] | Float32Array): Uint8Array {
  const f = vec instanceof Float32Array ? vec : Float32Array.from(vec)
  return new Uint8Array(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength))
}

export function fromBlob(blob: Uint8Array | null | undefined): Float32Array | null {
  if (!blob || blob.byteLength < 4) return null
  const copy = new Uint8Array(blob.byteLength)
  copy.set(blob)
  return new Float32Array(copy.buffer)
}
