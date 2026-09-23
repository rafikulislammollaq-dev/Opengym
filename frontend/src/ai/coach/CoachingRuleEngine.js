// src/ai/coach/CoachingRuleEngine.js
// Deterministic rule engine for gym coaching.
// No network, no LLM, no randomness.

function safeSeverity(value) {
  return ['info', 'minor', 'moderate', 'major'].includes(value)
    ? value
    : 'info'
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : null
}

function stableKey(item) {
  return [
    item.exercise ?? '',
    item.id ?? '',
    item.category ?? '',
    item.message ?? '',
  ].join('|')
}

export class CoachingRuleEngine {
  constructor({ rules = [], maxFindings = 8 } = {}) {
    if (!Array.isArray(rules)) {
      throw new TypeError('rules must be an array')
    }

    if (!Number.isInteger(maxFindings) || maxFindings <= 0) {
      throw new RangeError('maxFindings must be a positive integer')
    }

    this.rules = [...rules]
    this.maxFindings = maxFindings
  }

  evaluate(context = {}) {
    const findings = []

    for (const rule of this.rules) {
      if (!rule || typeof rule.when !== 'function') {
        continue
      }

      let matched = false

      try {
        matched = !!rule.when(context)
      } catch {
        matched = false
      }

      if (!matched) {
        continue
      }

      findings.push({
        id: rule.id ?? 'unnamed_rule',
        exercise: context.exercise ?? rule.exercise ?? null,
        category: rule.category ?? 'general',
        severity: safeSeverity(rule.severity),
        priority: Number.isFinite(rule.priority) ? rule.priority : 0,
        message: typeof rule.message === 'function'
          ? rule.message(context)
          : String(rule.message ?? ''),
        correction: typeof rule.correction === 'function'
          ? rule.correction(context)
          : String(rule.correction ?? ''),
        evidence: typeof rule.evidence === 'function'
          ? rule.evidence(context)
          : (rule.evidence ?? null),
        tags: Array.isArray(rule.tags) ? [...rule.tags] : [],
      })
    }

    const deduped = []
    const seen = new Set()

    for (const finding of findings
      .filter(item => item.message)
      .sort((a, b) => b.priority - a.priority)) {
      const key = stableKey(finding)
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(finding)
      if (deduped.length >= this.maxFindings) break
    }

    return deduped
  }

  static summarizeFindings(findings = []) {
    const counts = {
      info: 0,
      minor: 0,
      moderate: 0,
      major: 0,
    }

    for (const finding of findings) {
      const severity = safeSeverity(finding?.severity)
      counts[severity] += 1
    }

    return counts
  }

  static pickTopCorrections(findings = [], maxCorrections = 2) {
    if (!Number.isInteger(maxCorrections) || maxCorrections <= 0) {
      return []
    }

    return findings
      .filter(item => item?.correction)
      .sort((a, b) => {
        const severityRank = {
          info: 0,
          minor: 1,
          moderate: 2,
          major: 3,
        }
        return (
          (severityRank[b.severity] - severityRank[a.severity]) ||
          (b.priority - a.priority)
        )
      })
      .slice(0, maxCorrections)
      .map(item => item.correction)
  }
}

export function pickMetric(context, ...keys) {
  for (const key of keys) {
    const value = context?.[key]
    const n = safeNumber(value)
    if (n !== null) return n
  }

  return null
}
