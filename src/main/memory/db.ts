import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fromBlob, norm, sameMemory, toBlob, USER_ENTITY, type EntityType, type FactKind } from '../../shared/memory'

/**
 * Poppy's own memory database (SQLite built into Node, no extra installs).
 * Lives in Poppy's data folder; nothing here is shared with any other app.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,          -- what the model sees (with attached file text)
  display TEXT NOT NULL,          -- what the chat shows
  created_at REAL NOT NULL,
  learned INTEGER NOT NULL DEFAULT 0,
  feedback TEXT                   -- 'good' | 'not_quite' on Poppy's replies
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  norm TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  source_msg INTEGER,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  last_used REAL,
  uses INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  embedding BLOB
);

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  norm TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  embedding BLOB
);
CREATE TABLE IF NOT EXISTS relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  src INTEGER NOT NULL,
  dst INTEGER NOT NULL,
  type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  source_msg INTEGER,
  created_at REAL NOT NULL,
  UNIQUE(src, dst, type)
);
CREATE INDEX IF NOT EXISTS relations_src ON relations(src);
CREATE INDEX IF NOT EXISTS relations_dst ON relations(dst);
CREATE TABLE IF NOT EXISTS mentions (
  entity_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  PRIMARY KEY(entity_id, message_id)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`

export interface StoredMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  display: string
  feedback: string | null
}

export interface Fact {
  id: number
  text: string
  kind: FactKind
  confidence: number
  sourceMsg: number | null
  createdAt: number
  lastUsed: number | null
  uses: number
  vec: Float32Array | null
}

export interface Entity {
  id: number
  name: string
  type: EntityType
  vec: Float32Array | null
}

export interface Relation {
  id: number
  src: number
  dst: number
  type: string
  confidence: number
}

type Row = Record<string, unknown>
const now = (): number => Date.now() / 1000

export class MemoryStore {
  private db: DatabaseSync
  private factCache: Fact[] | null = null
  private entityCache: Entity[] | null = null
  private changeListeners = new Set<() => void>()

  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;')
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  /** Called whenever what Poppy knows changes (for the memory window). */
  onChange(fn: () => void): void {
    this.changeListeners.add(fn)
  }

  private changed(): void {
    this.factCache = null
    this.entityCache = null
    for (const fn of this.changeListeners) fn()
  }

  // ---------- conversations ----------

  /** The conversation to continue: the latest one, or a new one. */
  latestConversation(): number {
    const row = this.db.prepare('SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1').get() as Row | undefined
    return row ? Number(row.id) : this.newConversation()
  }

  newConversation(): number {
    const t = now()
    return Number(this.db.prepare('INSERT INTO conversations (started_at, updated_at) VALUES (?, ?)').run(t, t).lastInsertRowid)
  }

  addMessage(conversationId: number, role: 'user' | 'assistant', content: string, display: string): number {
    const t = now()
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(t, conversationId)
    return Number(
      this.db
        .prepare('INSERT INTO messages (conversation_id, role, content, display, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(conversationId, role, content, display, t).lastInsertRowid
    )
  }

  /** The last messages of a conversation, oldest first. */
  recentMessages(conversationId: number, limit: number): StoredMessage[] {
    const rows = this.db
      .prepare('SELECT id, role, content, display, feedback FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?')
      .all(conversationId, limit) as Row[]
    return rows.reverse().map((r) => ({
      id: Number(r.id),
      role: r.role as 'user' | 'assistant',
      content: String(r.content),
      display: String(r.display),
      feedback: (r.feedback as string | null) ?? null
    }))
  }

  message(id: number): StoredMessage | null {
    const r = this.db.prepare('SELECT id, role, content, display, feedback FROM messages WHERE id = ?').get(id) as Row | undefined
    return r
      ? { id: Number(r.id), role: r.role as 'user' | 'assistant', content: String(r.content), display: String(r.display), feedback: (r.feedback as string | null) ?? null }
      : null
  }

  /** The message just before this one in the same conversation. */
  previousMessage(id: number): StoredMessage | null {
    const r = this.db
      .prepare(
        'SELECT m.id FROM messages m JOIN messages x ON x.id = ? WHERE m.conversation_id = x.conversation_id AND m.id < x.id ORDER BY m.id DESC LIMIT 1'
      )
      .get(id) as Row | undefined
    return r ? this.message(Number(r.id)) : null
  }

  deleteMessage(id: number): void {
    this.db.prepare('DELETE FROM messages WHERE id = ?').run(id)
  }

  setFeedback(messageId: number, value: 'good' | 'not_quite'): void {
    this.db.prepare("UPDATE messages SET feedback = ? WHERE id = ? AND role = 'assistant'").run(value, messageId)
  }

  markLearned(messageId: number): void {
    this.db.prepare('UPDATE messages SET learned = 1 WHERE id = ?').run(messageId)
  }

  /** Poppy's replies that haven't been learned from yet (e.g. Poppy quit before he got to them). */
  unlearnedReplies(limit: number): number[] {
    const rows = this.db
      .prepare("SELECT id FROM messages WHERE role = 'assistant' AND learned = 0 ORDER BY id DESC LIMIT ?")
      .all(limit) as Row[]
    return rows.map((r) => Number(r.id)).reverse()
  }

  // ---------- facts ----------

  facts(): Fact[] {
    if (!this.factCache) {
      const rows = this.db
        .prepare('SELECT id, text, kind, confidence, source_msg, created_at, last_used, uses, embedding FROM facts WHERE active = 1 ORDER BY id')
        .all() as Row[]
      this.factCache = rows.map((r) => ({
        id: Number(r.id),
        text: String(r.text),
        kind: r.kind as FactKind,
        confidence: Number(r.confidence),
        sourceMsg: r.source_msg == null ? null : Number(r.source_msg),
        createdAt: Number(r.created_at),
        lastUsed: r.last_used == null ? null : Number(r.last_used),
        uses: Number(r.uses),
        vec: fromBlob(r.embedding as Uint8Array | null)
      }))
    }
    return this.factCache
  }

  /**
   * Saves a fact, or strengthens the one it repeats. Returns the fact's id and whether it was new.
   */
  addFact(f: { text: string; kind: FactKind; confidence: number; sourceMsg: number | null; vec: Float32Array | null }): { id: number; added: boolean } {
    const same = this.facts().find((x) => (x.kind === 'lesson') === (f.kind === 'lesson') && sameMemory(x, f))
    const t = now()
    if (same) {
      this.db
        .prepare('UPDATE facts SET confidence = MIN(1, confidence + 0.05), updated_at = ? WHERE id = ?')
        .run(t, same.id)
      this.changed()
      return { id: same.id, added: false }
    }
    // A fact that was switched off earlier and is now said again comes back.
    const n = norm(f.text)
    const old = this.db.prepare('SELECT id FROM facts WHERE norm = ?').get(n) as Row | undefined
    if (old) {
      this.db
        .prepare('UPDATE facts SET active = 1, text = ?, kind = ?, confidence = ?, source_msg = ?, updated_at = ?, embedding = ? WHERE id = ?')
        .run(f.text, f.kind, f.confidence, f.sourceMsg, t, f.vec ? toBlob(f.vec) : null, Number(old.id))
      this.changed()
      return { id: Number(old.id), added: true }
    }
    const id = Number(
      this.db
        .prepare(
          'INSERT INTO facts (text, norm, kind, confidence, source_msg, created_at, updated_at, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(f.text, n, f.kind, f.confidence, f.sourceMsg, t, t, f.vec ? toBlob(f.vec) : null).lastInsertRowid
    )
    this.changed()
    return { id, added: true }
  }

  /** Switches facts off (kept in the file, but no longer used). */
  deactivateFacts(ids: number[]): void {
    if (!ids.length) return
    const stmt = this.db.prepare('UPDATE facts SET active = 0, updated_at = ? WHERE id = ?')
    for (const id of ids) stmt.run(now(), id)
    this.changed()
  }

  deleteFact(id: number): void {
    this.db.prepare('DELETE FROM facts WHERE id = ?').run(id)
    this.changed()
  }

  markUsed(ids: number[]): void {
    const stmt = this.db.prepare('UPDATE facts SET uses = uses + 1, last_used = ? WHERE id = ?')
    for (const id of ids) stmt.run(now(), id)
    // No change event: using a memory doesn't change what Poppy knows.
    if (this.factCache) for (const f of this.factCache) if (ids.includes(f.id)) (f.uses++, (f.lastUsed = now()))
  }

  setConfidence(id: number, confidence: number): void {
    this.db.prepare('UPDATE facts SET confidence = ? WHERE id = ?').run(confidence, id)
    this.factCache = null
  }

  // ---------- knowledge graph ----------

  entities(): Entity[] {
    if (!this.entityCache) {
      const rows = this.db.prepare('SELECT id, name, type, embedding FROM entities ORDER BY name').all() as Row[]
      this.entityCache = rows.map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        type: r.type as EntityType,
        vec: fromBlob(r.embedding as Uint8Array | null)
      }))
    }
    return this.entityCache
  }

  /** The entity with this name (any spelling), created when new. "The user" is one fixed entity. */
  upsertEntity(name: string, type: EntityType, vec: Float32Array | null): number {
    const isUser = /^(the user|user|me|i|ik|mij|you)$/i.test(name.trim())
    const n = isUser ? norm(USER_ENTITY) : norm(name)
    const row = this.db.prepare('SELECT id, embedding FROM entities WHERE norm = ?').get(n) as Row | undefined
    const t = now()
    if (row) {
      if (!row.embedding && vec) this.db.prepare('UPDATE entities SET embedding = ? WHERE id = ?').run(toBlob(vec), Number(row.id))
      this.db.prepare('UPDATE entities SET updated_at = ? WHERE id = ?').run(t, Number(row.id))
      this.entityCache = null
      return Number(row.id)
    }
    const id = Number(
      this.db
        .prepare('INSERT INTO entities (name, norm, type, created_at, updated_at, embedding) VALUES (?, ?, ?, ?, ?, ?)')
        .run(isUser ? USER_ENTITY : name, n, isUser ? 'person' : type, t, t, vec ? toBlob(vec) : null).lastInsertRowid
    )
    this.changed()
    return id
  }

  addRelation(src: number, dst: number, type: string, sourceMsg: number | null): void {
    if (src === dst) return
    const res = this.db
      .prepare('INSERT OR IGNORE INTO relations (src, dst, type, source_msg, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(src, dst, type, sourceMsg, now())
    if (res.changes) this.changed()
    else this.db.prepare('UPDATE relations SET confidence = MIN(1, confidence + 0.05) WHERE src = ? AND dst = ? AND type = ?').run(src, dst, type)
  }

  addMention(entityId: number, messageId: number): void {
    this.db.prepare('INSERT OR IGNORE INTO mentions (entity_id, message_id) VALUES (?, ?)').run(entityId, messageId)
  }

  /** Every relation touching these entities. */
  relationsOf(entityIds: number[]): Relation[] {
    if (!entityIds.length) return []
    const marks = entityIds.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT id, src, dst, type, confidence FROM relations WHERE src IN (${marks}) OR dst IN (${marks}) ORDER BY confidence DESC, id DESC`)
      .all(...entityIds, ...entityIds) as Row[]
    return rows.map((r) => ({ id: Number(r.id), src: Number(r.src), dst: Number(r.dst), type: String(r.type), confidence: Number(r.confidence) }))
  }

  allRelations(): Relation[] {
    const rows = this.db.prepare('SELECT id, src, dst, type, confidence FROM relations ORDER BY id').all() as Row[]
    return rows.map((r) => ({ id: Number(r.id), src: Number(r.src), dst: Number(r.dst), type: String(r.type), confidence: Number(r.confidence) }))
  }

  deleteRelation(id: number): void {
    this.db.prepare('DELETE FROM relations WHERE id = ?').run(id)
    this.removeOrphans()
    this.changed()
  }

  deleteEntity(id: number): void {
    this.db.prepare('DELETE FROM relations WHERE src = ? OR dst = ?').run(id, id)
    this.db.prepare('DELETE FROM mentions WHERE entity_id = ?').run(id)
    this.db.prepare('DELETE FROM entities WHERE id = ?').run(id)
    this.changed()
  }

  /** Moves everything from one entity to another (same thing, two names) and removes the first. */
  mergeEntity(from: number, into: number): void {
    if (from === into) return
    this.db.prepare('UPDATE OR IGNORE relations SET src = ? WHERE src = ?').run(into, from)
    this.db.prepare('UPDATE OR IGNORE relations SET dst = ? WHERE dst = ?').run(into, from)
    this.db.prepare('UPDATE OR IGNORE mentions SET entity_id = ? WHERE entity_id = ?').run(into, from)
    this.deleteEntity(from)
  }

  /** Entities with no relations and no mentions left. */
  private removeOrphans(): void {
    this.db.exec(`DELETE FROM entities WHERE norm != '${norm(USER_ENTITY)}'
      AND id NOT IN (SELECT src FROM relations) AND id NOT IN (SELECT dst FROM relations)
      AND id NOT IN (SELECT entity_id FROM mentions)`)
  }

  // ---------- forgetting ----------

  /** Undoes what was learned from these messages ("forget that"). */
  forgetFromMessages(messageIds: number[]): number {
    if (!messageIds.length) return 0
    const marks = messageIds.map(() => '?').join(',')
    const facts = this.db.prepare(`UPDATE facts SET active = 0 WHERE active = 1 AND source_msg IN (${marks})`).run(...messageIds).changes
    const rels = this.db.prepare(`DELETE FROM relations WHERE source_msg IN (${marks})`).run(...messageIds).changes
    this.db.prepare(`DELETE FROM mentions WHERE message_id IN (${marks})`).run(...messageIds)
    this.removeOrphans()
    this.changed()
    return Number(facts) + Number(rels)
  }

  /** Everything: chats, facts, the graph and the notebook. */
  forgetEverything(): void {
    this.db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM facts; DELETE FROM entities; DELETE FROM relations; DELETE FROM mentions; DELETE FROM meta;')
    this.db.exec('VACUUM')
    this.changed()
  }

  // ---------- notebook and other small values ----------

  getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined
    return r ? ((r.value as string | null) ?? null) : null
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  notebook(): string[] {
    try {
      const rules = JSON.parse(this.getMeta('notebook') ?? '[]')
      return Array.isArray(rules) ? rules.filter((r): r is string => typeof r === 'string') : []
    } catch {
      return []
    }
  }

  setNotebook(rules: string[]): void {
    this.setMeta('notebook', JSON.stringify(rules))
    this.changed()
  }

  /** Counts for settings and the memory window. */
  stats(): { facts: number; lessons: number; entities: number; relations: number; messages: number } {
    const one = (sql: string): number => Number((this.db.prepare(sql).get() as Row).n)
    return {
      facts: one("SELECT COUNT(*) n FROM facts WHERE active = 1 AND kind != 'lesson'"),
      lessons: one("SELECT COUNT(*) n FROM facts WHERE active = 1 AND kind = 'lesson'") + this.notebook().length,
      entities: one('SELECT COUNT(*) n FROM entities'),
      relations: one('SELECT COUNT(*) n FROM relations'),
      messages: one('SELECT COUNT(*) n FROM messages')
    }
  }

  /** Anything new to reflect on since the last reflection? */
  changedSince(t: number): boolean {
    const r = this.db
      .prepare('SELECT (SELECT COUNT(*) FROM facts WHERE updated_at > ?) + (SELECT COUNT(*) FROM messages WHERE feedback IS NOT NULL AND created_at > ?) n')
      .get(t, t) as Row
    return Number(r.n) > 0
  }

  feedbackCounts(): { good: number; notQuite: number } {
    const r = this.db
      .prepare("SELECT SUM(feedback = 'good') good, SUM(feedback = 'not_quite') bad FROM messages")
      .get() as Row
    return { good: Number(r.good ?? 0), notQuite: Number(r.bad ?? 0) }
  }
}
