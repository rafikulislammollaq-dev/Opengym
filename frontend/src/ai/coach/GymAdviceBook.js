// src/ai/coach/GymAdviceBook.js
// Meta-level deterministic advice knowledge base.
//
// The first coaching book answers:
//   "What findings did the measurement rules detect?"
//
// This book answers:
//   "Given all those findings together, what advice should the user actually receive?"
//
// It deliberately sits ABOVE ExerciseCoachingBook.js. It may suppress, merge,
// prioritize, reinforce, or transform lower-level findings into higher-level advice.
// No LLM, no randomness, no network.

const severityRank = Object.freeze({
  info: 0,
  minor: 1,
  moderate: 2,
  major: 3,
})

function number(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback
}

function acceptedRatio(reports = []) {
  if (!Array.isArray(reports) || reports.length === 0) return null
  const accepted = reports.filter(r => r?.accepted === true).length
  return accepted / reports.length
}

function findingCount(findings = [], id) {
  return findings.filter(f => f?.id === id).length
}

function categoryCount(findings = [], category) {
  return findings.filter(f => f?.category === category).length
}

function hasFinding(findings = [], id) {
  return findings.some(f => f?.id === id)
}

function maxSeverity(findings = []) {
  let best = 'info'
  for (const finding of findings) {
    if ((severityRank[finding?.severity] ?? 0) > (severityRank[best] ?? 0)) {
      best = finding.severity
    }
  }
  return best
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))]
}

// ---------------------------------------------------------------------------
// Advice rules
// ---------------------------------------------------------------------------

