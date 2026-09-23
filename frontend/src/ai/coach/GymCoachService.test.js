// src/ai/coach/GymCoachService.test.js

import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  CoachingRuleEngine,
} from './CoachingRuleEngine.js'

import {
  DEFAULT_GYM_COACH,
  GymCoachService,
} from './GymCoachService.js'

describe('CoachingRuleEngine', () => {
  it('evaluates matching rules deterministically', () => {
    const engine = new CoachingRuleEngine({
      rules: [
        {
          id: 'depth',
          priority: 10,
          severity: 'minor',
          when: ({ rom }) => rom < 60,
          message: 'Depth is shallow.',
          correction: 'Go deeper.',
        },
        {
          id: 'positive',
          priority: 1,
          severity: 'info',
          when: ({ rom }) => rom >= 60,
          message: 'Depth check passed.',
        },
      ],
    })

    expect(engine.evaluate({ rom: 50 })).toEqual([
      expect.objectContaining({
        id: 'depth',
        severity: 'minor',
        message: 'Depth is shallow.',
      }),
    ])
  })
})

describe('GymCoachService', () => {
  it('coaches a good squat rep without an LLM', () => {
    const coach = new GymCoachService()

    const result = coach.evaluateRep({
      exercise: 'squat',
      report: {
        repNumber: 1,
        accepted: true,
        measurements: {
          romDegrees: 72,
          durationMs: 1400,
          maxTorsoLeanDegrees: 20,
          maxKneeAsymmetryDegrees: 4,
        },
      },
    })

    expect(result.accepted).toBe(true)
    expect(result.findings.some(f => f.id === 'squat-good-rep')).toBe(true)
    expect(result.coaching).toContain('met the current form checks')
  })

  it('returns targeted corrections for a shallow and rushed squat', () => {
    const result = DEFAULT_GYM_COACH.evaluateRep({
      exercise: 'squat',
      report: {
        repNumber: 2,
        accepted: true,
        measurements: {
          romDegrees: 52,
          durationMs: 420,
          maxTorsoLeanDegrees: 28,
          maxKneeAsymmetryDegrees: 5,
        },
      },
    })

    expect(result.findings.map(f => f.id)).toEqual([
      'squat-depth-low',
      'squat-rushed-rep',
    ])
    expect(result.corrections).toHaveLength(2)
    expect(result.coaching).toContain('depth')
    expect(result.coaching).toContain('slow')
  })

  it('creates recurring set findings', () => {
    const coach = new GymCoachService()

    const result = coach.evaluateSet({
      exercise: 'squat',
      reports: [
        {
          repNumber: 1,
          accepted: true,
          measurements: {
            romDegrees: 52,
            durationMs: 1400,
            maxTorsoLeanDegrees: 40,
            maxKneeAsymmetryDegrees: 4,
          },
        },
        {
          repNumber: 2,
          accepted: true,
          measurements: {
            romDegrees: 54,
            durationMs: 1500,
            maxTorsoLeanDegrees: 41,
            maxKneeAsymmetryDegrees: 5,
          },
        },
        {
          repNumber: 3,
          accepted: false,
          measurements: {
            romDegrees: 40,
            durationMs: 200,
            maxTorsoLeanDegrees: 45,
            maxKneeAsymmetryDegrees: 20,
          },
        },
      ],
    })

    expect(result.reps).toBe(3)
    expect(result.acceptedReps).toBe(2)
    expect(result.rejectedReps).toBe(1)
    expect(result.coaching).toContain('3 reps completed')
    expect(result.recurringFindings[0].count).toBeGreaterThan(1)
  })
})


describe('GymAdviceEngine integration', () => {
  it('lets the meta advice book combine shallow depth and rushed tempo', () => {
    const coach = new GymCoachService()

    const result = coach.evaluateRep({
      exercise: 'squat',
      report: {
        repNumber: 1,
        accepted: true,
        measurements: {
          romDegrees: 50,
          durationMs: 420,
          maxTorsoLeanDegrees: 20,
          maxKneeAsymmetryDegrees: 4,
        },
      },
    })

    expect(result.adviceBookVersion).toBe('2.0.0')
    expect(result.judged.advice.length).toBeGreaterThan(0)
    expect(result.coaching.toLowerCase()).toContain('depth')
    expect(result.coaching.toLowerCase()).toContain('slow')
  })

  it('uses set-level advice to detect repeated problems', () => {
    const coach = new GymCoachService()

    const result = coach.evaluateSet({
      exercise: 'squat',
      reports: [
        { accepted: true, measurements: { romDegrees: 52, durationMs: 1400, maxTorsoLeanDegrees: 20, maxKneeAsymmetryDegrees: 4 } },
        { accepted: true, measurements: { romDegrees: 54, durationMs: 1500, maxTorsoLeanDegrees: 21, maxKneeAsymmetryDegrees: 4 } },
        { accepted: true, measurements: { romDegrees: 53, durationMs: 1450, maxTorsoLeanDegrees: 22, maxKneeAsymmetryDegrees: 4 } },
      ],
    })

    expect(result.judged.advice.some(item => /repeatedly|consistent depth/i.test(item.message))).toBe(true)
  })
})
