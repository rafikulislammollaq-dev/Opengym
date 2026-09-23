import {
  createExerciseSpec,
  toRepMachineConfig,
} from '../core/ExerciseSpec.js'


export const SQUAT_SPEC =
  createExerciseSpec({
    id: 'squat',

    name: 'Squat',

    description:
      'Bilateral squat tracked primarily using average knee angle.',

    signal:
      'averageKneeAngle',

    direction:
      'high-low-high',

    thresholds: {
      ready: 165,

      start: 140,

      extreme: 100,

      return: 125,

      lockout: 160,
    },

    validation: {
      minRom: 60,

      minDurationMs: 300,

      maxDurationMs: 6000,

      requireReadyReset: true,
    },

    requiredLandmarks: [
      'leftHip',
      'rightHip',
      'leftKnee',
      'rightKnee',
      'leftAnkle',
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


export const SQUAT_REP_CONFIG =
  toRepMachineConfig(
    SQUAT_SPEC
  )