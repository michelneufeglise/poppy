import type { PoppyState } from '../shared/types'

/**
 * While the chat is open and nothing happens, Poppy (or Polly) doesn't hold the listening pose the
 * whole time: now and then she switches to another calm waiting pose, and back. All of them are the
 * user's own drawings (and blink, for Polly); this only picks which one shows.
 */
export const WAITING_POSES: readonly PoppyState[] = ['curious', 'hopeful', 'wonder', 'dreamy', 'idle', 'playful', 'thinking']
/** After a longer wait these come up too. */
export const BORED_POSES: readonly PoppyState[] = ['bored', 'sighing', 'lazy']
export const FIRST_CHANGE_MS = 8000
export const CHANGE_EVERY: [number, number] = [6000, 12000]
export const BORED_AFTER_MS = 60_000
/** From another pose, how often she goes back to listening first. */
export const BACK_TO_LISTENING = 0.4

const ALL = new Set<PoppyState>(['listening', ...WAITING_POSES, ...BORED_POSES])
/** Poses the waiting may change: listening and its own picks (never a mood that is being held). */
export const isWaitingPose = (s: PoppyState): boolean => ALL.has(s)

export function nextWaitingPose(current: PoppyState, waitedMs: number, rand: () => number = Math.random): PoppyState {
  if (current !== 'listening' && rand() < BACK_TO_LISTENING) return 'listening'
  const pool = [...WAITING_POSES, ...(waitedMs >= BORED_AFTER_MS ? BORED_POSES : [])].filter((s) => s !== current)
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))]
}

export const nextWaitingDelay = (rand: () => number = Math.random): number =>
  CHANGE_EVERY[0] + rand() * (CHANGE_EVERY[1] - CHANGE_EVERY[0])
