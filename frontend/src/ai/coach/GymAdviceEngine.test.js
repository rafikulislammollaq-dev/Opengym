import { describe, expect, it } from 'vitest'
import { GymAdviceEngine } from './GymAdviceEngine.js'
import { getAdviceRules } from './GymAdviceBook.js'

describe('GymAdviceEngine', () => {
  it('keeps higher-level advice deterministic', () => {
    const engine = new GymAdviceEngine({
      rules: getAdviceRules('squat'),
      maxAdvice: 2,
    })

    const result = engine.judgeRep({
      exercise: 'squat',
      report: { accepted: true },
      findings: [
        { id: 'squat-depth-low', priority: 100, severity: 'minor', message: 'Depth low.', correction: 'Go deeper.' },
        { id: 'squat-rushed-rep', priority: 70, severity: 'minor', message: 'Fast rep.', correction: 'Slow down.' },
      ],
      history: [],
    })

    expect(result.advice).toHaveLength(1)
    expect(result.advice[0].id).toBe('shallow-and-rushed')
  })

  it('does not produce more than the configured number of corrections', () => {
    const engine = new GymAdviceEngine({ maxAdvice: 2 })
    const result = engine.judgeRep({
      report: { accepted: true },
      findings: [
        { id: 'a', priority: 100, severity: 'major', message: 'A', correction: 'A1' },
        { id: 'b', priority: 90, severity: 'moderate', message: 'B', correction: 'B1' },
        { id: 'c', priority: 80, severity: 'minor', message: 'C', correction: 'C1' },
      ],
    })

    expect(result.advice.length).toBeLessThanOrEqual(2)
  })
})
