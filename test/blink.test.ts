import { describe, expect, it } from 'vitest'
import { BLINK_EVERY, blinkSteps, nextBlinkDelay } from '../src/renderer/blink'

describe('blink', () => {
  it('closes the eyes through the half frame and always opens them again', () => {
    const steps = blinkSteps(true, false)
    expect(steps.map(([e]) => e)).toEqual(['half', 'closed', 'half', 'open'])
    const ms = steps.reduce((t, [, d]) => t + d, 0)
    expect(ms).toBeGreaterThan(120)
    expect(ms).toBeLessThan(260)
  })

  it('goes straight to closed when a pose has no half frame, and can blink twice', () => {
    expect(blinkSteps(false, false).map(([e]) => e)).toEqual(['closed', 'open'])
    const twice = blinkSteps(true, true).map(([e]) => e)
    expect(twice.filter((e) => e === 'closed')).toHaveLength(2)
    expect(twice.at(-1)).toBe('open')
  })

  it('waits 2 to 6 seconds between blinks', () => {
    expect(nextBlinkDelay(() => 0)).toBe(BLINK_EVERY[0])
    expect(nextBlinkDelay(() => 0.999)).toBeLessThan(BLINK_EVERY[1])
    expect(BLINK_EVERY).toEqual([2000, 6000])
  })
})
