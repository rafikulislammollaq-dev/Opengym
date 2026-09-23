// src/ai/coach/GymCoachService.js
// Deterministic gym coaching orchestrator.
//
// Lower layer: ExerciseCoachingBook -> evidence findings.
// Upper layer: GymAdviceBook -> judges/prioritizes/merges those findings.
// Output layer: CoachingResponseGenerator -> human wording.
//
// No LLM, no network, no Gemini.

import {
  CoachingRuleEngine,
} from './CoachingRuleEngine.js'

import {
  CoachingResponseGenerator,
} from './CoachingResponseGenerator.js'

import {
  EXERCISE_COACHING_BOOK,
  getExerciseRules,
  normalizeRepContext,
} from './ExerciseCoachingBook.js'

import {
  GymAdviceEngine,
} from './GymAdviceEngine.js'

import {
  getAdviceRules,
  GYM_ADVICE_BOOK,
} from './GymAdviceBook.js'

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

export class GymCoachService {
  constructor({
    maxFindings = 8,
    maxCorrections = 2,
  } = {}) {
    this.maxFindings = maxFindings
    this.maxCorrections = maxCorrections
    this.responseGenerator = new CoachingResponseGenerator({
      maxCorrections,
    })
  }

  getBookVersion() {
    return EXERCISE_COACHING_BOOK.version
  }

  getAdviceBookVersion() {
    return GYM_ADVICE_BOOK.version
  }

  evaluateRep({
    exercise = 'squat',
    report = {},
    history = [],
  } = {}) {
    const context = normalizeRepContext({ exercise, report })
    const engine = new CoachingRuleEngine({
      rules: getExerciseRules(exercise),
      maxFindings: this.maxFindings,
    })

    const findings = engine.evaluate(context)
    const severityCounts = CoachingRuleEngine.summarizeFindings(findings)

    const adviceEngine = new GymAdviceEngine({
      rules: getAdviceRules(exercise),
      maxAdvice: this.maxCorrections,
    })

    const judged = adviceEngine.judgeRep({
      exercise,
      report,
      findings,
      history,
    })

    const coaching = this.responseGenerator.forRep({
      report,
      findings: judged.advice.map(item => ({
        ...item,
        id: item.id,
        message: item.message,
        correction: item.correction,
        severity: item.severity,
        priority: item.priority,
      })),
    })

    return {
      exercise,
      bookVersion: this.getBookVersion(),
      adviceBookVersion: this.getAdviceBookVersion(),
      accepted: report?.accepted === true,
      findings,
      severityCounts,
      judged,
      corrections: CoachingRuleEngine.pickTopCorrections(
        findings,
        this.maxCorrections
      ),
      coaching,
      context,
    }
  }

  evaluateSet({
    exercise = 'squat',
    reports = [],
  } = {}) {
    const repReports = safeArray(reports)
    const evaluations = []
    const history = []

    for (const report of repReports) {
      const evaluation = this.evaluateRep({
        exercise,
        report,
        history,
      })
      evaluations.push(evaluation)
      history.push({
        findingIds: evaluation.findings.map(f => f.id),
      })
    }

    const acceptedReps = repReports.filter(
      report => report?.accepted === true
    ).length

    const allFindings = evaluations.flatMap(
      evaluation => evaluation.findings
    )

    const grouped = new Map()

    for (const finding of allFindings) {
      const key = finding.id
      const current = grouped.get(key) ?? {
        ...finding,
        count: 0,
      }
      current.count += 1
      grouped.set(key, current)
    }

    const recurringFindings = [...grouped.values()]
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return b.priority - a.priority
      })

    const summary = {
      exercise,
      reps: repReports.length,
      acceptedReps,
      rejectedReps: repReports.length - acceptedReps,
      recurringFindings,
    }

    const adviceEngine = new GymAdviceEngine({
      rules: getAdviceRules(exercise),
      maxAdvice: this.maxCorrections,
    })

    const judgedSet = adviceEngine.judgeSet({
      exercise,
      summary,
      evaluations,
      recurringFindings,
    })

    const coaching = this.responseGenerator.forSet({
      summary,
      findings: judgedSet.advice.map(item => ({
        ...item,
        priority: item.priority,
        severity: item.severity,
        correction: item.correction,
        message: item.message,
      })),
    })

    return {
      ...summary,
      bookVersion: this.getBookVersion(),
      adviceBookVersion: this.getAdviceBookVersion(),
      evaluations,
      judged: judgedSet,
      coaching,
    }
  }
}

export function createGymCoachService(options) {
  return new GymCoachService(options)
}

export const DEFAULT_GYM_COACH = new GymCoachService()
