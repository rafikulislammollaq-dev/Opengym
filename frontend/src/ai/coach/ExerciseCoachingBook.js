// src/ai/coach/ExerciseCoachingBook.js
// Initial deterministic coaching knowledge base.
// Thresholds are configurable heuristics for the current vision prototype;
// they should be validated/tuned against labeled workout data before production use.

import { pickMetric } from './CoachingRuleEngine.js'

const squatRules = [
  {
    id: 'squat-depth-low',
    exercise: 'squat',
    category: 'depth',
    severity: 'minor',
    priority: 100,
    tags: ['depth', 'consistency'],
    when: ({ accepted, romDegrees, minRomDegrees = 60 }) =>
      accepted === true &&
      Number.isFinite(romDegrees) &&
      romDegrees < minRomDegrees,
    message: ({ romDegrees }) =>
      `Depth was a little shallow (${Math.round(romDegrees)}° ROM).`,
    correction: 'Next rep: descend slightly farther while staying controlled.',
    evidence: ({ romDegrees, minRomDegrees = 60 }) => ({
      romDegrees,
      minimumRomDegrees: minRomDegrees,
    }),
  },

  {
    id: 'squat-torso-lean',
    exercise: 'squat',
    category: 'torso',
    severity: 'moderate',
    priority: 90,
    tags: ['torso', 'bracing'],
    when: ({ accepted, maxTorsoLeanDegrees, torsoLeanAttentionDegrees = 35 }) =>
      accepted === true &&
      Number.isFinite(maxTorsoLeanDegrees) &&
      maxTorsoLeanDegrees > torsoLeanAttentionDegrees,
    message: ({ maxTorsoLeanDegrees }) =>
      `Forward torso lean increased to ${Math.round(maxTorsoLeanDegrees)}°.`,
    correction: 'Next rep: brace your trunk and keep the torso more stable.',
    evidence: ({ maxTorsoLeanDegrees, torsoLeanAttentionDegrees = 35 }) => ({
      maxTorsoLeanDegrees,
      attentionThresholdDegrees: torsoLeanAttentionDegrees,
    }),
  },

  {
    id: 'squat-asymmetry',
    exercise: 'squat',
    category: 'symmetry',
    severity: 'moderate',
    priority: 80,
    tags: ['symmetry'],
    when: ({ accepted, maxKneeAsymmetryDegrees, symmetryAttentionDegrees = 12 }) =>
      accepted === true &&
      Number.isFinite(maxKneeAsymmetryDegrees) &&
      maxKneeAsymmetryDegrees > symmetryAttentionDegrees,
    message: ({ maxKneeAsymmetryDegrees }) =>
      `Left-right knee-angle difference reached ${Math.round(maxKneeAsymmetryDegrees)}°.`,
    correction: 'Next rep: try to keep both legs moving through a more even path.',
    evidence: ({ maxKneeAsymmetryDegrees, symmetryAttentionDegrees = 12 }) => ({
      maxKneeAsymmetryDegrees,
      attentionThresholdDegrees: symmetryAttentionDegrees,
    }),
  },

  {
    id: 'squat-rushed-rep',
    exercise: 'squat',
    category: 'tempo',
    severity: 'minor',
    priority: 70,
    tags: ['tempo', 'control'],
    when: ({ accepted, durationMs, fastRepDurationMs = 600 }) =>
      accepted === true &&
      Number.isFinite(durationMs) &&
      durationMs < fastRepDurationMs,
    message: ({ durationMs }) =>
      `The rep was fast (${(durationMs / 1000).toFixed(1)}s).`,
    correction: 'Next rep: slow the movement slightly and keep the descent and rise controlled.',
    evidence: ({ durationMs, fastRepDurationMs = 600 }) => ({
      durationMs,
      fastRepDurationMs,
    }),
  },

  {
    id: 'squat-long-rep',
    exercise: 'squat',
    category: 'tempo',
    severity: 'info',
    priority: 20,
    tags: ['tempo'],
    when: ({ accepted, durationMs, slowRepDurationMs = 6000 }) =>
      accepted === true &&
      Number.isFinite(durationMs) &&
      durationMs > slowRepDurationMs,
    message: ({ durationMs }) =>
      `This rep was very slow (${(durationMs / 1000).toFixed(1)}s).`,
    correction: 'Keep the movement deliberate, but avoid unnecessary pauses between phases.',
    evidence: ({ durationMs, slowRepDurationMs = 6000 }) => ({
      durationMs,
      slowRepDurationMs,
    }),
  },

  {
    id: 'squat-good-rep',
    exercise: 'squat',
    category: 'positive',
    severity: 'info',
    priority: 1,
    tags: ['positive'],
    when: ({ accepted, romDegrees, maxTorsoLeanDegrees, maxKneeAsymmetryDegrees }) =>
      accepted === true &&
      Number.isFinite(romDegrees) &&
      romDegrees >= 60 &&
      (!Number.isFinite(maxTorsoLeanDegrees) || maxTorsoLeanDegrees <= 35) &&
      (!Number.isFinite(maxKneeAsymmetryDegrees) || maxKneeAsymmetryDegrees <= 12),
    message: () => 'This rep met the current squat form checks.',
    correction: '',
    evidence: ({ romDegrees, maxTorsoLeanDegrees, maxKneeAsymmetryDegrees }) => ({
      romDegrees,
      maxTorsoLeanDegrees,
      maxKneeAsymmetryDegrees,
    }),
  },
]

