/**
 * How loud her voice is, moment by moment, so her bob can follow it (loud words bounce more, pauses
 * go still). Made from the WAV files Kokoro writes (16-bit PCM); nothing is kept.
 */

/** One level per this many milliseconds. */
export const LEVEL_STEP_MS = 40

export interface Pcm {
  rate: number
  channels: number
  samples: Int16Array
}

/** The samples of a 16-bit PCM WAV file, or null for anything else. */
export function readWav(buf: Uint8Array): Pcm | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const tag = (at: number): string => String.fromCharCode(...buf.subarray(at, at + 4))
  if (buf.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let rate = 0
  let channels = 0
  let bits = 0
  let format = 0
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = tag(at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ' && size >= 16) {
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      rate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
    } else if (id === 'data') {
      if (format !== 1 || bits !== 16 || !rate || !channels) return null
      const end = Math.min(buf.length, body + size)
      const bytes = buf.slice(body, end - ((end - body) % 2))
      return { rate, channels, samples: new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) }
    }
    at = body + size + (size % 2)
  }
  return null
}

/** Quiet (and below) → 0, loud speech → 1, in decibels below full scale. */
const QUIET_DB = -46
const LOUD_DB = -14

/**
 * Loudness per LEVEL_STEP_MS, 0–1, quick to rise and a little slower to fall (like a VU meter), so
 * syllables show as bumps instead of flicker.
 */
export function levels(pcm: Pcm, stepMs = LEVEL_STEP_MS): number[] {
  const per = Math.max(1, Math.round((pcm.rate * stepMs) / 1000)) * pcm.channels
  const out: number[] = []
  let level = 0
  for (let i = 0; i < pcm.samples.length; i += per) {
    let sum = 0
    const end = Math.min(pcm.samples.length, i + per)
    for (let j = i; j < end; j++) sum += pcm.samples[j] * pcm.samples[j]
    const rms = Math.sqrt(sum / Math.max(1, end - i)) / 32768
    const db = rms > 0 ? 20 * Math.log10(rms) : -100
    const target = Math.min(1, Math.max(0, (db - QUIET_DB) / (LOUD_DB - QUIET_DB)))
    level += (target - level) * (target > level ? 0.7 : 0.35)
    out.push(Math.round(level * 100) / 100)
  }
  return out
}
