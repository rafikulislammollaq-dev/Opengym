import {
  calculatePoseQuality,
  isLandmarkVisible,
} from '../pose/PoseQuality.js'

import {
  extractExerciseFeatures,
  getFeatureSignal,
  POSE_LANDMARKS,
} from '../features/ExerciseFeatures.js'

import {
  RepStateMachine,
} from '../core/RepStateMachine.js'

import {
  SQUAT_SPEC,
  SQUAT_REP_CONFIG,
} from './SquatSpec.js'


const REQUIRED_VISIBILITY = 0.55

const LANDMARK_NAMES = Object.freeze({
  leftHip: POSE_LANDMARKS.LEFT_HIP,
  rightHip: POSE_LANDMARKS.RIGHT_HIP,

  leftKnee: POSE_LANDMARKS.LEFT_KNEE,
  rightKnee: POSE_LANDMARKS.RIGHT_KNEE,

  leftAnkle: POSE_LANDMARKS.LEFT_ANKLE,
  rightAnkle: POSE_LANDMARKS.RIGHT_ANKLE,

  leftShoulder: POSE_LANDMARKS.LEFT_SHOULDER,
  rightShoulder: POSE_LANDMARKS.RIGHT_SHOULDER,
})


/**
 * Analyze one complete squat session.
 *
 * This class deliberately has no React dependency.
 *
 * Input:
 *   PoseFrame
 *
 * Output:
 *   structured squat telemetry
 *
 * Pipeline:
 *
 * PoseFrame
 *    ↓
 * quality
 *    ↓
 * exercise features
 *    ↓
 * knee signal
 *    ↓
 * generic rep state machine
 *    ↓
 * squat telemetry
 */
export class SquatAnalyzer {
  constructor({
    poseQualityVisibility = 0.5,
    requiredLandmarkVisibility =
      REQUIRED_VISIBILITY,
    repConfig = SQUAT_REP_CONFIG,
  } = {}) {
    this.poseQualityVisibility =
      poseQualityVisibility

    this.requiredLandmarkVisibility =
      requiredLandmarkVisibility

    this.repEngine =
      new RepStateMachine(repConfig)

    this.previousState =
      this.repEngine.state

    this.activeRep = null

    this.lastRep = null

    this.totalFrames = 0

    this.validFrames = 0
  }


  /**
   * Reset the complete analysis session.
   */
  reset() {
    this.repEngine.reset()

    this.previousState =
      this.repEngine.state

    this.activeRep = null

    this.lastRep = null

    this.totalFrames = 0

    this.validFrames = 0
  }


  /**
   * Analyze one processed pose frame.
   */
  update(poseFrame) {
    this.totalFrames += 1

    const quality =
      calculatePoseQuality(
        poseFrame,
        this.poseQualityVisibility
      )

    const requiredVisibility =
      this._checkRequiredLandmarks(
        poseFrame
      )

    const usable =
      quality.valid &&
      requiredVisibility.valid

    if (!usable) {
      return this._buildResult({
        poseFrame,
        quality,
        requiredVisibility,
        features: null,
        repResult: null,
      })
    }

    this.validFrames += 1

    const features =
      extractExerciseFeatures(
        poseFrame
      )

    const signal =
      getFeatureSignal(
        features,
        SQUAT_SPEC.signal
      )

    if (!Number.isFinite(signal)) {
      return this._buildResult({
        poseFrame,
        quality,
        requiredVisibility,
        features,
        repResult: null,
      })
    }

    const timestamp =
      Number.isFinite(poseFrame?.timestampMs)
        ? poseFrame.timestampMs
        : performance.now()

    const previousState =
      this.repEngine.state

    const repResult =
      this.repEngine.update(
        signal,
        timestamp,
        usable
      )

    const currentState =
      repResult.state

    this._updateActiveRep(
      previousState,
      currentState,
      signal,
      features,
      timestamp
    )

    if (repResult.repCompleted) {
      this.lastRep =
        this._finishActiveRep(
          repResult,
          signal,
          features,
          timestamp
        )

      this.activeRep = null
    }

    this.previousState =
      currentState

    return this._buildResult({
      poseFrame,
      quality,
      requiredVisibility,
      features,
      repResult,
    })
  }


  /**
   * Check the landmarks that are specifically necessary
   * for bilateral squat analysis.
   *
   * Global pose quality alone is not enough:
   * a frame may contain many visible landmarks while
   * one knee or ankle is still occluded.
   */
  _checkRequiredLandmarks(
    poseFrame
  ) {
    const landmarks =
      poseFrame?.landmarks ?? []

    const missing = []

    for (const [name, index] of
      Object.entries(LANDMARK_NAMES)) {
      const landmark =
        landmarks[index]

      if (
        !isLandmarkVisible(
          landmark,
          this.requiredLandmarkVisibility
        )
      ) {
        missing.push(name)
      }
    }

    return {
      valid: missing.length === 0,
      missing,
    }
  }


