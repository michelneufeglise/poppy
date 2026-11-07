/*
 * Poppy's motion. Only ever moves the whole drawing (the drawings themselves never change):
 * squash and stretch, a wind-up before a hop, a squish when the drawing changes, a little variety
 * in every cycle, small fidgets while idle or listening, and a lean + wobble while dragged.
 *
 * Three layers, outside in, each with its own transform so they add up instead of fighting:
 *   lean  – spring physics while she's dragged (set per frame),
 *   react – one-shot moves: pose change, poke, fidgets (Web Animations),
 *   loop  – the state's own repeating move, one cycle at a time (Web Animations).
 */
import type { PoppyState } from '../shared/types'

export interface Pose {
  x?: number
  y?: number
  /** degrees */
  r?: number
  sx?: number
  sy?: number
}
/** [offset 0–1, pose, easing to the next frame] */
export type Frame = [number, Pose, string?]
export interface Move {
  ms: number
  frames: Frame[]
  /** How much size and speed differ per cycle (0.3 = ±15% size, ±10% speed). */
  vary?: number
}

const T = ({ x = 0, y = 0, r = 0, sx = 1, sy = 1 }: Pose = {}): string =>
  `translate(${x}px, ${y}px) rotate(${r}deg) scale(${sx}, ${sy})`
const REST = T()
const OUT = 'cubic-bezier(0.2, 0.7, 0.3, 1)'
const IN = 'cubic-bezier(0.6, 0, 0.8, 0.4)'
const IN_OUT = 'cubic-bezier(0.45, 0, 0.55, 1)'
const BACK = 'cubic-bezier(0.34, 1.5, 0.64, 1)' // overshoots a little, then settles

const hop = (height: number, ms: number): Move => ({
  ms,
  frames: [
    [0, {}, OUT],
    [0.14, { sx: 1.07, sy: 0.91 }, OUT], // wind-up: crouch
    [0.3, { y: -height * 0.85, sx: 0.94, sy: 1.08 }, OUT], // take-off: stretch
    [0.47, { y: -height }, IN], // top
    [0.66, { y: 0, sx: 0.96, sy: 1.05 }, OUT], // touch down
    [0.77, { sx: 1.08, sy: 0.92 }, OUT], // land: squash
    [0.9, { sx: 0.985, sy: 1.015 }, IN_OUT],
    [1, {}]
  ],
  vary: 0.25
})