export const GLOBAL_ADVICE_RULES = Object.freeze([
  {
    id: 'advisor-insufficient-data-gate',
    priority: 1000,
    kind: 'gate',
    when: ({ context }) => {
      const quality = context?.report?.assessment?.overallQuality
      return quality === 'insufficient_data' || context?.status === 'insufficient_data'
    },
    advice: () => ({
      id: 'data-quality-gate',
      priority: 1000,
      severity: 'info',
      category: 'data-quality',
      message: 'I need a clearer view before judging technique reliably.',
      correction: 'Keep your full body visible and use the recommended camera position.',
      tags: ['gate', 'data-quality'],
    }),
  },

  {
    id: 'advisor-unassessed-gate',
    priority: 990,
    kind: 'gate',
    when: ({ context }) => {
      const assessments = context?.report?.assessment ?? {}
      return Object.values(assessments).some(value => value === 'not_assessed' || value === 'insufficient_data')
    },
    advice: () => ({
      id: 'unassessed-feature-gate',
      priority: 990,
      severity: 'info',
      category: 'data-quality',
      message: 'Some form details were not assessed reliably on this rep.',
      correction: 'Do not change technique based on an unassessed detail; improve the camera setup first.',
      tags: ['gate', 'uncertainty'],
    }),
  },

  {
    id: 'advisor-rejected-rep',
    priority: 960,
    kind: 'validation',
    when: ({ context }) => context?.report?.accepted === false,
    advice: () => ({
      id: 'rep-rejected-advice',
      priority: 960,
      severity: 'moderate',
      category: 'rep-validation',
      message: 'This rep did not satisfy the movement validation checks.',
      correction: 'Reset fully and perform the next rep with a clear, controlled range of motion.',
      tags: ['validation'],
    }),
  },

  {
    id: 'advisor-major-overrides-minor',
    priority: 950,
    kind: 'selection',
    when: ({ findings }) => maxSeverity(findings) === 'major',
    select: ({ findings }) => findings.filter(f => f.severity === 'major'),
  },

  {
    id: 'advisor-moderate-over-info',
    priority: 900,
    kind: 'selection',
    when: ({ findings }) => maxSeverity(findings) === 'moderate',
    select: ({ findings }) => findings.filter(f => f.severity !== 'info'),
  },

  {
    id: 'advisor-repeat-to-recurring',
    priority: 880,
    kind: 'transform',
    when: ({ history }) => {
      const ids = (history ?? []).flatMap(x => x?.findingIds ?? [])
      const counts = new Map()
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
      return [...counts.values()].some(count => count >= 2)
    },
    transform: ({ findings, history }) => {
      const ids = (history ?? []).flatMap(x => x?.findingIds ?? [])
      const counts = new Map()
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
      return findings.map(f => counts.get(f.id) >= 2
        ? {
            ...f,
            priority: f.priority + 80,
            tags: unique([...(f.tags ?? []), 'recurring']),
          }
        : f
      )
    },
  },

  {
    id: 'advisor-same-category-collapse',
    priority: 860,
    kind: 'merge',
    when: ({ findings }) => categoryCount(findings, 'tempo') >= 2,
    merge: ({ findings }) => {
      const tempo = findings.filter(f => f.category === 'tempo')
      if (tempo.length < 2) return findings
      const keep = tempo.slice().sort((a, b) => b.priority - a.priority)[0]
      const rest = findings.filter(f => f.category !== 'tempo')
      return [{
        ...keep,
        id: `${keep.id}-merged`,
        message: 'Your rep timing needs a single clear adjustment.',
        correction: tempo.some(f => /fast|rush/i.test(f.message ?? ''))
          ? 'Prioritize a controlled descent and smooth rise rather than trying to move faster.'
          : 'Keep the movement deliberate without adding unnecessary pauses.',
        tags: unique([...tempo.flatMap(f => f.tags ?? []), 'merged']),
      }, ...rest]
    },
  },

  {
    id: 'advisor-positive-only',
    priority: 150,
    kind: 'positive',
    when: ({ findings, context }) => context?.report?.accepted === true && findings.length === 0,
    advice: () => ({
      id: 'positive-reinforcement',
      priority: 150,
      severity: 'info',
      category: 'positive',
      message: 'Your current form checks were consistent on this rep.',
      correction: 'Keep the same setup and tempo on the next rep.',
      tags: ['positive', 'reinforcement'],
    }),
  },

  {
    id: 'advisor-improvement-reinforcement',
    priority: 740,
    kind: 'trend',
    when: ({ history, findings }) => {
      if (!Array.isArray(history) || history.length < 2) return false
      const previousIds = new Set(history.at(-2)?.findingIds ?? [])
      return findings.some(f => !previousIds.has(f.id)) && previousIds.size > 0
    },
    transform: ({ findings }) => findings.map(f => ({
      ...f,
      tags: unique([...(f.tags ?? []), 'latest-relevant']),
    })),
  },

  {
    id: 'advisor-do-not-overcorrect',
    priority: 720,
    kind: 'selection',
    when: ({ findings }) => findings.length > 2,
    select: ({ findings }) => findings
      .slice()
      .sort((a, b) => ((severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0)) || (b.priority - a.priority))
      .slice(0, 2),
  },

  {
    id: 'advisor-consistency-over-isolated',
    priority: 700,
    kind: 'trend',
    when: ({ history }) => Array.isArray(history) && history.length >= 3,
    transform: ({ findings, history }) => findings.map(f => {
      const recent = history.slice(-3)
      const recurring = recent.filter(x => (x?.findingIds ?? []).includes(f.id)).length
      return recurring >= 2
        ? { ...f, priority: f.priority + 60, tags: unique([...(f.tags ?? []), 'consistent-pattern']) }
        : f
    }),
  },

  {
    id: 'advisor-fast-plus-shallow',
    priority: 940,
    kind: 'merge',
    when: ({ findings }) => hasFinding(findings, 'squat-depth-low') && hasFinding(findings, 'squat-rushed-rep'),
    merge: ({ findings }) => {
      const merged = {
        id: 'shallow-and-rushed',
        priority: 940,
        severity: 'moderate',
        category: 'synergy',
        message: 'This rep combined reduced depth with a fast tempo.',
        correction: 'On the next rep, slow the movement slightly and prioritize reaching your intended depth under control.',
        tags: ['synergy', 'depth', 'tempo'],
      }
      return [
        merged,
        ...findings.filter(
          finding =>
            finding?.id !== 'squat-depth-low' &&
            finding?.id !== 'squat-rushed-rep'
        ),
      ]
    },
  },

  {
    id: 'advisor-lean-plus-asymmetry',
    priority: 930,
    kind: 'merge',
    when: ({ findings }) => hasFinding(findings, 'squat-torso-lean') && hasFinding(findings, 'squat-asymmetry'),
    merge: ({ findings }) => {
      const merged = {
        id: 'lean-and-asymmetry',
        priority: 930,
        severity: 'moderate',
        category: 'synergy',
        message: 'The rep showed both extra torso lean and left-right movement differences.',
        correction: 'Brace your trunk and slow the next rep so both sides can follow a more even path.',
        tags: ['synergy', 'torso', 'symmetry'],
      }
      return [
        merged,
        ...findings.filter(
          finding =>
            finding?.id !== 'squat-torso-lean' &&
            finding?.id !== 'squat-asymmetry'
        ),
      ]
    },
  },

  {
    id: 'advisor-all-clean',
    priority: 140,
    kind: 'positive',
    when: ({ findings, context }) => context?.report?.accepted === true && findings.length === 1 && findings[0]?.id === 'squat-good-rep',
    advice: () => ({
      id: 'all-clean',
      priority: 140,
      severity: 'info',
      category: 'positive',
      message: 'This rep cleared the current squat form checks.',
      correction: '',
      tags: ['positive'],
    }),
  },
])

