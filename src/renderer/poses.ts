import type { Character, Mood, PoppyState } from '../shared/types'

/**
 * Which of the user's drawings to show when: while she speaks, while she hears a spoken question, and
 * now and then on the desktop. Only picks drawings; every one is the user's own (never redrawn).
 *
 * Besides the 48 states there is one extra drawing: listening-2, Polly's listening pose from her first
 * sheet (her listening state is her own cupped-ear drawing since 2026-11-09). It's only used while she
 * hears a question, so it has no label or mood of its own.
 */
export type Pose = PoppyState | 'listening-2'
export const EXTRA_POSES = ['listening-2'] as const
/** The state a pose belongs to (for its label and motion). */
export const basePose = (p: Pose): PoppyState => (p === 'listening-2' ? 'listening' : p)

/**
 * Close relatives of a mood, from the same group as in her prompt's mood list, so a long reply can
 * show a bit more than one drawing without changing the feeling.
 */
export const RELATED: Partial<Record<Mood, Mood[]>> = {
  happy: ['cheerful', 'laughing'],
  cheerful: ['happy', 'laughing'],
  laughing: ['happy', 'cheerful'],
  excited: ['clapping', 'happy'],
  playful: ['sneaky', 'laughing'],
  proud: ['clapping'],
  clapping: ['proud', 'excited'],
  hopeful: ['wonder'],
  cuddly: ['shy'],
  chilling: ['dreamy', 'lazy'],
  surprised: ['shocked', 'wonder'],
  shocked: ['surprised'],
  wonder: ['curious', 'surprised'],
  spooked: ['scared'],
  thinking: ['focused', 'doubtful'],
  curious: ['wonder', 'thinking'],
  focused: ['thinking', 'determined'],
  determined: ['focused', 'defiant'],
  busy: ['focused'],
  confused: ['doubtful', 'thinking'],
  doubtful: ['confused', 'thinking'],
  dreamy: ['wonder', 'chilling'],
  sad: ['sighing'],
  crying: ['sad'],
  sighing: ['sad'],
  anxious: ['nervous'],
  nervous: ['anxious'],
  scared: ['spooked', 'nervous'],
  shy: ['cuddly'],
  grumpy: ['frustrated'],
  frustrated: ['grumpy', 'sighing'],
  angry: ['frustrated', 'defiant'],
  defiant: ['determined'],
  disgusted: ['grumpy'],
  bored: ['lazy', 'sighing'],
  sneaky: ['playful'],
  tired: ['lazy', 'sighing'],
  lazy: ['tired', 'bored'],
  hello: ['happy'],
  'sad-hello': ['sad']
}
/** How often a later mood turn shows a relative instead of the mood itself. */
export const RELATED_CHANCE = 0.4

const pick = <T>(list: readonly T[], rand: () => number): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]

/**
 * Her pose for each step while she speaks (a step = a new spoken sentence, or a few seconds of text
 * without voice). The mood shows at once, then talking and the mood (sometimes a relative) take turns,
 * so the mood is seen during the reply, not only for a moment afterwards.
 */
export function speakingPose(mood: Mood | null, step: number, rand: () => number = Math.random): Pose {
  if (!mood || mood === 'idle' || step % 2 === 1) return 'talking'
  const related = RELATED[mood] ?? []
  return step > 0 && related.length && rand() < RELATED_CHANCE ? pick(related, rand) : mood
}

/** Listening drawings per character, and the attentive poses in between. */
export const LISTENING: Record<Character, readonly Pose[]> = { female: ['listening', 'listening-2'], male: ['listening'] }
export const ATTENTIVE: readonly PoppyState[] = ['curious', 'wonder', 'hopeful']
export const HEARING_EVERY: [number, number] = [2500, 4000]

/**
 * While she hears a spoken question: mostly a listening drawing (Polly has two), now and then an
 * attentive pose, and always back to listening after one.
 */
export function nextHearingPose(current: Pose, character: Character, rand: () => number = Math.random): Pose {
  const listening = LISTENING[character]
  if (!listening.includes(current)) return pick(listening, rand)
  const others = listening.filter((p) => p !== current)
  return others.length && rand() < 0.5 ? pick(others, rand) : pick(ATTENTIVE, rand)
}

/**
 * On the desktop with the chat closed: now and then a calm or body pose for a few seconds (poses the
 * model hardly ever picks), then idle again.
 */
export const DESK_POSES: readonly PoppyState[] = [
  'dreamy', 'playful', 'cuddly', 'bored', 'lazy', 'hungry', 'thirsty', 'sneaky', 'hopeful', 'wonder', 'curious'
]
export const DESK_AFTER_MS = 20_000
export const DESK_EVERY: [number, number] = [30_000, 60_000]
export const DESK_HOLD: [number, number] = [4000, 7000]

export const nextDeskPose = (last: Pose, rand: () => number = Math.random): PoppyState =>
  pick(DESK_POSES.filter((p) => p !== last), rand)

/**
 * Resting, with the chat closed: awake (the desk poses above) for the first minutes, then drowsy until
 * the sleep time: sleepier poses and now and then a short nap. The drowsy stage starts sooner when
 * nobody uses the Mac at all (no keyboard or mouse for AWAY_DROWSY_MS).
 */
export const DROWSY_AFTER_MS = 3 * 60_000
export const AWAY_DROWSY_MS = 2 * 60_000
export const DROWSY_POSES: readonly PoppyState[] = ['tired', 'lazy', 'chilling', 'dreamy', 'bored', 'sighing']
export const NAP_CHANCE = 0.3
export const NAP_HOLD: [number, number] = [10_000, 20_000]

export type RestStage = 'awake' | 'drowsy'
export const restStage = (idleMs: number, macIdleMs: number): RestStage =>
  idleMs >= DROWSY_AFTER_MS || macIdleMs >= AWAY_DROWSY_MS ? 'drowsy' : 'awake'

/** The next resting pose and how long it shows (then idle again). */
export function nextRestPose(stage: RestStage, last: Pose, rand: () => number = Math.random): { pose: PoppyState; holdMs: number } {
  if (stage === 'awake') return { pose: nextDeskPose(last, rand), holdMs: between(DESK_HOLD, rand) }
  if (rand() < NAP_CHANCE) return { pose: 'sleeping', holdMs: between(NAP_HOLD, rand) }
  return { pose: pick(DROWSY_POSES.filter((p) => p !== last), rand), holdMs: between(DESK_HOLD, rand) }
}

/** A time between [min, max]. */
export const between = ([min, max]: [number, number], rand: () => number = Math.random): number => min + rand() * (max - min)
