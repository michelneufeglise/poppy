/**
 * Polly's mouth moves while she speaks: the user's own copies of a pose with the mouth closed, half
 * shut, open and wide open (cut by scripts/cut_mouth_female.py; only the mouth, pixel for pixel on the
 * pose) are shown over it. With Kokoro the mouth follows her syllables (voice:levels): the louder a
 * moment is than the moments around it, the wider the mouth; softer moments half close or close it,
 * pauses close it, and in between it's the mouth as drawn. The Mac voice has no levels, so the mouth
 * flaps at a talking pace. Only poses with frames move their mouth (her talking pose for now); her
 * blink keeps working, since the mouth frames cover nothing but the mouth.
 */

/** The shapes that have a frame; 'drawn' is the pose's own mouth (no frame shown). */
export const FRAME_SHAPES = ['closed', 'half', 'open', 'wide'] as const
export type FrameShape = (typeof FRAME_SHAPES)[number]
export type MouthFrames = Record<FrameShape, string>
/** From shut to wide: closed, half, drawn (between half and open), open, wide. */
export type MouthShape = FrameShape | 'drawn'

/**
 * Her voice is loud almost all the time (0.6–0.9), so fixed thresholds kept the mouth open. Syllables
 * show as small bumps instead: how far a moment sits above or below the ~280 ms around it picks the
 * shape. Below PAUSE it's a pause (closed). A shape holds at least MIN_HOLD steps (80 ms).
 * With a real reply's levels this gives roughly closed 15%, half 15%, drawn 20%, open 30%, wide 20%.
 */
export const PAUSE = 0.3
export const WIDE = 0.075
export const BUMP = 0.02
export const HALF = 0.015
export const DIP = 0.06
export const AROUND = 3 // steps on each side
export const MIN_HOLD = 2
/** How long to wait for levels after a sentence starts before flapping (the Mac voice has none). */
export const LEVELS_WAIT_MS = 150
/** Mac voice: a new shape every so often. */
export const FLAP_MS: [number, number] = [90, 170]

function shapeFor(level: number, d: number): MouthShape {
  if (level < PAUSE || d < -DIP) return 'closed'
  if (d < -HALF) return 'half'
  if (d > WIDE) return 'wide'
  if (d > BUMP) return 'open'
  return 'drawn'
}

/** The mouth for every step of a sentence's levels. */
export function mouthShapes(levels: number[]): MouthShape[] {
  const out: MouthShape[] = []
  let last: MouthShape = 'drawn'
  let held = 0
  for (let i = 0; i < levels.length; i++) {
    const near = levels.slice(Math.max(0, i - AROUND), i + AROUND + 1)
    let shape = shapeFor(levels[i], levels[i] - near.reduce((a, b) => a + b, 0) / near.length)
    if (shape !== last && held < MIN_HOLD) shape = last
    held = shape === last ? held + 1 : 1
    last = shape
    out.push(shape)
  }
  return out
}

/** The Mac voice's next shape: open-ish and shut-ish in turn, with some variety in each. */
export function nextFlap(last: MouthShape, rand: () => number = Math.random): MouthShape {
  const r = rand()
  if (last === 'closed' || last === 'half') return r < 0.5 ? 'open' : r < 0.75 ? 'wide' : 'drawn'
  return r < 0.5 ? 'closed' : 'half'
}

export class Mouth {
  private readonly imgs: Record<FrameShape, HTMLImageElement>
  private frames: MouthFrames | null = null
  private ready = false
  private shape: MouthShape = 'drawn'
  private speech: { shapes: MouthShape[]; stepMs: number; start: number } | null = null
  private flapping = false
  private timer = 0
  private waitTimer = 0

  constructor(parent: HTMLElement) {
    const frame = (): HTMLImageElement => {
      const img = parent.appendChild(document.createElement('img'))
      img.className = 'mouth'
      img.alt = ''
      img.draggable = false
      return img
    }
    this.imgs = { closed: frame(), half: frame(), open: frame(), wide: frame() }
  }

  /** The frames for the pose shown now, or null when it has none. Speech carries on in the new pose. */
  show(frames: MouthFrames | null): void {
    if (FRAME_SHAPES.every((s) => frames?.[s] === this.frames?.[s])) return
    this.frames = frames
    this.ready = false
    this.set('drawn')
    if (!frames) return
    // Decoded first, so a frame never flashes in half-loaded.
    for (const s of FRAME_SHAPES) this.imgs[s].src = frames[s]
    Promise.all(FRAME_SHAPES.map((s) => this.imgs[s].decode())).then(
      () => (this.ready = this.frames === frames),
      () => undefined // a frame that fails to load just means a still mouth
    )
  }

  /** A sentence starts (true) or her voice is done (false). Flaps unless levels come for it. */
  speaking(on: boolean): void {
    window.clearTimeout(this.waitTimer)
    if (!on) return this.stop()
    this.speech = null
    this.waitTimer = window.setTimeout(() => {
      if (!this.speech) this.flap()
    }, LEVELS_WAIT_MS)
  }

  /** How loud each moment of the sentence that just started is (Kokoro). */
  levels(levels: number[], stepMs: number): void {
    window.clearTimeout(this.waitTimer)
    this.flapping = false
    this.speech = { shapes: mouthShapes(levels), stepMs, start: performance.now() }
    this.run()
  }

  private flap(): void {
    this.flapping = true
    this.run()
  }

  private stop(): void {
    this.speech = null
    this.flapping = false
    window.clearTimeout(this.timer)
    this.timer = 0
    this.set('drawn')
  }

  private run(): void {
    window.clearTimeout(this.timer)
    const step = (): void => {
      if (this.speech) {
        const i = Math.floor((performance.now() - this.speech.start) / this.speech.stepMs)
        if (i >= this.speech.shapes.length) {
          // The sentence is over: the drawn mouth until the next one starts.
          this.speech = null
          this.timer = 0
          return this.set('drawn')
        }
        this.set(this.speech.shapes[Math.max(0, i)])
        this.timer = window.setTimeout(step, this.speech.stepMs / 2)
      } else if (this.flapping) {
        this.set(nextFlap(this.shape))
        this.timer = window.setTimeout(step, FLAP_MS[0] + Math.random() * (FLAP_MS[1] - FLAP_MS[0]))
      } else this.timer = 0
    }
    step()
  }

  private set(shape: MouthShape): void {
    this.shape = shape
    const show = this.ready ? shape : 'drawn'
    for (const s of FRAME_SHAPES) this.imgs[s].classList.toggle('on', show === s)
  }
}
