/** Rules for files attached to a chat message. Pure functions, so they can be tested. */

export type AttachmentKind = 'image' | 'text' | 'pdf'

export const MAX_FILES = 5
export const MAX_FILE_BYTES = 20 * 1024 * 1024
/** Longest side of an image sent to the model. Bigger photos are scaled down to keep replies fast. */
export const MAX_IMAGE_SIDE = 1600
/** Text taken from one file, and from all files of one message together. */
export const MAX_FILE_CHARS = 60_000
export const MAX_TOTAL_CHARS = 120_000

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
const TEXT = [
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css',
  'log', 'ini', 'cfg', 'conf', 'env', 'sql', 'sh', 'zsh', 'bash', 'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'java', 'kt', 'swift', 'go', 'rs', 'rb', 'php', 'c', 'h', 'cpp', 'hpp', 'cs', 'm', 'r', 'lua', 'pl', 'scala',
  'vue', 'svelte', 'tex', 'rst', 'srt', 'vtt'
]

/** What kind of file this is, by its extension; null when Poppy can't read it. */
export function classify(name: string): AttachmentKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (!name.includes('.')) return null
  if (IMAGE.includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (TEXT.includes(ext)) return 'text'
  return null
}

/** Text with a NUL byte in the first part is almost surely a binary file with a text-like name. */
export function looksBinary(sample: string): boolean {
  return sample.slice(0, 8000).includes('\u0000')
}

/** Cut text to a limit, saying so at the end so the model knows it's incomplete. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n[… cut off: the file is longer than ${max.toLocaleString('en')} characters]`
}

export interface ReadFile {
  name: string
  kind: AttachmentKind
  /** Text content for text and PDF files. */
  text?: string
  pages?: number
}

/**
 * The user message as the model sees it: the typed text, then each file.
 * Images themselves go along separately (Ollama's `images` field); here they're only named.
 */
export function composeMessage(typed: string, files: ReadFile[]): string {
  const parts = [typed.trim() || 'Have a look at the attached file.']
  let budget = MAX_TOTAL_CHARS
  for (const f of files) {
    if (f.kind === 'image') {
      parts.push(`[Attached image: ${f.name}]`)
      continue
    }
    const label = f.kind === 'pdf' ? `PDF, ${f.pages ?? '?'} pages` : 'file'
    const body = clip(f.text?.trim() || '(empty)', Math.max(0, Math.min(MAX_FILE_CHARS, budget)))
    budget -= body.length
    parts.push(`[Attached ${label}: ${f.name}]\n"""\n${body}\n"""`)
  }
  return parts.join('\n\n')
}

/**
 * Context size to ask Ollama for, so long attachments aren't silently cut off.
 * Undefined for normal chats (the model's own default); otherwise a few fixed steps, so it rarely changes.
 */
export function contextSize(totalChars: number, images: number): number | undefined {
  const tokens = Math.ceil(totalChars / 3.5) + images * 1200 + 1500
  if (tokens <= 4096) return undefined
  for (const step of [8192, 16384, 32768]) if (tokens <= step) return step
  return 32768
}
