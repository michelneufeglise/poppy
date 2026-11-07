import type { MemorySnapshot, MemoryStats } from '../shared/types'
import { followCharacterHeader } from './character'

const api = window.poppy
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const closeIcon = new URL('../../assets/chat/close.png', import.meta.url).href

const KIND_LABEL: Record<string, string> = { about: 'you', preference: 'likes', project: 'project', other: '' }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

/** The pencil × from the picture: deletes one memory. */
function del(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'del')
  b.type = 'button'
  b.title = label
  b.setAttribute('aria-label', label)
  b.innerHTML = `<img src="${closeIcon}" alt="" draggable="false">`
  b.addEventListener('click', onClick)
  return b
}

function list(id: string, items: HTMLElement[], empty: string): void {
  $(id).replaceChildren(...(items.length ? items : [el('li', 'empty', empty)]))
}

function summary(st: MemoryStats): string {
  let text = `Poppy knows ${st.facts} facts about you, ${st.entities} people and things, and ${st.lessons} lessons, from ${st.messages} messages.`
  if (st.embeddings === 'missing') text += ' The memory search model is not installed, so Poppy searches by keywords.'
  if (!st.learning) text += ' Learning is paused.'
  return text
}

function render(m: MemorySnapshot | null): void {
  if (!m) {
    $('summary').textContent = "Poppy's memory couldn't start."
    return
  }
  $('summary').textContent = summary(m.stats)
  $<HTMLInputElement>('memory-on').checked = m.stats.learning

  list(
    'facts',
    m.facts.map((f) => {
      const li = el('li')
      li.append(el('span', 'text', f.text))
      if (KIND_LABEL[f.kind]) li.append(el('span', 'kind', KIND_LABEL[f.kind]))
      li.append(del('Forget this', () => api.deleteMemory('fact', f.id)))
      return li
    }),
    'Nothing yet. Tell Poppy about yourself and he will remember.'
  )
  list(
    'notebook',
    m.notebook.map((rule, i) => {
      const li = el('li')
      li.append(el('span', 'text', rule), del('Remove this rule', () => api.deleteMemory('rule', i)))
      return li
    }),
    'Empty for now. Poppy writes it when he tidies up his memory.'
  )
  list(
    'lessons',
    m.lessons.map((l) => {
      const li = el('li')
      li.append(el('span', 'text', l.text), del('Forget this lesson', () => api.deleteMemory('fact', l.id)))
      return li
    }),
    'No lessons yet. Use "good" or "not quite" under a reply, or just correct Poppy.'
  )

  const graph = m.entities.map((e) => {
    const box = el('div', 'entity')
    const head = el('div', 'entity-head')
    head.append(el('span', 'name', e.name), el('span', 'kind', e.type))
    if (e.name !== 'you') head.append(del(`Forget ${e.name}`, () => api.deleteMemory('entity', e.id)))
    const links = el('div', 'links')
    for (const l of e.links) {
      const row = el('div', 'link')
      row.append(el('span', 'text', l.text), del('Forget this link', () => api.deleteMemory('relation', l.id)))
      links.append(row)
    }
    box.append(head, links)
    return box
  })
  $('graph').replaceChildren(...(graph.length ? graph : [el('p', 'hint', 'Nobody and nothing yet.')]))
}

async function refresh(): Promise<void> {
  render(await api.memorySnapshot())
}

$<HTMLInputElement>('memory-on').addEventListener('change', (e) =>
  api.setSettings({ memoryEnabled: (e.target as HTMLInputElement).checked })
)
$('reflect').addEventListener('click', async () => {
  const note = $('note')
  note.textContent = 'Tidying up…'
  try {
    const r = (await api.reflectNow()) as { merged: number; faded: number; entities: number; rules: number } | null
    note.textContent = r
      ? `Done: ${r.merged} duplicates merged, ${r.faded} old facts let go, ${r.entities} names joined, ${r.rules} notebook rules.`
      : ''
  } catch {
    note.textContent = "Couldn't tidy up right now. Is Ollama running?"
  }
  void refresh()
})
$('forget-all').addEventListener('click', async () => {
  if (await api.forgetEverything()) $('note').textContent = 'Poppy forgot everything.'
  void refresh()
})

let timer = 0
api.onMemoryChanged(() => {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void refresh(), 200)
})
api.onSettingsChanged(() => void refresh())
void refresh()

// No Mac title bar: the drawn × and Esc close the window.
$('close').addEventListener('click', () => api.closeMemory())
$('minimize').addEventListener('click', () => api.closeMemory())
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.closeMemory()
})

followCharacterHeader()
