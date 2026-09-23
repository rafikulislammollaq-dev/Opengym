import { describe, expect, it } from 'vitest'
import {
  createExerciseSpec,
  toRepMachineConfig,
} from './ExerciseSpec.js'

describe('ExerciseSpec', () => {
  it('creates a valid specification', () => {
    const spec = createExerciseSpec({
      id: 'squat',
      name: 'Squat',
      signal: 'averageKneeAngle',
    })

    expect(spec.id).toBe('squat')
    expect(spec.name).toBe('Squat')
    expect(spec.signal).toBe('averageKneeAngle')
  })

  it('rejects a missing id', () => {
    expect(() =>
      createExerciseSpec({
        name: 'Squat',
        signal: 'averageKneeAngle',
      })
    ).toThrow()
  })

  it('rejects a missing name', () => {
    expect(() =>
      createExerciseSpec({
        id: 'squat',
        signal: 'averageKneeAngle',
      })
    ).toThrow()
  })

  it('rejects a missing signal', () => {
    expect(() =>
      createExerciseSpec({
        id: 'squat',
        name: 'Squat',
      })
    ).toThrow()
  })

  it('preserves custom configuration', () => {
    const spec = createExerciseSpec({
      id: 'squat',
      name: 'Squat',
      signal: 'averageKneeAngle',

      direction: 'high-low-high',

      thresholds: {
        ready: 165,
        start: 140,
        extreme: 100,
        return: 125,
        lockout: 160,
      },

      validation: {
        minRom: 55,
        minDurationMs: 350,
        maxDurationMs: 6000,
        requireReadyReset: true,
      },

      requiredLandmarks: [
        'leftHip',
        'leftKnee',
        'leftAnkle',
        'rightHip',
        'rightKnee',
        'rightAnkle',
      ],

      bilateral: true,

      camera: {
        preferredView: 'side',
        fullBodyRequired: true,
      },

      formRules: [
        'depth',
        'torsoLean',
        'kneeAlignment',
      ],
    })

    expect(spec.thresholds.extreme).toBe(100)
    expect(spec.validation.minRom).toBe(55)
    expect(spec.bilateral).toBe(true)
    expect(spec.formRules).toEqual([
      'depth',
      'torsoLean',
      'kneeAlignment',
    ])
  })

  it('converts spec to rep-machine configuration', () => {
    const spec = createExerciseSpec({
      id: 'squat',
      name: 'Squat',
      signal: 'averageKneeAngle',

      thresholds: {
        ready: 165,
        start: 140,
        extreme: 100,
        return: 125,
        lockout: 160,
      },

      validation: {
        minRom: 55,
        minDurationMs: 350,
        maxDurationMs: 6000,
      },
    })

    const config = toRepMachineConfig(spec)

    expect(config).toEqual({
      direction: 'high-low-high',
      readyThreshold: 165,
      descendingThreshold: 140,
      bottomThreshold: 100,
      ascendingThreshold: 125,
      lockoutThreshold: 160,
      minRom: 55,
      minDurationMs: 350,
      maxDurationMs: 6000,
      requireReadyReset: true,
    })
  })
})