export const LOOPS = {
  breathe: { ms: 3400, frames: [[0, {}, IN_OUT], [0.42, { y: -2, sx: 0.992, sy: 1.016 }, IN_OUT], [1, {}]], vary: 0.3 },
  listen: {
    ms: 3000,
    frames: [[0, {}, IN_OUT], [0.25, { r: -2 }, IN_OUT], [0.5, { y: -2 }, IN_OUT], [0.75, { r: 2, y: -1 }, IN_OUT], [1, {}]],
    vary: 0.35
  },
  think: {
    ms: 3800,
    frames: [[0, {}, BACK], [0.25, { r: -3, y: -1 }, IN_OUT], [0.55, { r: -3.4, y: -2 }, IN_OUT], [0.8, { r: 0.6 }, IN_OUT], [1, {}]],
    vary: 0.3
  },
  talk: {
    ms: 1700,
    frames: [
      [0, {}, OUT],
      [0.1, { sx: 1.02, sy: 0.98 }, IN_OUT],
      [0.24, { y: -2, sx: 0.99, sy: 1.012, r: -0.6 }, IN_OUT],
      [0.36, { sx: 1.025, sy: 0.975 }, IN_OUT],
      [0.52, { y: -1, r: 0.5 }, IN_OUT],
      [0.6, { sx: 1.012, sy: 0.988 }, IN_OUT],
      [0.78, { y: -3, sx: 0.985, sy: 1.02, r: 0.8 }, IN_OUT],
      [0.88, { sx: 1.03, sy: 0.97 }, IN_OUT],
      [1, {}]
    ],
    vary: 0.4
  },
  hop: hop(24, 900),
  giggle: { ...hop(9, 480), vary: 0.5 },
  ready: { ms: 950, frames: [[0, {}, IN_OUT], [0.5, { y: 3, sx: 1.03, sy: 0.97 }, BACK], [1, {}]], vary: 0.2 },
  tremble: {
    ms: 340,
    frames: [[0, {}, 'linear'], [0.25, { x: -1.6, r: -0.4 }, 'linear'], [0.5, { x: 1.2 }, 'linear'], [0.75, { x: -0.8, r: 0.3 }, 'linear'], [1, {}]],
    vary: 0.5
  },
  sad: {
    ms: 4800,
    frames: [[0, {}, IN_OUT], [0.4, { y: 3, sx: 1.012, sy: 0.972 }, IN_OUT], [0.62, { y: 3.5, sx: 1.014, sy: 0.968 }, IN_OUT], [1, {}]],
    vary: 0.25
  },
  wave: {
    ms: 1150,
    frames: [[0, {}, OUT], [0.2, { r: -4.5 }, IN_OUT], [0.46, { r: 4.5, y: -3 }, IN_OUT], [0.7, { r: -3 }, IN_OUT], [0.86, { r: 1 }, IN_OUT], [1, {}]],
    vary: 0.25
  },
  tilt: {
    ms: 3400,
    frames: [[0, {}, BACK], [0.22, { r: 5, y: -1 }, IN_OUT], [0.62, { r: 5.6, y: -2 }, IN_OUT], [0.84, { r: -1 }, IN_OUT], [1, {}]],
    vary: 0.3
  },
  sleep: {
    ms: 5200,
    frames: [[0, {}, IN_OUT], [0.55, { y: -1, sx: 1.028, sy: 1.034 }, IN], [0.8, {}, 'linear'], [1, {}]],
    vary: 0.15
  }
} satisfies Record<string, Move>
export type LoopName = keyof typeof LOOPS

/** One-shot moves that play once when a state starts, before its loop. */
export const INTROS = {
  jump: {
    ms: 1100,
    frames: [
      [0, {}, OUT],
      [0.1, { sx: 1.1, sy: 0.88 }, OUT],
      [0.28, { y: -34, sx: 0.9, sy: 1.12 }, OUT],
      [0.42, { y: -38 }, IN],
      [0.56, { y: 0, sx: 0.95, sy: 1.06 }, OUT],
      [0.64, { sx: 1.1, sy: 0.9 }, OUT],
      [0.7, { x: 3 }, 'linear'],
      [0.76, { x: -3 }, 'linear'],
      [0.82, { x: 2 }, 'linear'],
      [0.88, { x: -1 }, IN_OUT],
      [1, {}]
    ]
  },
  slump: {
    ms: 1300,
    frames: [[0, {}, OUT], [0.25, { y: -3, sx: 0.98, sy: 1.03 }, IN], [0.6, { y: 4, sx: 1.03, sy: 0.95 }, BACK], [1, {}]]
  },
  sway: { ms: 900, frames: [[0, {}, OUT], [0.3, { r: -3, x: -2 }, IN_OUT], [0.7, { r: 2, x: 1 }, IN_OUT], [1, {}]] }
} satisfies Record<string, Move>

