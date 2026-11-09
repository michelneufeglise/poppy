import { describe, expect, it } from 'vitest'
import {
  ATTENTIVE,
  DESK_POSES,
  RELATED,
  basePose,
  nextDeskPose,
  nextHearingPose,
  speakingPose
} from '../src/renderer/poses'
import { MOODS, STATES } from '../src/shared/types'

const always = (n: number) => () => n

describe('poses', () => {
  it('only names real moods and states', () => {
    for (const [mood, rel] of Object.entries(RELATED)) {
      expect(MOODS).toContain(mood)
      for (const r of rel!) expect(MOODS).toContain(r)
      expect(rel).not.toContain(mood)
    }
    for (const p of [...DESK_POSES, ...ATTENTIVE]) expect(STATES).toContain(p)
    expect(basePose('listening-2')).toBe('listening')
  })

  it('shows the mood while she speaks, taking turns with talking', () => {
    expect(speakingPose('happy', 0, always(0))).toBe('happy') // the mood first, never a relative
    expect(speakingPose('happy', 1)).toBe('talking')
    expect(speakingPose('happy', 2, always(0.99))).toBe('happy')
    expect(['cheerful', 'laughing']).toContain(speakingPose('happy', 2, always(0)))
    expect(speakingPose('hungry', 2, always(0))).toBe('hungry') // no relatives
    expect(speakingPose(null, 0)).toBe('talking')
    expect(speakingPose('idle', 0)).toBe('talking')
  })

  it('hears with listening drawings and attentive poses, always back to listening', () => {
    expect(['listening', 'listening-2']).toContain(nextHearingPose('curious', 'female', always(0.7)))
    expect(nextHearingPose('listening', 'female', always(0))).toBe('listening-2')
    expect(ATTENTIVE).toContain(nextHearingPose('listening', 'female', always(0.9)))
    expect(ATTENTIVE).toContain(nextHearingPose('listening', 'male', always(0)))
    expect(nextHearingPose('wonder', 'male', always(0.3))).toBe('listening')
  })

  it('picks a different desk pose each time', () => {
    for (let i = 0; i < 20; i++) expect(nextDeskPose('dreamy', always(i / 20))).not.toBe('dreamy')
  })
})
