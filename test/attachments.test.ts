import { describe, expect, it } from 'vitest'
import {
  classify,
  clip,
  composeMessage,
  contextSize,
  looksBinary,
  MAX_FILE_CHARS,
  MAX_TOTAL_CHARS
} from '../src/shared/attachments'

describe('classify', () => {
  it('knows images, PDFs and text files by extension', () => {
    expect(classify('Photo.JPG')).toBe('image')
    expect(classify('report.pdf')).toBe('pdf')
    expect(classify('notes.md')).toBe('text')
    expect(classify('main.ts')).toBe('text')
  })

  it("refuses what it can't read", () => {
    expect(classify('movie.mov')).toBeNull()
    expect(classify('archive.zip')).toBeNull()
    expect(classify('Makefile')).toBeNull()
  })
})

describe('reading', () => {
  it('spots binary files', () => {
    expect(looksBinary('hello\u0000world')).toBe(true)
    expect(looksBinary('just text')).toBe(false)
  })

  it('clips long text and says so', () => {
    const out = clip('x'.repeat(20), 10)
    expect(out.startsWith('x'.repeat(10))).toBe(true)
    expect(out).toContain('cut off')
    expect(clip('short', 10)).toBe('short')
  })
})

describe('composeMessage', () => {
  it('puts the typed text first, then each file', () => {
    const msg = composeMessage('What is this?', [
      { name: 'cat.png', kind: 'image' },
      { name: 'notes.txt', kind: 'text', text: 'buy milk' },
      { name: 'doc.pdf', kind: 'pdf', text: 'page one', pages: 1 }
    ])
    expect(msg.split('\n\n')[0]).toBe('What is this?')
    expect(msg).toContain('[Attached image: cat.png]')
    expect(msg).toContain('[Attached file: notes.txt]\n"""\nbuy milk\n"""')
    expect(msg).toContain('[Attached PDF, 1 pages: doc.pdf]')
  })

  it('asks Poppy to look when nothing was typed', () => {
    expect(composeMessage('  ', [{ name: 'a.png', kind: 'image' }])).toMatch(/^Have a look/)
  })

  it('keeps all files together under the total limit', () => {
    const big = 'y'.repeat(MAX_FILE_CHARS + 500)
    const files = [1, 2, 3].map((i) => ({ name: `f${i}.txt`, kind: 'text' as const, text: big }))
    expect(composeMessage('hi', files).length).toBeLessThan(MAX_TOTAL_CHARS + 2000)
  })
})

describe('contextSize', () => {
  it('leaves normal chats alone and grows in steps for long files', () => {
    expect(contextSize(2000, 0)).toBeUndefined()
    expect(contextSize(20_000, 0)).toBe(8192)
    expect(contextSize(40_000, 1)).toBe(16384)
    expect(contextSize(500_000, 0)).toBe(32768)
  })
})
