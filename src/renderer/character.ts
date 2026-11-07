import type { Character } from '../shared/types'

/** The header from the user's chat picture; female Poppy has her own (cut by scripts/cut_sheet_female.py). */
const HEADERS: Record<Character, string> = {
  male: new URL('../../assets/chat/header.png', import.meta.url).href,
  female: new URL('../../assets/female/chat/header.png', import.meta.url).href
}

/** Shows the chosen Poppy in this window's header, now and whenever the setting changes. */
export function followCharacterHeader(): void {
  const img = document.querySelector<HTMLImageElement>('.art-header img')
  if (!img) return
  const show = (c: Character): void => {
    if (img.src !== HEADERS[c]) img.src = HEADERS[c]
  }
  void window.poppy.getSettings().then((s) => show(s.character))
  window.poppy.onSettingsChanged((s) => show(s.character))
}