/** Little moves in between, while she's idle or listening. */
export const FIDGETS: Move[] = [
  { ms: 1700, frames: [[0, {}, BACK], [0.25, { r: -2.2, x: -2 }, IN_OUT], [0.7, { r: -2, x: -2 }, IN_OUT], [1, {}]] }, // shift weight
  {
    ms: 2600,
    frames: [[0, {}, BACK], [0.15, { r: 3 }, IN_OUT], [0.42, { r: 3.2 }, BACK], [0.55, { r: -3 }, IN_OUT], [0.82, { r: -3.2 }, IN_OUT], [1, {}]]
  }, // look around
  {
    ms: 1600,
    frames: [[0, {}, OUT], [0.12, { sx: 1.04, sy: 0.95 }, OUT], [0.4, { y: -3, sx: 0.96, sy: 1.06 }, IN_OUT], [0.6, { y: -3, sx: 0.965, sy: 1.055 }, BACK], [1, {}]]
  }, // stretch
  hop(9, 600), // small bounce
  { ms: 700, frames: [[0, {}, IN_OUT], [0.2, { r: 2 }, IN_OUT], [0.4, { r: -2 }, IN_OUT], [0.6, { r: 1.5 }, IN_OUT], [0.8, { r: -1 }, IN_OUT], [1, {}]] } // wiggle
]

export interface StateMove {
  loop: LoopName
  intro?: keyof typeof INTROS
  /** Size of the squish when this drawing comes in (1 = normal, 0 = none). */
  pop?: number
  /** Fidgets now and then. */
  fidget?: boolean
}

/** Which move each state uses. Unlisted states breathe. */
export const STATE_MOVES: Partial<Record<PoppyState, StateMove>> = {
  idle: { loop: 'breathe', fidget: true },
  listening: { loop: 'listen', fidget: true },
  focused: { loop: 'breathe' },
  thinking: { loop: 'think' },
  busy: { loop: 'think' },
  talking: { loop: 'talk' },
  happy: { loop: 'hop', pop: 1.4 },
  excited: { loop: 'hop', pop: 1.4 },
  cheerful: { loop: 'hop', pop: 1.2 },
  clapping: { loop: 'hop', pop: 1.2 },
  playful: { loop: 'hop', pop: 1.2 },
  laughing: { loop: 'giggle', pop: 1.3 },
  surprised: { intro: 'jump', loop: 'breathe', pop: 0 },
  shocked: { intro: 'jump', loop: 'tremble', pop: 0 },
  spooked: { intro: 'jump', loop: 'tremble', pop: 0 },
  scared: { loop: 'tremble' },
  nervous: { loop: 'tremble' },
  anxious: { loop: 'tremble' },
  frustrated: { loop: 'tremble' },
  sad: { intro: 'slump', loop: 'sad', pop: 0.5 },
  crying: { intro: 'slump', loop: 'sad', pop: 0.5 },
  sighing: { intro: 'slump', loop: 'sad', pop: 0.5 },
  tired: { loop: 'sad', pop: 0.5 },
  sick: { loop: 'sad', pop: 0.5 },
  bored: { loop: 'sad', pop: 0.5 },
  'sad-hello': { loop: 'wave', pop: 0.6 },
  hello: { loop: 'wave', pop: 1.2 },
  bye: { loop: 'wave' },
  curious: { loop: 'tilt' },
  confused: { intro: 'sway', loop: 'tilt' },
  wonder: { loop: 'tilt' },
  dreamy: { loop: 'tilt' },
  doubtful: { loop: 'tilt' },
  hopeful: { loop: 'tilt' },
  shy: { loop: 'tilt', pop: 0.6 },
  determined: { loop: 'ready' },
  angry: { loop: 'ready', pop: 1.3 },
  sneaky: { loop: 'ready' },
  sleeping: { loop: 'sleep', pop: 0.4 },
  chilling: { loop: 'sleep' },
  cuddly: { loop: 'sleep' },
  lazy: { loop: 'sleep' }
}
const DEFAULT_MOVE: StateMove = { loop: 'breathe' }
export const moveFor = (s: PoppyState): StateMove => STATE_MOVES[s] ?? DEFAULT_MOVE