  /**
   * Start collecting per-rep information once the
   * state machine leaves READY.
   */
  _updateActiveRep(
    previousState,
    currentState,
    signal,
    features,
    timestamp
  ) {
    const beganRep =
      previousState === 'ready' &&
      (
        currentState === 'descending'
      )

    if (beganRep && !this.activeRep) {
      this.activeRep = {
        startTimestamp: timestamp,

        startKneeAngle: signal,

        minimumKneeAngle: signal,

        maximumKneeAngle: signal,

        minimumLeftKneeAngle:
          Number.isFinite(
            features?.knees?.left
          )
            ? features.knees.left
            : null,

        minimumRightKneeAngle:
          Number.isFinite(
            features?.knees?.right
          )
            ? features.knees.right
            : null,

        maximumKneeAsymmetry:
          this._calculateKneeAsymmetry(
            features
          ),

        samples: 1,
      }

      return
    }

    if (!this.activeRep) {
      return
    }

    this.activeRep.samples += 1

    this.activeRep.minimumKneeAngle =
      Math.min(
        this.activeRep.minimumKneeAngle,
        signal
      )

    this.activeRep.maximumKneeAngle =
      Math.max(
        this.activeRep.maximumKneeAngle,
        signal
      )

    const left =
      features?.knees?.left

    const right =
      features?.knees?.right

    if (Number.isFinite(left)) {
      if (
        !Number.isFinite(
          this.activeRep.minimumLeftKneeAngle
        )
      ) {
        this.activeRep.minimumLeftKneeAngle =
          left
      } else {
        this.activeRep.minimumLeftKneeAngle =
          Math.min(
            this.activeRep.minimumLeftKneeAngle,
            left
          )
      }
    }

    if (Number.isFinite(right)) {
      if (
        !Number.isFinite(
          this.activeRep.minimumRightKneeAngle
        )
      ) {
        this.activeRep.minimumRightKneeAngle =
          right
      } else {
        this.activeRep.minimumRightKneeAngle =
          Math.min(
            this.activeRep.minimumRightKneeAngle,
            right
          )
      }
    }

    this.activeRep.maximumKneeAsymmetry =
      Math.max(
        this.activeRep.maximumKneeAsymmetry,
        this._calculateKneeAsymmetry(
          features
        )
      )
  }


  /**
   * Complete a rep and create an immutable
   * per-repetition summary.
   */
  _finishActiveRep(
    repResult,
    finalSignal,
    features,
    timestamp
  ) {
    const active =
      this.activeRep

    if (!active) {
      return Object.freeze({
        number: repResult.reps,

        accepted:
          repResult.repAccepted,

        rom:
          repResult.rom,

        durationMs:
          repResult.durationMs,

        startKneeAngle:
          null,

        minimumKneeAngle:
          null,

        finalKneeAngle:
          finalSignal,

        maximumKneeAsymmetry:
          this._calculateKneeAsymmetry(
            features
          ),

        samples: 0,
      })
    }

    const calculatedDuration =
      Math.max(
        0,
        timestamp -
          active.startTimestamp
      )

    const durationMs =
      Number.isFinite(
        repResult.durationMs
      )
        ? repResult.durationMs
        : calculatedDuration

    const rom =
      Number.isFinite(
        repResult.rom
      )
        ? repResult.rom
        : Math.max(
            0,
            active.startKneeAngle -
              active.minimumKneeAngle
          )

    return Object.freeze({
      number: repResult.reps,

      accepted:
        repResult.repAccepted,

      rom,

      durationMs,

      startKneeAngle:
        active.startKneeAngle,

      minimumKneeAngle:
        active.minimumKneeAngle,

      finalKneeAngle:
        finalSignal,

      minimumLeftKneeAngle:
        active.minimumLeftKneeAngle,

      minimumRightKneeAngle:
        active.minimumRightKneeAngle,

      maximumKneeAsymmetry:
        active.maximumKneeAsymmetry,

      samples:
        active.samples,
    })
  }


  /**
   * Difference between left/right knee angles.
   *
   * This is telemetry for now.
   * It is intentionally NOT converted into a
   * "bad form" judgment here.
   */
  _calculateKneeAsymmetry(
    features
  ) {
    const left =
      features?.knees?.left

    const right =
      features?.knees?.right

    if (
      !Number.isFinite(left) ||
      !Number.isFinite(right)
    ) {
      return 0
    }

    return Math.abs(left - right)
  }


  /**
   * Build a stable result object for the UI/debugger.
   */
  _buildResult({
    poseFrame,
    quality,
    requiredVisibility,
    features,
    repResult,
  }) {
    return Object.freeze({
      exercise: SQUAT_SPEC.id,

      timestampMs:
        poseFrame?.timestampMs ?? null,

      tracking: {
        usable:
          quality.valid &&
          requiredVisibility.valid,

        poseQuality:
          quality,

        requiredLandmarks:
          requiredVisibility,
      },

      phase:
        repResult?.state ??
        this.repEngine.state,

      reps:
        repResult?.reps ??
        this.repEngine.reps,

      signal:
        features
          ? features.averageKneeAngle
          : null,

      knee: {
        left:
          features?.knees?.left ?? null,

        right:
          features?.knees?.right ?? null,

        average:
          features?.knees?.average ?? null,
      },

      hips: {
        left:
          features?.hips?.left ?? null,

        right:
          features?.hips?.right ?? null,

        average:
          features?.hips?.average ?? null,
      },

      repEvent:
        repResult
          ? {
              completed:
                repResult.repCompleted,

              accepted:
                repResult.repAccepted,

              reason:
                repResult.reason,

              rom:
                repResult.rom,

              durationMs:
                repResult.durationMs,
            }
          : null,

      latestRep:
        this.lastRep,

      activeRep:
        this.activeRep
          ? {
              startKneeAngle:
                this.activeRep
                  .startKneeAngle,

              minimumKneeAngle:
                this.activeRep
                  .minimumKneeAngle,

              maximumKneeAsymmetry:
                this.activeRep
                  .maximumKneeAsymmetry,

              samples:
                this.activeRep.samples,
            }
          : null,

      session: {
        totalFrames:
          this.totalFrames,

        validFrames:
          this.validFrames,
      },
    })
  }
}