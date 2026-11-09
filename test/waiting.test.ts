import { describe, expect, it } from 'vitest'
import {
  BORED_AFTER_MS,
  BORED_POSES,
  CHANGE_EVERY,
  isWaitingPose,
  nextWaitingDelay,
  nextWaitingPose,
  WAITING_POSES
} from '../src/renderer/waiting'

const seq = (...xs: number[]) => {
  let i = 0
  return () => xs[i++ % xs.length]
}

describe('waiting poses', () => {
  it('leaves listening for another calm pose, never the same one twice', () => {
    for (let r = 0; r < 1; r += 0.05) {
      const next = nextWaitingPose('listening', 0, () => r)
      expect(WAITING_POSES).toContain(next)
    }
    for (const pose of WAITING_POSES) {
      for (let r = 0.41; r < 1; r += 0.05) expect(nextWaitingPose(pose, 0, seq(0.9, r))).not.toBe(pose)
    }
  })

  it('goes back to listening now and then, and only gets bored after a minute', () => {
    expect(nextWaitingPose('dreamy', 0, () => 0.1)).toBe('listening')
    const early = new Set<string>()
    const late = new Set<string>()
    for (let r = 0; r < 1; r += 0.01) {
      early.add(nextWaitingPose('listening', BORED_AFTER_MS - 1, () => r))
      late.add(nextWaitingPose('listening', BORED_AFTER_MS, () => r))
    }
    for (const b of BORED_POSES) {
      expect(early.has(b)).toBe(false)
      expect(late.has(b)).toBe(true)
    }
  })

  it('only touches its own poses, and changes every 6 to 12 seconds', () => {
    expect(isWaitingPose('listening')).toBe(true)
    expect(isWaitingPose('bored')).toBe(true)
    expect(isWaitingPose('talking')).toBe(false)
    expect(isWaitingPose('happy')).toBe(false)
    expect(nextWaitingDelay(() => 0)).toBe(CHANGE_EVERY[0])
    expect(nextWaitingDelay(() => 0.999)).toBeLessThan(CHANGE_EVERY[1])
  })
})