const squatSetAdviceRules = Object.freeze([
  {
    id: 'set-repeated-depth',
    priority: 900,
    when: ({ recurringFindings }) => {
      const item = recurringFindings.find(f => f.id === 'squat-depth-low')
      return (item?.count ?? 0) >= 2
    },
    advice: () => ({
      id: 'set-depth-pattern',
      priority: 900,
      severity: 'moderate',
      category: 'set-pattern',
      message: 'Depth was repeatedly below the current target across the set.',
      correction: 'Make consistent depth your first focus next set.',
      tags: ['set', 'depth', 'recurring'],
    }),
  },
  {
    id: 'set-repeated-lean',
    priority: 890,
    when: ({ recurringFindings }) => {
      const item = recurringFindings.find(f => f.id === 'squat-torso-lean')
      return (item?.count ?? 0) >= 2
    },
    advice: () => ({
      id: 'set-torso-pattern',
      priority: 890,
      severity: 'moderate',
      category: 'set-pattern',
      message: 'Extra forward torso lean appeared repeatedly across the set.',
      correction: 'Brace earlier and keep the torso more stable next set.',
      tags: ['set', 'torso', 'recurring'],
    }),
  },
  {
    id: 'set-repeated-asymmetry',
    priority: 880,
    when: ({ recurringFindings }) => {
      const item = recurringFindings.find(f => f.id === 'squat-asymmetry')
      return (item?.count ?? 0) >= 2
    },
    advice: () => ({
      id: 'set-symmetry-pattern',
      priority: 880,
      severity: 'moderate',
      category: 'set-pattern',
      message: 'Left-right movement differences appeared repeatedly across the set.',
      correction: 'Use a controlled pace and focus on an even drive from both legs.',
      tags: ['set', 'symmetry', 'recurring'],
    }),
  },
  {
    id: 'set-rushed-pattern',
    priority: 870,
    when: ({ recurringFindings }) => {
      const item = recurringFindings.find(f => f.id === 'squat-rushed-rep')
      return (item?.count ?? 0) >= 2
    },
    advice: () => ({
      id: 'set-tempo-pattern',
      priority: 870,
      severity: 'minor',
      category: 'set-pattern',
      message: 'Several reps were completed faster than the current tempo target.',
      correction: 'Use a slightly slower, more repeatable tempo next set.',
      tags: ['set', 'tempo', 'recurring'],
    }),
  },
  {
    id: 'set-high-validity',
    priority: 300,
    when: ({ summary }) => summary?.reps >= 3 && summary?.acceptedReps === summary?.reps,
    advice: () => ({
      id: 'set-high-validity',
      priority: 300,
      severity: 'info',
      category: 'set-positive',
      message: 'Every completed rep in this set passed the current validation checks.',
      correction: 'Keep the same setup and movement quality as the set progresses.',
      tags: ['set', 'positive', 'consistency'],
    }),
  },
  {
    id: 'set-mixed-validity',
    priority: 650,
    when: ({ summary }) => summary?.reps >= 3 && summary?.acceptedReps < summary?.reps,
    advice: ({ summary }) => ({
      id: 'set-mixed-validity',
      priority: 650,
      severity: 'moderate',
      category: 'set-pattern',
      message: `${summary.acceptedReps} of ${summary.reps} completed reps passed validation.`,
      correction: 'Slow down enough to make each rep clearly repeatable before adding more speed.',
      tags: ['set', 'validation', 'consistency'],
    }),
  },
  {
    id: 'set-low-validity',
    priority: 820,
    when: ({ summary }) => summary?.reps >= 3 && (summary.acceptedReps / summary.reps) < 0.5,
    advice: ({ summary }) => ({
      id: 'set-low-validity',
      priority: 820,
      severity: 'major',
      category: 'set-pattern',
      message: `Less than half of the completed reps passed validation in this set (${summary.acceptedReps}/${summary.reps}).`,
      correction: 'Prioritize a clear setup and controlled range of motion before increasing pace or load.',
      tags: ['set', 'validation', 'major'],
    }),
  },
  {
    id: 'set-recovery-of-form',
    priority: 620,
    when: ({ evaluations }) => {
      if (!Array.isArray(evaluations) || evaluations.length < 3) return false
      const last = evaluations.at(-1)?.findings ?? []
      const previous = evaluations.at(-2)?.findings ?? []
      const hadIssue = previous.some(f => f.severity === 'moderate' || f.severity === 'major')
      const cleanNow = last.every(f => f.severity === 'info')
      return hadIssue && cleanNow
    },
    advice: () => ({
      id: 'set-form-recovery',
      priority: 620,
      severity: 'info',
      category: 'set-positive',
      message: 'The latest rep was cleaner after an earlier form issue.',
      correction: 'Keep the corrected pattern consistent for the rest of the set.',
      tags: ['set', 'positive', 'recovery'],
    }),
  },
  {
    id: 'set-late-degradation',
    priority: 800,
    when: ({ evaluations }) => {
      if (!Array.isArray(evaluations) || evaluations.length < 3) return false
      const first = evaluations[0]?.findings ?? []
      const last = evaluations.at(-1)?.findings ?? []
      const firstSeverity = Math.max(...first.map(f => severityRank[f.severity] ?? 0), 0)
      const lastSeverity = Math.max(...last.map(f => severityRank[f.severity] ?? 0), 0)
      return lastSeverity > firstSeverity
    },
    advice: () => ({
      id: 'set-late-degradation',
      priority: 800,
      severity: 'moderate',
      category: 'set-pattern',
      message: 'Form quality became less consistent toward the end of the set.',
      correction: 'Treat the first sign of form loss as a cue to slow down and preserve movement quality.',
      tags: ['set', 'fatigue-pattern'],
    }),
  },
])

