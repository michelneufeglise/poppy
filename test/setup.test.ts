import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hasModel, lastLine, macChecks, modelFor, poseFor, pullProgress, STEPS, type MacInfo, type StepMood } from '../src/shared/setup'

const mac: MacInfo = { macos: '26.6.2', chip: 'apple', chipName: 'Apple M1 Max', memGB: 64, freeGB: 400, swift: true, brew: true }

describe('setup', () => {
  it('picks the biggest model this Mac has memory and room for', () => {
    expect(modelFor(mac).model).toBe('qwen3.6:35b-a3b')
    expect(modelFor({ ...mac, memGB: 16 }).model).toBe('gemma3:4b')
    expect(modelFor({ ...mac, memGB: 8 }).model).toBe('qwen3:4b-instruct-2507-q4_K_M')
    expect(modelFor({ ...mac, freeGB: 20 }).model).toBe('gemma3:4b') // no room for 23 GB + spare
    expect(modelFor({ ...mac, chip: 'intel' }).model).toBe('gemma3:4b')
    expect(modelFor({ ...mac, memGB: 4, freeGB: 1 }).model).toBe('qwen3:4b-instruct-2507-q4_K_M') // nothing fits: the smallest
  })

  it('tells what this Mac can do', () => {
    const state = (info: MacInfo, id: string): string | undefined => macChecks(info).find((c) => c.id === id)?.state
    expect(macChecks(mac).every((c) => c.state === 'ok')).toBe(true)
    expect(state({ ...mac, macos: '15.4' }, 'macos')).toBe('warn') // no voice input
    expect(state({ ...mac, macos: '11.7' }, 'macos')).toBe('missing')
    expect(state({ ...mac, freeGB: 2 }, 'disk')).toBe('missing')
    expect(state({ ...mac, swift: false }, 'swift')).toBe('warn')
    expect(state({ ...mac, brew: false }, 'brew')).toBe('warn')
  })

  it('finds models with or without their tag', () => {
    expect(hasModel(['nomic-embed-text:latest'], 'nomic-embed-text')).toBe(true)
    expect(hasModel(['qwen3.6:35b-a3b'], 'qwen3.6:35b-a3b')).toBe(true)
    expect(hasModel(['gemma3:12b'], 'gemma3:4b')).toBe(false)
  })

  it('shows one of her own drawings for every step and mood', () => {
    const moods: StepMood[] = ['checking', 'ok', 'missing', 'working', 'failed']
    for (const step of STEPS) {
      for (const mood of moods) {
        const pose = poseFor(step, mood)
        expect(existsSync(`assets/female/states/${pose}.png`), `${step}/${mood}: ${pose}`).toBe(true)
        expect(existsSync(`assets/states/${pose}.png`), `${step}/${mood}: ${pose}`).toBe(true)
      }
    }
  })

  it('reads download and installer progress', () => {
    expect(pullProgress({ status: 'pulling abc123def456', completed: 5e9, total: 20e9 })).toEqual({ text: '5 GB of 20 GB', percent: 25 })
    expect(pullProgress({ status: 'pulling manifest' }).percent).toBeNull()
    expect(pullProgress({ status: 'success' }).percent).toBe(100)
    expect(pullProgress({ error: 'pull model manifest: file does not exist' }).error).toMatch(/does not exist/)
    expect(lastLine('==> Downloading\n\x1b[1m==> Installing Cask ollama-app\x1b[0m\n######## 42.0%\n')).toBe('==> Installing Cask ollama-app')
  })
})
