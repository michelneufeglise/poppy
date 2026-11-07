import type { Character } from './types'

/**
 * The buddy's name: the male character is Poppy, the female one is Polly (user's choice).
 * The app itself stays "Poppy" (app name, Quit Poppy, window titles, data folder, repository).
 */
export interface Buddy {
  name: 'Poppy' | 'Polly'
  he: string
  him: string
  his: string
  himself: string
}

const POPPY: Buddy = { name: 'Poppy', he: 'he', him: 'him', his: 'his', himself: 'himself' }
const POLLY: Buddy = { name: 'Polly', he: 'she', him: 'her', his: 'her', himself: 'herself' }

export const buddyOf = (c: Character | undefined): Buddy => (c === 'female' ? POLLY : POPPY)

/**
 * Fills {name}, {he}, {him}, {his} and {himself} in a text written for either buddy
 * ({Name}, {He}, … for the start of a sentence). Other braces (like JSON examples) stay as they are.
 */
export function fill(template: string, b: Buddy): string {
  return template.replace(/\{(name|he|him|his|himself|He|His)\}/g, (_m, key: string) => {
    if (key === 'He') return b.he[0].toUpperCase() + b.he.slice(1)
    if (key === 'His') return b.his[0].toUpperCase() + b.his.slice(1)
    return b[key as keyof Buddy]
  })
}