export const GYM_ADVICE_BOOK = Object.freeze({
  version: '2.0.0',
  philosophy: Object.freeze({
    evidenceFirst: true,
    deterministic: true,
    lowerBookFindingsAreEvidence: true,
    metaBookMayPrioritizeOrMerge: true,
    maxCorrectionsDefault: 2,
  }),
  globalRules: GLOBAL_ADVICE_RULES,
  exercises: Object.freeze({
    squat: Object.freeze({
      id: 'squat',
      name: 'Squat',
      rules: Object.freeze([...squatSetAdviceRules]),
    }),
  }),
})

export function getAdviceRules(exercise = 'squat') {
  const exerciseRules = GYM_ADVICE_BOOK.exercises?.[exercise]?.rules ?? []
  return [...GYM_ADVICE_BOOK.globalRules, ...exerciseRules]
}

export function summarizeHistory(reports = []) {
  const safeReports = Array.isArray(reports) ? reports : []
  return {
    reps: safeReports.length,
    acceptedReps: safeReports.filter(r => r?.accepted === true).length,
    rejectedReps: safeReports.filter(r => r?.accepted !== true).length,
    acceptanceRate: acceptedRatio(safeReports),
    recentReports: safeReports.slice(-5),
    findingIds: [],
  }
}

export function findRepeatedFindingIds(evaluations = []) {
  const counts = new Map()
  for (const evaluation of evaluations) {
    for (const finding of evaluation?.findings ?? []) {
      counts.set(finding.id, (counts.get(finding.id) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([id]) => id)
}
