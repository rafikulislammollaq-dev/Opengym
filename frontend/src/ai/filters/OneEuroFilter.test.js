import { describe, expect, it } from 'vitest'
import {
  OneEuroFilter,
  OneEuroLandmarkFilter,
} from './OneEuroFilter.js'

describe('OneEuroFilter', () => {
  it('returns the first value unchanged', () => {
    const filter = new OneEuroFilter()

    expect(filter.filter(10, 0)).toBe(10)
  })

  it('produces finite values for a normal signal', () => {
    const filter = new OneEuroFilter()

    const values = [10, 11, 12, 13, 14]
    const outputs = values.map((value, index) =>
      filter.filter(value, index * 33.33)
    )

    for (const value of outputs) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('follows a constant signal', () => {
    const filter = new OneEuroFilter()

    let output = null

    for (let i = 0; i < 30; i++) {
      output = filter.filter(50, i * 33.33)
    }

    expect(output).toBeCloseTo(50, 5)
  })

  it('smooths an abrupt change instead of jumping immediately', () => {
    const filter = new OneEuroFilter({
      minCutoff: 1,
      beta: 0,
    })

    filter.filter(0, 0)

    const output = filter.filter(100, 33.33)

    expect(output).toBeGreaterThan(0)
    expect(output).toBeLessThan(100)
  })

  it('can be reset', () => {
    const filter = new OneEuroFilter()

    filter.filter(10, 0)
    filter.filter(20, 33.33)

    filter.reset()

    expect(filter.filter(75, 100)).toBe(75)
  })
})

describe('OneEuroLandmarkFilter', () => {
  it('filters x, y and z independently', () => {
    const filter = new OneEuroLandmarkFilter()

    const first = filter.filter(
      {
        x: 0.2,
        y: 0.4,
        z: -0.1,
        visibility: 1,
      },
      0
    )

    expect(first.x).toBeCloseTo(0.2)
    expect(first.y).toBeCloseTo(0.4)
    expect(first.z).toBeCloseTo(-0.1)
    expect(first.visibility).toBe(1)
  })
})