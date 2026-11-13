/**
 * Walking: now and then, with the chat closed and her awake, she hops a few small steps left or right
 * along the bottom of the screen, never more than WALK_RANGE from where the user put her, and goes
 * back home now and then (and before the chat opens). Main moves the window; she hops each step.
 */
export const WALK_RANGE = 250 // (main's WALK_RANGE too)
export const WALK_EVERY: [number, number] = [45_000, 90_000]
/** Her first walk comes sooner, so you see that she can. */
export const FIRST_WALK_AFTER = 20_000
export const STEP_PX = 34
export const STEP_MS = 460
export const STEP_PAUSE_MS = 110
/** A quick hop home (before the chat opens). */
export const HOME_HOP_MS = 450

/**
 * The steps (px each) of her next walk from `offset` (px from home): home again when she's out (more
 * often the further out), else to a new spot at least 60 px away. Steps are about STEP_PX.
 */
export function planWalk(offset: number, rand: () => number = Math.random): number[] {
  const goHome = offset !== 0 && rand() < 0.35 + (Math.abs(offset) / WALK_RANGE) * 0.4
  let target = 0
  if (!goHome) {
    for (let i = 0; i < 8; i++) {
      target = Math.round((rand() * 2 - 1) * WALK_RANGE)
      if (Math.abs(target - offset) >= 60) break
    }
    if (Math.abs(target - offset) < 60) target = offset > 0 ? offset - 90 : offset + 90
  }
  const distance = target - offset
  const n = Math.max(1, Math.round(Math.abs(distance) / STEP_PX))
  return Array.from({ length: n }, () => distance / n)
}
