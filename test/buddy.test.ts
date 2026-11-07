import { describe, expect, it } from 'vitest'
import { buddyOf, fill } from '../src/shared/buddy'

describe('Poppy or Polly', () => {
  it('calls the male character Poppy and the female one Polly', () => {
    expect(buddyOf('male').name).toBe('Poppy')
    expect(buddyOf('female').name).toBe('Polly')
    expect(buddyOf(undefined).name).toBe('Poppy')
  })

  it('fills in the name and pronouns, and leaves other braces alone', () => {
    const t = '{name} forgets what {he} learned about you and {his} notebook. {He} wrote it {himself}. {"lesson":null}'
    expect(fill(t, buddyOf('male'))).toBe('Poppy forgets what he learned about you and his notebook. He wrote it himself. {"lesson":null}')
    expect(fill(t, buddyOf('female'))).toBe('Polly forgets what she learned about you and her notebook. She wrote it herself. {"lesson":null}')
  })
})
