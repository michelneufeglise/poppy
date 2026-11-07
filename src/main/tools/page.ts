import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { lookup } from 'node:dns/promises'
import { isPrivateAddress, tidyText, webUrlProblem } from '../../shared/builtin'

const MAX_BYTES = 3_000_000
const MAX_REDIRECTS = 5
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Poppy'

/** Refuses addresses on this Mac or the local network, also when a name points there. */
async function checkHost(url: URL): Promise<void> {
  const problem = webUrlProblem(url.href)
  if (problem) throw new Error(problem)
  const addresses = await lookup(url.hostname, { all: true })
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new Error('Pages on this Mac or the local network are not read.')
}

async function readBody(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      break
    }
    chunks.push(value)
  }
  const charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1] ?? 'utf-8'
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(charset)
  } catch {
    decoder = new TextDecoder()
  }
  return decoder.decode(Buffer.concat(chunks))
}

/** Fetches a web page on this Mac and keeps its main text (Mozilla's Readability, as in Firefox's reader view). */
export async function readPage(address: string, signal: AbortSignal): Promise<{ title: string; content: string }> {
  let url = new URL(address)
  const sig = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
  for (let hop = 0; ; hop++) {
    await checkHost(url)
    const res = await fetch(url, {
      redirect: 'manual',
      signal: sig,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' }
    })
    const next = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && next) {
      if (hop >= MAX_REDIRECTS) throw new Error('too many redirects')
      url = new URL(next, url)
      continue
    }
    if (!res.ok) throw new Error(`the site answered ${res.status}`)
    const type = (res.headers.get('content-type') ?? '').toLowerCase()
    const text = await readBody(res)
    if (type.startsWith('text/plain')) return { title: url.href, content: tidyText(text) }
    if (!type.includes('html') && !type.includes('xml')) throw new Error(`this isn't a web page (${type.split(';')[0] || 'unknown type'})`)
    const { document } = parseHTML(text)
    const title = (document.querySelector('title')?.textContent ?? '').trim()
    let article: { title?: string | null; textContent?: string | null } | null = null
    try {
      article = new Readability(document as unknown as Document).parse()
    } catch {
      article = null
    }
    if (!article?.textContent?.trim()) {
      for (const el of document.querySelectorAll('script, style, noscript, nav, header, footer, svg')) el.remove()
    }
    const body = article?.textContent?.trim() ? article.textContent : (document.body?.textContent ?? '')
    return { title: article?.title?.trim() || title, content: tidyText(body) }
  }
}
