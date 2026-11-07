import { buddyOf, fill, type Buddy } from '../shared/buddy'
import type { Character } from '../shared/types'

/** The header from the user's chat picture; female Polly has her own (cut by scripts/cut_sheet_female.py). */
const HEADERS: Record<Character, string> = {
  male: new URL('../../assets/chat/header.png', import.meta.url).href,
  female: new URL('../../assets/female/chat/header.png', import.meta.url).href
}

let current: Buddy = buddyOf('male')
/** Poppy or Polly, whoever is picked right now. */
export const me = (): Buddy => current

/**
 * Follows the chosen character in this window: the header picture, and every element with a
 * data-buddy template ("{name}'s notebook") gets its words filled in. `onChange` re-renders the rest.
 */
export function followCharacter(onChange?: (b: Buddy) => void): void {
  const img = document.querySelector<HTMLImageElement>('.art-header img')
  let shown: Character | null = null
  const show = (c: Character): void => {
    if (c === shown) return
    shown = c
    current = buddyOf(c)
    if (img) {
      img.src = HEADERS[c]
      img.alt = current.name
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-buddy]')) el.textContent = fill(el.dataset.buddy ?? '', current)
    onChange?.(current)
  }
  void window.poppy.getSettings().then((s) => show(s.character))
  window.poppy.onSettingsChanged((s) => show(s.character))
}
