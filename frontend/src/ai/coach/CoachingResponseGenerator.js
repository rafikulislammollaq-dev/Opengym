// src/ai/coach/CoachingResponseGenerator.js
// Turns deterministic findings into concise human-facing coaching.

import { CoachingRuleEngine } from './CoachingRuleEngine.js'

const OPENERS = [
  'Nice work.',
  'Good rep.',
  'Solid effort.',
]

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function pickFrom(list, index = 0) {
  return list[clamp(index, 0, list.length - 1)] ?? list[0]
}

export class CoachingResponseGenerator {
  constructor({ maxCorrections = 2 } = {}) {
    this.maxCorrections = maxCorrections
  }

  forRep({ report, findings = [] } = {}) {
    const accepted = report?.accepted === true
    const corrections = CoachingRuleEngine.pickTopCorrections(
      findings,
      this.maxCorrections
    )

    if (!accepted) {
      const primary = corrections[0]
        ?? 'Reset at the starting position and repeat the movement with a clear, controlled range of motion.'

      return `Rep not counted. ${primary}`
    }

    if (corrections.length === 0) {
      return `${pickFrom(OPENERS, (report?.repNumber ?? 1) % OPENERS.length)} Your rep met the current form checks.`
    }

    if (corrections.length === 1) {
      return `Good rep. ${corrections[0]}`
    }

    return `Good rep. ${corrections[0]} ${corrections[1]}`
  }

  forSet({ summary, findings = [] } = {}) {
    const reps = Number.isFinite(summary?.reps) ? summary.reps : 0
    const accepted = Number.isFinite(summary?.acceptedReps)
      ? summary.acceptedReps
      : reps

    const corrections = CoachingRuleEngine.pickTopCorrections(
      findings,
      this.maxCorrections
    )

    if (reps <= 0) {
      return 'No completed reps were available for coaching yet.'
    }

    let opening = `${reps} reps completed.`
    if (accepted !== reps) {
      opening = `${reps} reps completed, ${accepted} counted as valid.`
    }

    if (corrections.length === 0) {
      return `${opening} Your current form checks were consistent across the set.`
    }

    return `${opening} ${corrections.join(' ')}`
  }
}
