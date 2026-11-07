/**
 * Polly blinks: the user's own half-closed and closed-eye frames of a pose (cut by
 * scripts/cut_blink_female.py, pixel for pixel on top of that pose) are shown over it for a moment.
 * Only poses with frames blink; the motion layers keep moving underneath, since the frames sit in
 * the same layer as the drawings.
 */
export interface BlinkFrames {
  half?: string
  closed: string
}

export type Eyes = 'half' | 'closed' | 'open'
/** One blink: which frame shows, for how many ms. Always ends with the eyes open. */
export type Step = [Eyes, number]

export const BLINK_EVERY: [number, number] = [2000, 6000] // ms between blinks, at random
export const DOUBLE_CHANCE = 0.2
const SETTLE_MS = 400 // no blink right after a pose change, while the poses crossfade

export function blinkSteps(hasHalf: boolean, double: boolean): Step[] {
  const one: Step[] = hasHalf
    ? [['half', 45], ['closed', 80], ['half', 55]]
    : [['closed', 110]]
  return double ? [...one, ['open', 110], ...one, ['open', 0]] : [...one, ['open', 0]]
}

export const nextBlinkDelay = (rand: () => number = Math.random): number =>
  BLINK_EVERY[0] + rand() * (BLINK_EVERY[1] - BLINK_EVERY[0])

export class Blinker {
  private readonly half: HTMLImageElement
  private readonly closed: HTMLImageElement
  private frames: BlinkFrames | null = null
  private ready = false
  private since = 0
  private wait = 0
  private stepTimer = 0

  constructor(parent: HTMLElement) {
    const frame = (): HTMLImageElement => {
      const img = parent.appendChild(document.createElement('img'))
      img.className = 'blink'
      img.alt = ''
      img.draggable = false
      return img
    }
    this.half = frame()
    this.closed = frame()
    this.schedule()
  }

  /** The frames for the pose shown now, or null when it has none (or it's Poppy). Opens the eyes at once. */
  show(frames: BlinkFrames | null): void {
    window.clearTimeout(this.stepTimer)
    this.eyes('open')
    this.since = performance.now()
    this.schedule() // a blink cut off by the pose change starts over
    if (frames?.closed === this.frames?.closed && frames?.half === this.frames?.half) return
    this.frames = frames
    this.ready = false
    if (!frames) return
    // Decoded before the first blink, so a frame never flashes in half-loaded.
    this.closed.src = frames.closed
    if (frames.half) this.half.src = frames.half
    const loads = [this.closed.decode(), frames.half ? this.half.decode() : Promise.resolve()]
    Promise.all(loads).then(
      () => (this.ready = this.frames === frames),
      () => undefined // a frame that fails to load just means no blinking in that pose
    )
  }

  private eyes(e: Eyes): void {
    this.half.classList.toggle('on', e === 'half')
    this.closed.classList.toggle('on', e === 'closed')
  }

  private schedule(): void {
    window.clearTimeout(this.wait)
    this.wait = window.setTimeout(() => this.blink(), nextBlinkDelay())
  }

  private blink(): void {
    const frames = this.frames
    if (!frames || !this.ready || performance.now() - this.since < SETTLE_MS) return this.schedule()
    const steps = blinkSteps(Boolean(frames.half), Math.random() < DOUBLE_CHANCE)
    const run = (i: number): void => {
      const [e, ms] = steps[i]
      this.eyes(e)
      if (i + 1 < steps.length) this.stepTimer = window.setTimeout(() => run(i + 1), ms)
      else this.schedule()
    }
    run(0)
  }
}
