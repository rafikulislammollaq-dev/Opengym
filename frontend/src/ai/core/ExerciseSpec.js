/**
 * ExerciseSpec
 *
 * Describes how an exercise should be interpreted by the
 * generic RepStateMachine.
 *
 * It contains exercise configuration, not the counting algorithm.
 */

export function createExerciseSpec(config) {
  if (!config || typeof config !== 'object') {
    throw new TypeError(
      'ExerciseSpec configuration must be an object.'
    )
  }

  if (!config.id) {
    throw new Error(
      'ExerciseSpec requires an id.'
    )
  }

  if (!config.name) {
    throw new Error(
      'ExerciseSpec requires a name.'
    )
  }

  if (!config.signal) {
    throw new Error(
      'ExerciseSpec requires a signal definition.'
    )
  }

  return Object.freeze({
    id: config.id,
    name: config.name,

    description: config.description ?? '',

    signal: config.signal,

    direction:
      config.direction ?? 'high-low-high',

    thresholds: Object.freeze({
      ready:
        config.thresholds?.ready ?? 150,

      start:
        config.thresholds?.start ?? 135,

      extreme:
        config.thresholds?.extreme ?? 105,

      return:
        config.thresholds?.return ?? 125,

      lockout:
        config.thresholds?.lockout ?? 160,
    }),

    validation: Object.freeze({
      minRom:
        config.validation?.minRom ?? 40,

      minDurationMs:
        config.validation?.minDurationMs ?? 300,

      maxDurationMs:
        config.validation?.maxDurationMs ?? 10000,

      requireReadyReset:
        config.validation?.requireReadyReset ?? true,
    }),

    requiredLandmarks:
      Object.freeze(
        [...(config.requiredLandmarks ?? [])]
      ),

    bilateral:
      config.bilateral ?? false,

    camera: Object.freeze({
      preferredView:
        config.camera?.preferredView ?? 'any',

      fullBodyRequired:
        config.camera?.fullBodyRequired ?? true,
    }),

    formRules:
      Object.freeze(
        [...(config.formRules ?? [])]
      ),
  })
}

/**
 * Converts an ExerciseSpec to the configuration expected
 * by RepStateMachine.
 */
export function toRepMachineConfig(spec) {
  if (!spec) {
    throw new Error(
      'Cannot create rep-machine config from empty spec.'
    )
  }

  return {
    direction: spec.direction,

    readyThreshold:
      spec.thresholds.ready,

    descendingThreshold:
      spec.thresholds.start,

    bottomThreshold:
      spec.thresholds.extreme,

    ascendingThreshold:
      spec.thresholds.return,

    lockoutThreshold:
      spec.thresholds.lockout,

    minRom:
      spec.validation.minRom,

    minDurationMs:
      spec.validation.minDurationMs,

    maxDurationMs:
      spec.validation.maxDurationMs,

    requireReadyReset:
      spec.validation.requireReadyReset,
  }
}