export const GLOBAL_COACHING_RULES = [
  {
    id: 'no-valid-rep',
    category: 'rep-validation',
    severity: 'info',
    priority: 110,
    when: ({ accepted }) => accepted === false,
    message: () => 'This movement did not satisfy the current rep-validation checks.',
    correction: 'Reset at the starting position and repeat the movement with a clear, controlled range of motion.',
  },

  {
    id: 'insufficient-data',
    category: 'data-quality',
    severity: 'info',
    priority: 120,
    when: ({ status }) => status === 'insufficient_data' || status === 'not_assessed',
    message: () => 'There was not enough reliable pose data to assess every form detail.',
    correction: 'Keep your full body in frame and use the recommended camera angle for this exercise.',
  },
]

export const EXERCISE_COACHING_BOOK = Object.freeze({
  version: '1.0.0',
  exercises: Object.freeze({
    squat: Object.freeze({
      id: 'squat',
      name: 'Squat',
      defaults: Object.freeze({
        minRomDegrees: 60,
        torsoLeanAttentionDegrees: 35,
        symmetryAttentionDegrees: 12,
        fastRepDurationMs: 600,
        slowRepDurationMs: 6000,
      }),
      rules: Object.freeze([...squatRules]),
    }),
  }),
  globalRules: Object.freeze([...GLOBAL_COACHING_RULES]),
})

export function getExerciseRules(exercise = 'squat') {
  const entry = EXERCISE_COACHING_BOOK.exercises?.[exercise]
  if (!entry) return []
  return [...EXERCISE_COACHING_BOOK.globalRules, ...entry.rules]
}

export function normalizeRepContext({
  exercise = 'squat',
  report = {},
} = {}) {
  const measurement = report.measurements ?? report
  const assessment = report.assessment ?? {}

  return {
    exercise,
    accepted: report.accepted ?? measurement.accepted ?? null,
    status: report.status ?? 'assessed',
    romDegrees: pickMetric(measurement, 'romDegrees', 'rom'),
    durationMs: pickMetric(measurement, 'durationMs'),
    maxTorsoLeanDegrees: pickMetric(measurement, 'maxTorsoLeanDegrees', 'maxTorsoLean'),
    maxKneeAsymmetryDegrees: pickMetric(measurement, 'maxKneeAsymmetryDegrees', 'maxKneeAsymmetryDegrees', 'asymmetry'),
    minRomDegrees: EXERCISE_COACHING_BOOK.exercises?.[exercise]?.defaults?.minRomDegrees ?? 60,
    torsoLeanAttentionDegrees: EXERCISE_COACHING_BOOK.exercises?.[exercise]?.defaults?.torsoLeanAttentionDegrees ?? 35,
    symmetryAttentionDegrees: EXERCISE_COACHING_BOOK.exercises?.[exercise]?.defaults?.symmetryAttentionDegrees ?? 12,
    fastRepDurationMs: EXERCISE_COACHING_BOOK.exercises?.[exercise]?.defaults?.fastRepDurationMs ?? 600,
    slowRepDurationMs: EXERCISE_COACHING_BOOK.exercises?.[exercise]?.defaults?.slowRepDurationMs ?? 6000,
    assessment,
  }
}