const mix = (a: number, b: number, t: number): number => a + (b - a) * t
/** A pose made bigger or smaller (1 = as written). */
export const scalePose = (p: Pose, amp: number): Required<Pose> => ({
  x: (p.x ?? 0) * amp,
  y: (p.y ?? 0) * amp,
  r: (p.r ?? 0) * amp,
  sx: mix(1, p.sx ?? 1, amp),
  sy: mix(1, p.sy ?? 1, amp)
})
export const keyframes = (move: Move, amp: number): Keyframe[] =>
  move.frames.map(([offset, pose, easing]) => ({ offset, transform: T(scalePose(pose, amp)), easing: easing ?? 'linear' }))
/** The shadow shrinks and fades while she's in the air. */
export const shadowFrames = (move: Move, amp: number): Keyframe[] =>
  move.frames.map(([offset, pose, easing]) => {
    const up = Math.max(0, -(pose.y ?? 0) * amp)
    return { offset, transform: `scaleX(${(1 - up / 60).toFixed(3)})`, opacity: Number((1 - up / 50).toFixed(3)), easing: easing ?? 'linear' }
  })
const rand = (a: number, b: number): number => a + Math.random() * (b - a)

export interface MotionLayers {
  lean: HTMLElement
  react: HTMLElement
  loop: HTMLElement
  shadow?: HTMLElement
}

export class Motion {
  private state: PoppyState | '' = ''
  private token = 0
  private loopAnim: Animation | null = null
  private shadowAnim: Animation | null = null
  private reactAnim: Animation | null = null
  private nextFidget = 0
  private dragging = false
  private readonly calm: boolean
  private lean = { a: 0, v: 0, target: 0, squash: 0, sv: 0, squashTarget: 0, raf: 0, last: 0, lastMove: 0 }

