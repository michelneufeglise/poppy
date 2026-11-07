import { nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  classify,
  clip,
  looksBinary,
  MAX_FILE_BYTES,
  MAX_FILE_CHARS,
  MAX_FILES,
  MAX_IMAGE_SIDE,
  type ReadFile
} from '../shared/attachments'
import type { AttachResult, AttachmentInfo } from '../shared/types'

/**
 * Files the user picked or dropped, by id. Only the main process reads files, and only these:
 * the page sends ids, never paths, when it sends a message.
 */
const registry = new Map<string, { path: string; info: AttachmentInfo }>()

/** Check files the user chose and remember the good ones. */
export async function addFiles(paths: string[], alreadyAttached: number): Promise<AttachResult> {
  const result: AttachResult = { added: [], refused: [] }
  for (const path of paths) {
    const name = basename(path)
    if (alreadyAttached + result.added.length >= MAX_FILES) {
      result.refused.push({ name, reason: `I can take ${MAX_FILES} files at a time.` })
      continue
    }
    const kind = classify(name)
    if (!kind) {
      result.refused.push({ name, reason: "I can't read that kind of file yet." })
      continue
    }
    try {
      const s = await stat(path)
      if (!s.isFile()) throw new Error('not a file')
      if (s.size > MAX_FILE_BYTES) {
        result.refused.push({ name, reason: 'That file is bigger than 20 MB.' })
        continue
      }
      const info: AttachmentInfo = { id: randomUUID(), name, kind, size: s.size }
      if (kind === 'image') {
        const img = nativeImage.createFromPath(path)
        if (img.isEmpty()) {
          result.refused.push({ name, reason: "I couldn't open that image." })
          continue
        }
        info.thumb = img.resize({ height: 96, quality: 'good' }).toDataURL()
      }
      registry.set(info.id, { path, info })
      result.added.push(info)
    } catch {
      result.refused.push({ name, reason: "I couldn't open that file." })
    }
  }
  return result
}

export function forget(ids: string[]): void {
  for (const id of ids) registry.delete(id)
}

export interface LoadedFiles {
  files: ReadFile[]
  /** Base64 JPEGs for the model, in order. */
  images: string[]
}

/** Read the attached files for one message. Unknown ids are skipped. */
export async function loadFiles(ids: string[]): Promise<LoadedFiles> {
  const out: LoadedFiles = { files: [], images: [] }
  for (const id of ids) {
    const entry = registry.get(id)
    if (!entry) continue
    const { path, info } = entry
    if (info.kind === 'image') {
      let img = nativeImage.createFromPath(path)
      const { width, height } = img.getSize()
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height))
      if (scale < 1) img = img.resize({ width: Math.round(width * scale), quality: 'good' })
      out.images.push(img.toJPEG(88).toString('base64'))
      out.files.push({ name: info.name, kind: 'image' })
    } else if (info.kind === 'pdf') {
      const { text, pages } = await pdfText(path)
      out.files.push({ name: info.name, kind: 'pdf', text, pages })
    } else {
      const text = await readFile(path, 'utf8')
      out.files.push({
        name: info.name,
        kind: 'text',
        text: looksBinary(text) ? '(this looks like a binary file, so I left it out)' : clip(text, MAX_FILE_CHARS)
      })
    }
  }
  return out
}

/** Text of a PDF, page by page, with pdf.js (no extra installs needed). */
async function pdfText(path: string): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await readFile(path))
  const task = pdfjs.getDocument({ data, useSystemFonts: true })
  const doc = await task.promise
  const pages: string[] = []
  let length = 0
  for (let i = 1; i <= doc.numPages && length < MAX_FILE_CHARS; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .trim()
    pages.push(text)
    length += text.length
  }
  const pageCount = doc.numPages
  await task.destroy()
  const text = pages.join('\n\n').trim()
  return { text: text || '(no text found: this PDF may only contain scanned images)', pages: pageCount }
}
