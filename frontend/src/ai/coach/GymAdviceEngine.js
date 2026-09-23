// src/ai/coach/GymAdviceEngine.js
// Deterministic meta-adviser: judges the findings produced by the lower-level
// exercise coaching rules and decides what advice should actually survive.

import { getAdviceRules } from './GymAdviceBook.js'

const severityRank = Object.freeze({
  info: 0,
  minor: 1,
  moderate: 2,
  major: 3,
})

function safeSeverity(value) {
  return value in severityRank ? value : 'info'
}

function sortAdvice(items = []) {
  return items.slice().sort((a, b) => {
    const severityDelta = (severityRank[safeSeverity(b.severity)] ?? 0) - (severityRank[safeSeverity(a.severity)] ?? 0)
    return severityDelta || ((b.priority ?? 0) - (a.priority ?? 0))
  })
}

function dedupe(items = []) {
  const seen = new Set()
  const output = []
  for (const item of items) {
    if (!item || !item.message) continue
    const key = `${item.id}|${item.message}|${item.correction ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }
  return output
}

function toFindingIds(findings = []) {
  return findings.map(f => f?.id).filter(Boolean)
}

export class GymAdviceEngine {
  constructor({ rules = getAdviceRules('squat'), maxAdvice = 2 } = {}) {
    if (!Array.isArray(rules)) throw new TypeError('rules must be an array')
    if (!Number.isInteger(maxAdvice) || maxAdvice <= 0) {
      throw new RangeError('maxAdvice must be a positive integer')
    }
    this.rules = [...rules]
    this.maxAdvice = maxAdvice
  }

  judgeRep({ exercise = 'squat', report = {}, findings = [], history = [] } = {}) {
    const context = {
      exercise,
      report,
      findings: [...findings],
      history: [...history],
    }

    let working = [...findings]
    let gates = []
    let generated = []
    const appliedRules = []

    for (const rule of this.rules) {
      if (!rule || typeof rule.when !== 'function') continue

      let matched = false
      try {
        matched = !!rule.when({ context, findings: working, history })
      } catch {
        matched = false
      }
      if (!matched) continue

      appliedRules.push(rule.id ?? 'unnamed-rule')

      try {
        if (rule.kind === 'gate' && typeof rule.advice === 'function') {
          gates.push(rule.advice({ context, findings: working, history }))
        }

        if (rule.kind === 'selection' && typeof rule.select === 'function') {
          working = rule.select({ context, findings: working, history }) ?? working
        }

        if (rule.kind === 'transform' && typeof rule.transform === 'function') {
          working = rule.transform({ context, findings: working, history }) ?? working
        }

        if (rule.kind === 'merge' && typeof rule.merge === 'function') {
          const beforeIds = new Set(working.map(finding => finding?.id).filter(Boolean))
          const merged = rule.merge({ context, findings: working, history })

          if (Array.isArray(merged)) {
            // Merge rules may return one or more higher-level advice objects
            // followed by the lower-level findings that should remain active.
            // Keep the returned advice as advice instead of wrapping it as a
            // normal finding (which would produce ids like `finding:...`).
            const mergedAdvice = merged.filter(item =>
              item?.id &&
              item?.message &&
              item?.correction &&
              !beforeIds.has(item.id)
            )

            if (mergedAdvice.length > 0) {
              generated.push(...mergedAdvice)
            }

            working = merged.filter(item => beforeIds.has(item?.id))
          } else if (Array.isArray(merged?.findings)) {
            generated.push(...(Array.isArray(merged.advice) ? merged.advice : []))
            working = merged.findings
          } else {
            working = merged ?? working
          }
        }

        if (rule.kind === 'synergy' && typeof rule.advice === 'function') {
          generated.push(rule.advice({ context, findings: working, history }))
        }

        if (rule.kind === 'positive' && typeof rule.advice === 'function') {
          generated.push(rule.advice({ context, findings: working, history }))
        }

        if (rule.kind === 'validation' && typeof rule.advice === 'function') {
          generated.push(rule.advice({ context, findings: working, history }))
        }
      } catch {
        // A bad advice rule must never break a live workout.
      }
    }

    if (gates.length > 0) {
      generated = gates
      working = []
    }

    for (const finding of working) {
      if (!finding?.correction) continue
      generated.push({
        id: `finding:${finding.id}`,
        priority: finding.priority ?? 0,
        severity: safeSeverity(finding.severity),
        category: finding.category ?? 'general',
        message: finding.message,
        correction: finding.correction,
        tags: [...(finding.tags ?? [])],
        sourceFindingId: finding.id,
      })
    }

    generated = dedupe(sortAdvice(generated))

    const selected = generated.slice(0, this.maxAdvice)
    const suppressed = generated.slice(this.maxAdvice)

    return {
      exercise,
      inputFindingIds: toFindingIds(findings),
      judgedFindingIds: toFindingIds(working),
      advice: selected,
      suppressedAdvice: suppressed,
      appliedRules,
      historyDepth: history.length,
    }
  }

  judgeSet({ exercise = 'squat', summary = {}, evaluations = [], recurringFindings = [] } = {}) {
    const reports = evaluations.map(e => ({
      accepted: e?.accepted,
      findings: e?.findings ?? [],
    }))

    const context = {
      exercise,
      summary,
      evaluations,
      recurringFindings,
      history: reports,
    }

    const generated = []
    const appliedRules = []

    for (const rule of this.rules) {
      if (!rule || typeof rule.when !== 'function' || typeof rule.advice !== 'function') continue

      let matched = false
      try {
        matched = !!rule.when(context)
      } catch {
        matched = false
      }
      if (!matched) continue

      if (rule.kind !== undefined && !['trend', 'set-pattern', 'positive', 'selection', 'merge', 'synergy'].includes(rule.kind)) continue

      appliedRules.push(rule.id ?? 'unnamed-rule')

      try {
        const advice = rule.advice(context)
        if (advice) generated.push(advice)
      } catch {
        // Ignore faulty optional advice rule.
      }
    }

    const advice = dedupe(sortAdvice(generated)).slice(0, this.maxAdvice)

    return {
      exercise,
      advice,
      appliedRules,
    }
  }
}

export function createGymAdviceEngine(options) {
  return new GymAdviceEngine(options)
}
