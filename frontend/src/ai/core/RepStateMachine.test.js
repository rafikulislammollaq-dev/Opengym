import { describe, expect, it } from 'vitest'
import {
  RepStateMachine,
  REP_STATES,
} from './RepStateMachine.js'

const config = {
  direction: 'high-low-high',

  readyThreshold: 150,
  descendingThreshold: 135,
  bottomThreshold: 105,
  ascendingThreshold: 125,
  lockoutThreshold: 160,

  minRom: 60,
  minDurationMs: 300,
  maxDurationMs: 5000,

  requireReadyReset: true,
}

function createMachine() {
  return new RepStateMachine(config)
}

function feed(machine, samples) {
  let last = null

  for (const sample of samples) {
    last = machine.update(
      sample.signal,
      sample.time
    )
  }

  return last
}

describe('RepStateMachine', () => {
  it('starts in INIT', () => {
    const machine = createMachine()

    expect(machine.state).toBe(REP_STATES.INIT)
    expect(machine.reps).toBe(0)
  })

  it('enters READY when the signal reaches the starting zone', () => {
    const machine = createMachine()

    const result = machine.update(170, 0)

    expect(result.state).toBe(REP_STATES.READY)
    expect(result.reason).toBe('ready_detected')
  })

  it('counts one complete valid repetition', () => {
    const machine = createMachine()

    const result = feed(machine, [
      { signal: 170, time: 0 },
      { signal: 130, time: 100 },
      { signal: 100, time: 250 },
      { signal: 135, time: 400 },
      { signal: 165, time: 600 },
    ])

    expect(result.repCompleted).toBe(true)
    expect(result.repAccepted).toBe(true)
    expect(result.reason).toBe('rep_accepted')
    expect(result.rom).toBeGreaterThanOrEqual(40)
    expect(result.durationMs).toBeGreaterThanOrEqual(300)
    expect(result.reps).toBe(1)
  })

  it('does not count a shallow movement', () => {
    const machine = createMachine()

    const result = feed(machine, [
      { signal: 170, time: 0 },
      { signal: 130, time: 100 },
      { signal: 120, time: 250 },
      { signal: 140, time: 400 },
      { signal: 165, time: 600 },
    ])

    expect(result.repCompleted).toBe(true)
    expect(result.repAccepted).toBe(false)
    expect(result.reps).toBe(0)
    expect(result.reason).toBe('rep_rejected_rom')
  })

  it('does not count a movement that is too fast', () => {
    const machine = createMachine()

    const result = feed(machine, [
      { signal: 170, time: 0 },
      { signal: 130, time: 20 },
      { signal: 100, time: 40 },
      { signal: 125, time: 60 },
      { signal: 165, time: 100 },
    ])

    expect(result.repCompleted).toBe(true)
    expect(result.repAccepted).toBe(false)
    expect(result.reps).toBe(0)
    expect(result.reason).toBe('rep_rejected_duration')
  })

  it('does not create repeated reps while remaining at lockout', () => {
    const machine = createMachine()

    feed(machine, [
      { signal: 170, time: 0 },
      { signal: 130, time: 100 },
      { signal: 100, time: 300 },
      { signal: 130, time: 500 },
      { signal: 165, time: 700 },
    ])

    expect(machine.reps).toBe(1)

    machine.update(168, 800)
    machine.update(170, 900)
    machine.update(165, 1000)

    expect(machine.reps).toBe(1)
  })

  it('ignores invalid pose-quality frames', () => {
    const machine = createMachine()

    machine.update(170, 0)

    const result = machine.update(
      90,
      100,
      false
    )

    expect(result.reason).toBe('invalid_pose_quality')
    expect(result.reps).toBe(0)
  })

  it('rejects a non-monotonic timestamp', () => {
    const machine = createMachine()

    machine.update(170, 100)

    const result = machine.update(170, 50)

    expect(result.reason).toBe(
      'non_monotonic_timestamp'
    )
  })

  it('can be reset completely', () => {
    const machine = createMachine()

    feed(machine, [
      { signal: 170, time: 0 },
      { signal: 130, time: 100 },
      { signal: 100, time: 300 },
      { signal: 130, time: 500 },
      { signal: 165, time: 700 },
    ])

    expect(machine.reps).toBe(1)

    machine.reset()

    expect(machine.state).toBe(REP_STATES.INIT)
    expect(machine.reps).toBe(0)
  })
})