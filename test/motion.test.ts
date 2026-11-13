import { describe, expect, it } from 'vitest'
import {
  CELEBRATE,
  FIDGETS,
  GAZE_RANGE,
  gazeFor,
  INTROS,
  keyframes,
  LOOPS,
  moveFor,
  PERK,
  scalePose,
  shadowFrames,
  STATE_MOVES,
  stepMove,
  type Move
} from '../src/renderer/motion'
import { planWalk, STEP_PX, WALK_RANGE } from '../src/renderer/walk'
import { levels, readWav } from '../src/shared/loudness'
import { STATES } from '../src/shared/types'

const all: [string, Move][] = [
  ...Object.entries(LOOPS),
  ...Object.entries(INTROS),
  ...FIDGETS.map((f, i): [string, Move] => [`fidget ${i}`, f]),
  ['celebrate', CELEBRATE],
  ['perk', PERK],
  ['step', stepMove(-1, 400, 18)]
]

describe('motion', () => {
  it('starts and ends every move at rest, so cycles join without a jump', () => {
    for (const [name, move] of all) {
      const offsets = move.frames.map(([o]) => o)
      expect(offsets[0], name).toBe(0)
      expect(offsets.at(-1), name).toBe(1)
      expect([...offsets].sort((a, b) => a - b), name).toEqual(offsets)
      expect(move.frames[0][1], name).toEqual({})
      expect(move.frames.at(-1)![1], name).toEqual({})
    }
  })

  it('gives every state a move', () => {
    for (const s of STATES) expect(LOOPS[moveFor(s).loop], s).toBeDefined()
    for (const s of Object.keys(STATE_MOVES)) expect(STATES as readonly string[], s).toContain(s)
  })

  it('makes a move bigger or smaller without changing its shape', () => {
    expect(scalePose({ y: -20, r: 4, sx: 1.1, sy: 0.9 }, 0)).toEqual({ x: 0, y: -0, r: 0, sx: 1, sy: 1 })
    expect(scalePose({ y: -20, sx: 1.1 }, 0.5)).toEqual({ x: 0, y: -10, r: 0, sx: 1.05, sy: 1 })
    const frames = keyframes(LOOPS.hop, 1)
    expect(frames).toHaveLength(LOOPS.hop.frames.length)
    expect(frames[0].transform).toBe('translate(0px, 0px) rotate(0deg) scale(1, 1)')
  })

  it('shrinks the shadow while she is in the air', () => {
    const top = shadowFrames(LOOPS.hop, 1).find((f) => f.offset === 0.47)!
    expect(top.transform).toBe('scaleX(0.600)')
    expect(top.opacity).toBeCloseTo(0.52)
    expect(shadowFrames(LOOPS.breathe, 1)[0].opacity).toBe(1)
  })

  it('leans toward a near pointer, more the closer it is, and not beyond its range', () => {
    expect(gazeFor(GAZE_RANGE + 1, 0)).toEqual({ r: 0, x: 0 })
    const near = gazeFor(150, 0)
    const far = gazeFor(350, 0)
    expect(near.r).toBeGreaterThan(far.r)
    expect(near.r).toBeLessThanOrEqual(9)
    expect(gazeFor(-150, 0).r).toBe(-near.r)
  })

  it('walks a few small steps, never further than its range from home', () => {
    let offset = 0
    for (let i = 0; i < 200; i++) {
      const steps = planWalk(offset)
      expect(steps.length).toBeGreaterThan(0)
      for (const dx of steps) expect(Math.abs(dx)).toBeLessThanOrEqual(STEP_PX * 1.8)
      offset += steps.reduce((a, b) => a + b, 0)
      expect(Math.abs(offset)).toBeLessThanOrEqual(WALK_RANGE + 0.001)
    }
    expect(planWalk(120, () => 0).reduce((a, b) => a + b, 0)).toBeCloseTo(-120) // home again
  })
})

/** A mono 16-bit WAV: silence, then a loud tone, then silence. */
function wav(rate = 24000): Uint8Array {
  const n = rate // one second
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const w = (at: number, t: string): void => [...t].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE')
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  w(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, i > n * 0.3 && i < n * 0.6 ? Math.round(Math.sin(i / 8) * 9000) : 0, true)
  return new Uint8Array(buf)
}

describe('voice loudness', () => {
  it('follows the voice: still in silence, up while loud', () => {
    const pcm = readWav(wav())!
    expect(pcm.rate).toBe(24000)
    const l = levels(pcm)
    expect(l).toHaveLength(25) // 40 ms each
    expect(l[2]).toBe(0)
    expect(Math.max(...l.slice(9, 15))).toBeGreaterThan(0.8)
    expect(l[24]).toBeLessThan(0.1)
    expect(readWav(new Uint8Array(10))).toBeNull()
  })
})