  constructor(private readonly els: MotionLayers) {
    // "Reduce motion" in macOS: half the size, no intros or fidgets.
    this.calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const el of [els.lean, els.react, els.loop]) el.style.transformOrigin = '50% 100%'
  }

  private get amp(): number {
    return this.calm ? 0.45 : 1
  }

  /** Switch to a state's move. Swap the drawing itself right away; the squish hides the swap. */
  setState(name: PoppyState): void {
    if (name === this.state) return
    const first = !this.state
    this.state = name
    const move = moveFor(name)
    const token = ++this.token
    // Ease the old loop back to rest instead of jumping.
    const from = getComputedStyle(this.els.loop).transform
    this.loopAnim?.cancel()
    this.shadowAnim?.cancel()
    const settle = this.els.loop.animate([{ transform: from === 'none' ? REST : from }, { transform: REST }], { duration: 170, easing: OUT })
    if (!first && (move.pop ?? 1) > 0) this.pop(move.pop ?? 1)
    this.nextFidget = performance.now() + rand(4000, 9000)
    settle.onfinish = () => {
      if (token !== this.token) return
      if (move.intro && !this.calm) this.play(INTROS[move.intro], 1, () => this.cycle(token))
      else this.cycle(token)
    }
  }

  /** A squish and spring back, when the drawing changes. */
  private pop(strength: number): void {
    const s = 0.065 * strength * this.amp
    this.react(
      [
        { offset: 0, transform: REST, easing: OUT },
        { offset: 0.22, transform: T({ sx: 1 + s, sy: 1 - s * 1.2 }), easing: OUT },
        { offset: 0.5, transform: T({ y: -3 * strength * this.amp, sx: 1 - s * 0.6, sy: 1 + s * 0.7 }), easing: IN_OUT },
        { offset: 0.75, transform: T({ sx: 1 + s * 0.2, sy: 1 - s * 0.2 }), easing: IN_OUT },
        { offset: 1, transform: REST }
      ],
      430
    )
  }

  /** A click: a quick squish. */
  poke(): void {
    const s = 0.09 * this.amp
    this.react(
      [
        { offset: 0, transform: REST, easing: OUT },
        { offset: 0.18, transform: T({ sx: 1 + s, sy: 1 - s }), easing: OUT },
        { offset: 0.45, transform: T({ y: -5 * this.amp, sx: 1 - s * 0.5, sy: 1 + s * 0.6 }), easing: IN_OUT },
        { offset: 0.7, transform: T({ sx: 1 + s * 0.25, sy: 1 - s * 0.25 }), easing: IN_OUT },
        { offset: 1, transform: REST }
      ],
      480
    )
  }

  private react(frames: Keyframe[], ms: number): void {
    this.reactAnim?.cancel()
    this.reactAnim = this.els.react.animate(frames, { duration: ms })
  }

  private play(move: Move, amp: number, then: () => void): void {
    this.loopAnim = this.els.loop.animate(keyframes(move, amp * this.amp), { duration: move.ms })
    if (this.els.shadow) this.shadowAnim = this.els.shadow.animate(shadowFrames(move, amp * this.amp), { duration: move.ms })
    this.loopAnim.onfinish = then
  }

  /** One cycle of the state's loop, a little different in speed and size each time, then the next. */
  private cycle(token: number): void {
    if (token !== this.token || !this.state) return
    const move = moveFor(this.state)
    const def: Move = LOOPS[move.loop]
    const vary = def.vary ?? 0.2
    const amp = rand(1 - vary / 2, 1 + vary / 2)
    const speed = rand(1 - vary / 3, 1 + vary / 3)
    this.play({ ...def, ms: def.ms * speed }, amp, () => this.cycle(token))
    // Now and then a fidget on top, while she's idle or listening.
    const now = performance.now()
    if (move.fidget && !this.calm && now > this.nextFidget && !this.dragging && this.reactAnim?.playState !== 'running') {
      const f = FIDGETS[Math.floor(Math.random() * FIDGETS.length)]
      this.react(keyframes(f, rand(0.7, 1.1)), f.ms * rand(0.9, 1.15))
      this.nextFidget = now + rand(5000, 12000)
    }
  }

  // ---------- dragged: lean into the move, wobble when let go ----------

  /** On every pointer move while dragging, with the move since the last call (px). */
  dragMove(dx: number, dy: number): void {
    this.dragging = true
    const now = performance.now()
    const L = this.lean
    const dt = Math.max(8, now - (L.lastMove || now - 16))
    L.lastMove = now
    L.target = Math.max(-16, Math.min(16, (-dx / dt) * 9)) * this.amp
    L.squashTarget = Math.max(-0.06, Math.min(0.06, (dy / dt) * 0.05)) * this.amp
    this.kick()
  }

  dragEnd(): void {
    this.dragging = false
    Object.assign(this.lean, { target: 0, squashTarget: 0, lastMove: 0 })
    this.kick()
  }

  /** A damped spring, one step per screen frame, until she's still again. */
  private kick(): void {
    if (this.lean.raf) return
    this.lean.last = performance.now()
    const step = (now: number): void => {
      const L = this.lean
      const dt = Math.min(0.032, (now - L.last) / 1000)
      L.last = now
      // The mouse stopped but is still held: ease the lean back.
      if (this.dragging && now - L.lastMove > 60) {
        L.target *= 0.85
        L.squashTarget *= 0.85
      }
      const k = 170
      const c = 9
      L.v += (-k * (L.a - L.target) - c * L.v) * dt
      L.a += L.v * dt
      L.sv += (-k * 1.6 * (L.squash - L.squashTarget) - c * L.sv) * dt
      L.squash += L.sv * dt
      this.els.lean.style.transform = `rotate(${L.a.toFixed(2)}deg) scale(${(1 + L.squash).toFixed(3)}, ${(1 - L.squash).toFixed(3)})`
      const still = Math.abs(L.a) < 0.05 && Math.abs(L.v) < 0.05 && Math.abs(L.squash) < 0.001 && Math.abs(L.sv) < 0.01
      if (still && !this.dragging) {
        this.els.lean.style.transform = ''
        L.raf = 0
        return
      }
      L.raf = requestAnimationFrame(step)
    }
    this.lean.raf = requestAnimationFrame(step)
  }
}
