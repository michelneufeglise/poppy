import { describe, expect, it } from 'vitest'
import { mouthShapes, nextFlap } from '../src/renderer/mouth'

describe('mouth', () => {
  it('opens on syllables, closes in the dips and pauses, and never flickers faster than 80 ms', () => {
    // Loud speech with small syllable bumps (like Kokoro's), then a pause.
    const levels = [0.7, 0.72, 0.85, 0.86, 0.7, 0.62, 0.61, 0.75, 0.88, 0.87, 0.72, 0.6, 0.2, 0.1, 0.05]
    const shapes = mouthShapes(levels)
    expect(shapes).toHaveLength(levels.length)
    expect(shapes.some((s) => s === 'open' || s === 'wide')).toBe(true)
    expect(shapes.slice(-3)).toEqual(['closed', 'closed', 'closed'])
    const changes = shapes.filter((x, i) => i > 0 && x !== shapes[i - 1]).length
    expect(changes).toBeGreaterThan(2) // it moves, not one long open mouth
    for (let i = 1; i < shapes.length - 1; i++) {
      if (shapes[i] !== shapes[i - 1]) expect(shapes[i + 1]).toBe(shapes[i]) // held at least 2 steps
    }
  })

  it('picks a wider mouth for a bigger bump and a half-shut one for a small dip', () => {
    const flat = (at: number, v: number): number[] => Array.from({ length: 9 }, (_, i) => (i === at || i === at + 1 ? v : 0.7))
    expect(mouthShapes(flat(4, 0.9))[5]).toBe('wide') // well above the moments around it
    expect(mouthShapes(flat(4, 0.74))[5]).toBe('open')
    expect(mouthShapes(flat(4, 0.67))[5]).toBe('half')
    expect(mouthShapes(flat(4, 0.5))[5]).toBe('closed')
    expect(mouthShapes(flat(4, 0.7))[5]).toBe('drawn')
  })

  it('flaps open-ish and shut-ish in turn for the Mac voice', () => {
    expect(nextFlap('open', () => 0.2)).toBe('closed')
    expect(nextFlap('wide', () => 0.8)).toBe('half')
    expect(nextFlap('closed', () => 0.2)).toBe('open')
    expect(nextFlap('half', () => 0.6)).toBe('wide')
    expect(nextFlap('closed', () => 0.9)).toBe('drawn')
  })
})
