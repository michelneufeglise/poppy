import { describe, expect, it } from 'vitest'
import { FIDGETS, INTROS, keyframes, LOOPS, moveFor, scalePose, shadowFrames, STATE_MOVES, type Move } from '../src/renderer/motion'
import { STATES } from '../src/shared/types'

const all: [string, Move][] = [
  ...Object.entries(LOOPS),
  ...Object.entries(INTROS),
  ...FIDGETS.map((f, i): [string, Move] => [`fidget ${i}`, f])
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
})
