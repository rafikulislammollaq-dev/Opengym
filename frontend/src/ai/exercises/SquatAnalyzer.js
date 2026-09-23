// src/ai/exercises/SquatAnalyzer.js

import { SquatCalibration } from './SquatCalibration.js';
import { SQUAT_SPEC } from './SquatSpec.js';
import { RepStateMachine } from '../core/RepStateMachine.js';
import * as FeatureAPI from '../features/ExerciseFeatures.js';

/* -------------------------------------------------------------------------- */
/* Feature extractor                                                          */
/* -------------------------------------------------------------------------- */

const extractExerciseFeatures =
  FeatureAPI.extractExerciseFeatures ??
  FeatureAPI.extractFeatures ??
  FeatureAPI.extractFeaturesFromPose;

if (typeof extractExerciseFeatures !== 'function') {
  throw new Error(
    'ExerciseFeatures does not expose a supported feature extraction function'
  );
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function getTimestampMs(poseFrame) {
  if (!poseFrame) {
    return null;
  }

  if (isFiniteNumber(poseFrame.timestampMs)) {
    return poseFrame.timestampMs;
  }

  if (isFiniteNumber(poseFrame.timestamp)) {
    return poseFrame.timestamp;
  }

  return null;
}

function getLandmarks(poseFrame) {
  if (!poseFrame) {
    return null;
  }

  return (
    poseFrame.landmarks ??
    poseFrame.poseLandmarks ??
    null
  );
}

function hasUsablePose(poseFrame) {
  if (!poseFrame) {
    return false;
  }

  if (poseFrame.hasPose === false) {
    return false;
  }

  const landmarks =
    getLandmarks(poseFrame);

  return (
    Array.isArray(landmarks) &&
    landmarks.length > 0
  );
}

function getVisibility(landmark) {
  if (!landmark) {
    return 0;
  }

  if (isFiniteNumber(landmark.visibility)) {
    return landmark.visibility;
  }

  if (isFiniteNumber(landmark.presence)) {
    return landmark.presence;
  }

  return 1;
}

/* -------------------------------------------------------------------------- */
/* Required MediaPipe landmarks                                               */
/* -------------------------------------------------------------------------- */

const REQUIRED_LANDMARKS = Object.freeze([
  23, // left hip
  24, // right hip
  25, // left knee
  26, // right knee
  27, // left ankle
  28, // right ankle
]);

const REQUIRED_LANDMARK_NAMES = Object.freeze({
  23: 'leftHip',
  24: 'rightHip',
  25: 'leftKnee',
  26: 'rightKnee',
  27: 'leftAnkle',
  28: 'rightAnkle',
});

function checkRequiredLandmarks(poseFrame) {
  const landmarks =
    getLandmarks(poseFrame);

  if (!Array.isArray(landmarks)) {
    return {
      valid: false,

      visibleCount: 0,

      requiredCount:
        REQUIRED_LANDMARKS.length,

      missing:
        REQUIRED_LANDMARKS.map(
          (index) =>
            REQUIRED_LANDMARK_NAMES[index] ??
            index
        ),
    };
  }

  const missing = [];

  let visibleCount = 0;

  for (const index of REQUIRED_LANDMARKS) {
    const landmark =
      landmarks[index];

    const visible =
      !!landmark &&
      getVisibility(landmark) >= 0.35;

    if (visible) {
      visibleCount += 1;
    } else {
      missing.push(
        REQUIRED_LANDMARK_NAMES[index] ??
        index
      );
    }
  }

  return {
    valid:
      visibleCount ===
      REQUIRED_LANDMARKS.length,

    visibleCount,

    requiredCount:
      REQUIRED_LANDMARKS.length,

    missing,
  };
}

/* -------------------------------------------------------------------------- */
/* Pose quality                                                               */
/* -------------------------------------------------------------------------- */

function calculatePoseQuality(poseFrame) {
  if (!hasUsablePose(poseFrame)) {
    return {
      score: 0,

      percent: 0,

      valid: false,

      visibleCount: 0,

      totalCount: 33,
    };
  }

  const landmarks =
    getLandmarks(poseFrame);

  let visibleCount = 0;

  for (const landmark of landmarks) {
    if (
      landmark &&
      getVisibility(landmark) >= 0.35
    ) {
      visibleCount += 1;
    }
  }

  const totalCount =
    landmarks.length || 33;

  const score =
    visibleCount / totalCount;

  return {
    score,

    percent:
      Math.round(
        score * 100
      ),

    valid:
      score >= 0.60,

    visibleCount,

    totalCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Knee features                                                              */
/* -------------------------------------------------------------------------- */

function getKneeAngles(features) {
  if (!features) {
    return {
      left: null,

      right: null,

      average: null,
    };
  }

  const left =
    features.leftKneeAngle ??
    features.leftKnee ??
    null;

  const right =
    features.rightKneeAngle ??
    features.rightKnee ??
    null;

  let average =
    features.averageKneeAngle ??
    null;

  if (!isFiniteNumber(average)) {
    if (
      isFiniteNumber(left) &&
      isFiniteNumber(right)
    ) {
      average =
        (left + right) / 2;
    } else if (
      isFiniteNumber(left)
    ) {
      average = left;
    } else if (
      isFiniteNumber(right)
    ) {
      average = right;
    }
  }

  return {
    left:
      isFiniteNumber(left)
        ? left
        : null,

    right:
      isFiniteNumber(right)
        ? right
        : null,

    average:
      isFiniteNumber(average)
        ? average
        : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Telemetry                                                                  */
/* -------------------------------------------------------------------------- */

function createEmptyTelemetry() {
  return {
    startKneeAngle: null,

    minKneeAngle: null,

    finalKneeAngle: null,

    romDegrees: null,

    durationMs: null,

    minLeftKneeAngle: null,

    minRightKneeAngle: null,

    maxKneeAsymmetryDegrees: 0,

    sampleCount: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Calibrated repetition configuration                                        */
/* -------------------------------------------------------------------------- */

/*
 * SquatCalibration gives us:
 *
 *   flexion = baselineAngle - currentKneeAngle
 *
 * We transform that into a high-low-high signal:
 *
 *   signal = 180 - flexion
 *
 * Approximately:
 *
 *   standing      -> high
 *   descending    -> lower
 *   bottom        -> very low
 *   ascending     -> high again
 *
 * These are detector parameters, not universal biomechanical thresholds.
 */

function createCalibratedRepConfig() {
  return {
    direction:
      'high-low-high',

    /*
     * Ready/lockout zone.
     */
    readyThreshold:
      150,

    /*
     * Movement has started.
     */
    descendingThreshold:
      140,

    /*
     * Deep movement zone.
     */
    bottomThreshold:
      110,

    /*
     * Movement is returning upward.
     */
    ascendingThreshold:
      125,

    /*
     * Near-standing return.
     */
    lockoutThreshold:
      150,

    /*
     * Minimum excursion required.
     */
    minRom:
      30,

    /*
     * Prevent tiny accidental motions.
     */
    minDurationMs:
      300,

    /*
     * Prevent a stuck movement from lasting forever.
     */
    maxDurationMs:
      6000,

    /*
     * Must return to ready before another rep.
     */
    requireReadyReset:
      true,
  };
}

/* -------------------------------------------------------------------------- */
/* Squat Analyzer                                                             */
/* -------------------------------------------------------------------------- */

export class SquatAnalyzer {
  constructor({
    calibration = {},
  } = {}) {
    this.spec =
      SQUAT_SPEC;

    /*
     * Generic engine exists immediately for compatibility.
     *
     * It gets replaced with calibrated configuration
     * after standing calibration succeeds.
     */
    this.repEngine =
      new RepStateMachine(
        {
          direction:
            this.spec.direction,

          readyThreshold:
            this.spec.thresholds.ready,

          descendingThreshold:
            this.spec.thresholds.start,

          bottomThreshold:
            this.spec.thresholds.extreme,

          ascendingThreshold:
            this.spec.thresholds.return,

          lockoutThreshold:
            this.spec.thresholds.lockout,

          minRom:
            this.spec.validation.minRom,

          minDurationMs:
            this.spec.validation.minDurationMs,

          maxDurationMs:
            this.spec.validation.maxDurationMs,

          requireReadyReset:
            this.spec.validation.requireReadyReset,
        }
      );

    /*
     * Individual standing calibration.
     */
    this.calibration =
      new SquatCalibration({
        ...calibration,
      });

    this.phase =
      'init';

    this.repCount =
      0;

    this.activeRep =
      null;

    this.lastRep =
      null;

    this.totalFrames =
      0;

    this.validFrames =
      0;

    this.repEngineCalibrated =
      false;

    this.repEvent =
      null;

    this.latestRep =
      null;

    this.lastTimestampMs =
      null;

    this.currentTelemetry =
      createEmptyTelemetry();

    this.completedReps =
      [];

    this.telemetryStartTimeMs =
      null;

    this.lastResult =
      this._createInitialResult();
  }

  /* ---------------------------------------------------------------------- */
  /* Reset                                                                  */
  /* ---------------------------------------------------------------------- */

  reset() {
    this.repEngine =
      new RepStateMachine(
        {
          direction:
            this.spec.direction,

          readyThreshold:
            this.spec.thresholds.ready,

          descendingThreshold:
            this.spec.thresholds.start,

          bottomThreshold:
            this.spec.thresholds.extreme,

          ascendingThreshold:
            this.spec.thresholds.return,

          lockoutThreshold:
            this.spec.thresholds.lockout,

          minRom:
            this.spec.validation.minRom,

          minDurationMs:
            this.spec.validation.minDurationMs,

          maxDurationMs:
            this.spec.validation.maxDurationMs,

          requireReadyReset:
            this.spec.validation.requireReadyReset,
        }
      );

    this.calibration.reset();

    this.phase =
      'init';

    this.repCount =
      0;

    this.activeRep =
      null;

    this.lastRep =
      null;

    this.totalFrames =
      0;

    this.validFrames =
      0;

    this.repEngineCalibrated =
      false;

    this.repEvent =
      null;

    this.latestRep =
      null;

    this.lastTimestampMs =
      null;

    this.currentTelemetry =
      createEmptyTelemetry();

    this.completedReps =
      [];

    this.telemetryStartTimeMs =
      null;

    this.lastResult =
      this._createInitialResult();

    return this.lastResult;
  }

  /* ---------------------------------------------------------------------- */
  /* Public API                                                             */
  /* ---------------------------------------------------------------------- */

  analyze(poseFrame) {
    return this.update(
      poseFrame
    );
  }

  process(poseFrame) {
    return this.update(
      poseFrame
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Main update                                                            */
  /* ---------------------------------------------------------------------- */

  update(poseFrame) {
    this.totalFrames += 1;

    /*
     * Per-frame event.
     */
    this.repEvent =
      null;

    const timestampMs =
      getTimestampMs(
        poseFrame
      );

    const poseQuality =
      calculatePoseQuality(
        poseFrame
      );

    const required =
      checkRequiredLandmarks(
        poseFrame
      );

    /* --------------------------------------------------------------- */
    /* Timestamp                                                        */
    /* --------------------------------------------------------------- */

    if (
      timestampMs === null
    ) {
      this.phase =
        'init';

      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle:
          null,

        leftKneeAngle:
          null,

        rightKneeAngle:
          null,

        calibration:
          this.calibration.getSnapshot(),

        flexion:
          null,

        validFrame:
          false,

        reason:
          'invalid_timestamp',
      });
    }

    if (
      this.lastTimestampMs !== null &&
      timestampMs <=
        this.lastTimestampMs
    ) {
      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle:
          null,

        leftKneeAngle:
          null,

        rightKneeAngle:
          null,

        calibration:
          this.calibration.getSnapshot(),

        flexion:
          null,

        validFrame:
          false,

        reason:
          'non_monotonic_timestamp',
      });
    }

    this.lastTimestampMs =
      timestampMs;

    /* --------------------------------------------------------------- */
    /* Pose                                                            */
    /* --------------------------------------------------------------- */

    if (
      !hasUsablePose(
        poseFrame
      )
    ) {
      this.phase =
        'init';

      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle:
          null,

        leftKneeAngle:
          null,

        rightKneeAngle:
          null,

        calibration:
          this.calibration.getSnapshot(),

        flexion:
          null,

        validFrame:
          false,

        reason:
          'no_pose',
      });
    }

    if (
      !required.valid
    ) {
      this.phase =
        'init';

      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle:
          null,

        leftKneeAngle:
          null,

        rightKneeAngle:
          null,

        calibration:
          this.calibration.getSnapshot(),

        flexion:
          null,

        validFrame:
          false,

        reason:
          'missing_required_landmarks',
      });
    }

    if (
      !poseQuality.valid
    ) {
      this.phase =
        'init';

      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle:
          null,

        leftKneeAngle:
          null,

        rightKneeAngle:
          null,

        calibration:
          this.calibration.getSnapshot(),

        flexion:
          null,

        validFrame:
          false,

        reason:
          'insufficient_pose_quality',
      });
    }

    /* --------------------------------------------------------------- */
    /* Features                                                         */
    /* --------------------------------------------------------------- */

    let features;

    try {
      features =
        extractExerciseFeatures(
          poseFrame,
          this.spec
        );
    } catch (error) {
      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle:
          null,

        leftKneeAngle:
          null,

        rightKneeAngle:
          null,

        calibration:
          this.calibration.getSnapshot(),

        flexion:
          null,

        validFrame:
          false,

        reason:
          'feature_extraction_failed',

        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }

    const knees =
      getKneeAngles(
        features
      );

    /* --------------------------------------------------------------- */
    /* Knee signal                                                      */
    /* --------------------------------------------------------------- */

    if (
      !isFiniteNumber(
        knees.average
      )
    ) {
      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle:
          knees.average,

        leftKneeAngle:
          knees.left,

        rightKneeAngle:
          knees.right,

        calibration:
          this.calibration.getSnapshot(),

        flexion:
          null,

        validFrame:
          false,

        reason:
          'knee_angle_unavailable',
      });
    }

    /*
     * Valid analyzer frame.
     */
    this.validFrames += 1;

    /* --------------------------------------------------------------- */
    /* Calibration                                                      */
    /* --------------------------------------------------------------- */

    const calibrationResult =
      this.calibration.update(
        knees.average,
        timestampMs
      );

    if (
      calibrationResult.failed
    ) {
      this.phase =
        'init';

      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle:
          knees.average,

        leftKneeAngle:
          knees.left,

        rightKneeAngle:
          knees.right,

        calibration:
          calibrationResult,

        flexion:
          null,

        validFrame:
          true,

        reason:
          calibrationResult.reason,
      });
    }

    /*
     * Calibration is still collecting standing samples.
     */
    if (
      !calibrationResult.ready
    ) {
      this.phase =
        'ready';

      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle:
          knees.average,

        leftKneeAngle:
          knees.left,

        rightKneeAngle:
          knees.right,

        calibration:
          calibrationResult,

        flexion:
          null,

        validFrame:
          true,

        reason:
          calibrationResult.reason,
      });
    }

    /* --------------------------------------------------------------- */
    /* Calibrated movement signal                                       */
    /* --------------------------------------------------------------- */

    const flexion =
      this.calibration.getFlexion(
        knees.average
      );

    if (
      !isFiniteNumber(
        flexion
      )
    ) {
      this.phase =
        'init';

      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle:
          knees.average,

        leftKneeAngle:
          knees.left,

        rightKneeAngle:
          knees.right,

        calibration:
          calibrationResult,

        flexion:
          null,

        validFrame:
          true,

        reason:
          'invalid_flexion',
      });
    }

    /*
     * Convert flexion to high-low-high signal.
     *
     * 0° flexion  -> 180
     * 10°         -> 170
     * 30°         -> 150
     * 50°         -> 130
     * 70°         -> 110
     */
    const normalizedSignal =
      Math.max(
        0,
        Math.min(
          180,
          180 - flexion
        )
      );

    /* --------------------------------------------------------------- */
    /* Initialize calibrated rep engine                                */
    /* --------------------------------------------------------------- */

    if (
      !this.repEngineCalibrated
    ) {
      this.repEngine =
        new RepStateMachine(
          createCalibratedRepConfig()
        );

      this.repEngineCalibrated =
        true;

      /*
       * IMPORTANT:
       *
       * Calibration can finish on a frame that is already
       * somewhat below standing. We only prime the engine
       * when that frame is inside the ready region.
       *
       * The -1 timestamp guarantees the next real frame
       * remains strictly monotonic for RepStateMachine.
       */
      if (
        normalizedSignal >=
        150
      ) {
        this.repEngine.update(
          normalizedSignal,
          timestampMs - 1,
          true
        );
      }
    }

    /* --------------------------------------------------------------- */
    /* Telemetry                                                        */
    /* --------------------------------------------------------------- */

    this._updateTelemetry(
      knees,
      timestampMs,
      flexion
    );

    /* --------------------------------------------------------------- */
    /* Actual repetition detection                                     */
    /* --------------------------------------------------------------- */

    const repResult =
      this.repEngine.update(
        normalizedSignal,
        timestampMs,
        true
      );

    this.repCount =
      Number.isFinite(
        repResult.reps
      )
        ? repResult.reps
        : 0;

    /* --------------------------------------------------------------- */
    /* Rep event                                                        */
    /* --------------------------------------------------------------- */

    this.repEvent = {
      completed:
        !!repResult.repCompleted,

      accepted:
        !!repResult.repAccepted,

      reason:
        repResult.reason ??
        null,

      rom:
        repResult.rom ??
        null,

      durationMs:
        repResult.durationMs ??
        null,
    };

    /* --------------------------------------------------------------- */
    /* Completed rep                                                   */
    /* --------------------------------------------------------------- */

    if (
      repResult.repCompleted
    ) {
      const completedRep = {
        number:
          repResult.repAccepted
            ? repResult.reps
            : repResult.reps + 1,

        accepted:
          !!repResult.repAccepted,

        rom:
          repResult.rom,

        durationMs:
          repResult.durationMs,

        minimumKneeAngle:
          this.currentTelemetry
            .minKneeAngle,

        maximumKneeAsymmetry:
          this.currentTelemetry
            .maxKneeAsymmetryDegrees,

        startKneeAngle:
          this.currentTelemetry
            .startKneeAngle,

        finalKneeAngle:
          this.currentTelemetry
            .finalKneeAngle,

        reason:
          repResult.reason,
      };

      this.latestRep =
        completedRep;

      this.lastRep =
        completedRep;

      this.completedReps.push(
        completedRep
      );

      /*
       * Movement telemetry starts fresh.
       */
      this.currentTelemetry =
        createEmptyTelemetry();

      this.telemetryStartTimeMs =
        null;
    }

    /* --------------------------------------------------------------- */
    /* Active rep                                                       */
    /* --------------------------------------------------------------- */

    const engineState =
      this.repEngine?.state ??
      'init';

    if (
      engineState ===
        'descending' ||
      engineState ===
        'bottom' ||
      engineState ===
        'ascending'
    ) {
      this.activeRep = {
        phase:
          engineState,

        signal:
          normalizedSignal,

        flexion,

        rom:
          this.currentTelemetry
            .romDegrees,

        durationMs:
          this.currentTelemetry
            .durationMs,
      };
    } else {
      this.activeRep =
        null;
    }

    if (
      repResult.repCompleted
    ) {
      this.activeRep =
        null;
    }

    /* --------------------------------------------------------------- */
    /* Visible phase                                                    */
    /* --------------------------------------------------------------- */

    this.phase =
      this._deriveEnginePhase(
        engineState
      );

    return this._buildResult({
      poseQuality,
      required,

      averageKneeAngle:
        knees.average,

      leftKneeAngle:
        knees.left,

      rightKneeAngle:
        knees.right,

      calibration:
        calibrationResult,

      flexion,

      normalizedSignal,

      validFrame:
        true,

      reason:
        repResult.repCompleted
          ? repResult.repAccepted
            ? 'rep_accepted'
            : (
                repResult.reason ??
                'rep_rejected'
              )
          : 'tracking',
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Engine phase                                                           */
  /* ---------------------------------------------------------------------- */

  _deriveEnginePhase(
    state
  ) {
    switch (state) {
      case 'ready':
        return 'ready';

      case 'descending':
        return 'descending';

      case 'bottom':
        return 'bottom';

      case 'ascending':
        return 'ascending';

      case 'init':
      default:
        return 'init';
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Telemetry                                                              */
  /* ---------------------------------------------------------------------- */

  _updateTelemetry(
    knees,
    timestampMs,
    flexion
  ) {
    const average =
      knees.average;

    if (
      !isFiniteNumber(
        average
      )
    ) {
      return;
    }

    /*
     * Start movement telemetry when flexion
     * leaves the small standing-noise band.
     */
    if (
      this.currentTelemetry
        .sampleCount === 0 &&
      isFiniteNumber(
        flexion
      ) &&
      flexion >= 8
    ) {
      this.currentTelemetry = {
        startKneeAngle:
          average,

        minKneeAngle:
          average,

        finalKneeAngle:
          average,

        romDegrees:
          0,

        durationMs:
          0,

        minLeftKneeAngle:
          isFiniteNumber(
            knees.left
          )
            ? knees.left
            : null,

        minRightKneeAngle:
          isFiniteNumber(
            knees.right
          )
            ? knees.right
            : null,

        maxKneeAsymmetryDegrees:
          0,

        sampleCount:
          1,
      };

      this.telemetryStartTimeMs =
        timestampMs;

      return;
    }

    if (
      this.currentTelemetry
        .sampleCount === 0
    ) {
      return;
    }

    const telemetry =
      this.currentTelemetry;

    telemetry.sampleCount += 1;

    telemetry.minKneeAngle =
      Math.min(
        telemetry.minKneeAngle,
        average
      );

    telemetry.finalKneeAngle =
      average;

    if (
      isFiniteNumber(
        knees.left
      )
    ) {
      telemetry.minLeftKneeAngle =
        telemetry.minLeftKneeAngle ===
        null
          ? knees.left
          : Math.min(
              telemetry.minLeftKneeAngle,
              knees.left
            );
    }

    if (
      isFiniteNumber(
        knees.right
      )
    ) {
      telemetry.minRightKneeAngle =
        telemetry.minRightKneeAngle ===
        null
          ? knees.right
          : Math.min(
              telemetry.minRightKneeAngle,
              knees.right
            );
    }

    if (
      isFiniteNumber(
        knees.left
      ) &&
      isFiniteNumber(
        knees.right
      )
    ) {
      const asymmetry =
        Math.abs(
          knees.left -
          knees.right
        );

      telemetry.maxKneeAsymmetryDegrees =
        Math.max(
          telemetry.maxKneeAsymmetryDegrees,
          asymmetry
        );
    }

    telemetry.romDegrees =
      Math.max(
        0,
        telemetry.startKneeAngle -
          telemetry.minKneeAngle
      );

    telemetry.durationMs =
      Math.max(
        0,
        timestampMs -
          this.telemetryStartTimeMs
      );
  }

  /* ---------------------------------------------------------------------- */
  /* Result builder                                                         */
  /* ---------------------------------------------------------------------- */

  _buildResult({
    poseQuality,
    required,

    averageKneeAngle,
    leftKneeAngle,
    rightKneeAngle,

    calibration,

    flexion,

    normalizedSignal =
      null,

    validFrame,

    reason,

    error =
      null,
  }) {
    const trackingUsable =
      !!validFrame &&
      !!required?.valid &&
      !!poseQuality?.valid;

    const knee = {
      left:
        isFiniteNumber(
          leftKneeAngle
        )
          ? leftKneeAngle
          : null,

      right:
        isFiniteNumber(
          rightKneeAngle
        )
          ? rightKneeAngle
          : null,

      average:
        isFiniteNumber(
          averageKneeAngle
        )
          ? averageKneeAngle
          : null,
    };

    const tracking = {
      usable:
        trackingUsable,

      valid:
        trackingUsable,

      reason:
        trackingUsable
          ? 'tracking'
          : reason,

      /*
       * Keep the UI-compatible nested object.
       */
      poseQuality: {
        score:
          poseQuality.score,

        percent:
          poseQuality.percent,

        valid:
          poseQuality.valid,

        visibleLandmarks:
          poseQuality.visibleCount,

        totalLandmarks:
          poseQuality.totalCount,
      },

      poseQualityScore:
        poseQuality.score,

      visibleLandmarks:
        poseQuality.visibleCount,

      totalLandmarks:
        poseQuality.totalCount,

      requiredLandmarksVisible:
        required.visibleCount,

      requiredLandmarksTotal:
        required.requiredCount,

      requiredLandmarks: {
        valid:
          !!required?.valid,

        visibleCount:
          required?.visibleCount ??
          0,

        requiredCount:
          required?.requiredCount ??
          REQUIRED_LANDMARKS.length,

        missing:
          Array.isArray(
            required?.missing
          )
            ? required.missing.slice()
            : [],
      },
    };

    const result = {
      /*
       * Core state.
       */
      phase:
        this.phase,

      reps:
        this.repCount,

      repCount:
        this.repCount,

      activeRep:
        this.activeRep,

      lastRep:
        this.lastRep,

      totalFrames:
        this.totalFrames,

      validFrames:
        this.validFrames,

      /*
       * Rep event.
       */
      repEvent:
        this.repEvent,

      latestRep:
        this.latestRep,

      /*
       * Tracking.
       */
      tracking,

      /*
       * Pose diagnostics.
       */
      poseQuality:
        poseQuality,

      poseQualityScore:
        poseQuality.score,

      poseQualityPercent:
        poseQuality.percent,

      visibleLandmarks:
        poseQuality.visibleCount,

      totalLandmarks:
        poseQuality.totalCount,

      requiredLandmarksVisible:
        required.visibleCount,

      requiredLandmarksTotal:
        required.requiredCount,

      /*
       * Knee values.
       */
      knee,

      averageKneeAngle:
        knee.average,

      kneeAngle:
        knee.average,

      leftKneeAngle:
        knee.left,

      rightKneeAngle:
        knee.right,

      /*
       * Primary raw signal.
       */
      signal:
        knee.average,

      /*
       * Personalized movement.
       */
      flexion:
        isFiniteNumber(
          flexion
        )
          ? flexion
          : null,

      normalizedSignal:
        isFiniteNumber(
          normalizedSignal
        )
          ? normalizedSignal
          : null,

      baselineAngle:
        calibration?.baselineAngle ??
        null,

      calibration,

      /*
       * Validity.
       */
      validPose:
        !!validFrame,

      validFrame:
        !!validFrame,

      reason,

      error,

      /*
       * Rep engine.
       */
      repEngine: {
        reps:
          this.repEngine?.reps ??
          0,

        state:
          this.repEngine?.state ??
          'init',

        phase:
          this.repEngine?.state ??
          this.phase,
      },

      /*
       * Telemetry.
       */
      telemetry: {
        ...this.currentTelemetry,
      },

      completedReps:
        this.completedReps.slice(),

      /*
       * Structured analysis.
       */
      analysis: {
        calibrationState:
          calibration?.state ??
          'calibrating',

        calibrationReady:
          !!calibration?.ready,

        baselineAngle:
          calibration?.baselineAngle ??
          null,

        flexion:
          isFiniteNumber(
            flexion
          )
            ? flexion
            : null,

        normalizedSignal:
          isFiniteNumber(
            normalizedSignal
          )
            ? normalizedSignal
            : null,

        knee: {
          left:
            knee.left,

          right:
            knee.right,

          average:
            knee.average,
        },

        phase:
          this.phase,
      },
    };

    this.lastResult =
      result;

    return result;
  }

  /* ---------------------------------------------------------------------- */
  /* Initial result                                                         */
  /* ---------------------------------------------------------------------- */

  _createInitialResult() {
    const calibration =
      this.calibration.getSnapshot();

    return {
      phase:
        'init',

      reps:
        0,

      repCount:
        0,

      activeRep:
        null,

      lastRep:
        null,

      totalFrames:
        0,

      validFrames:
        0,

      repEvent:
        null,

      latestRep:
        null,

      tracking: {
        usable:
          false,

        valid:
          false,

        reason:
          'not_started',

        poseQuality: {
          score:
            0,

          percent:
            0,

          valid:
            false,

          visibleLandmarks:
            0,

          totalLandmarks:
            33,
        },

        poseQualityScore:
          0,

        visibleLandmarks:
          0,

        totalLandmarks:
          33,

        requiredLandmarksVisible:
          0,

        requiredLandmarksTotal:
          REQUIRED_LANDMARKS.length,

        requiredLandmarks: {
          valid:
            false,

          visibleCount:
            0,

          requiredCount:
            REQUIRED_LANDMARKS.length,

          missing:
            REQUIRED_LANDMARKS.map(
              (index) =>
                REQUIRED_LANDMARK_NAMES[index] ??
                index
            ),
        },
      },

      poseQuality: {
        score:
          0,

        percent:
          0,

        valid:
          false,

        visibleLandmarks:
          0,

        totalLandmarks:
          33,
      },

      poseQualityScore:
        0,

      poseQualityPercent:
        0,

      visibleLandmarks:
        0,

      totalLandmarks:
        33,

      requiredLandmarksVisible:
        0,

      requiredLandmarksTotal:
        REQUIRED_LANDMARKS.length,

      knee: {
        left:
          null,

        right:
          null,

        average:
          null,
      },

      averageKneeAngle:
        null,

      kneeAngle:
        null,

      leftKneeAngle:
        null,

      rightKneeAngle:
        null,

      signal:
        null,

      flexion:
        null,

      normalizedSignal:
        null,

      baselineAngle:
        null,

      calibration,

      validPose:
        false,

      validFrame:
        false,

      reason:
        'not_started',

      error:
        null,

      repEngine: {
        reps:
          0,

        state:
          'init',

        phase:
          'init',
      },

      telemetry:
        createEmptyTelemetry(),

      completedReps:
        [],

      analysis: {
        calibrationState:
          calibration.state,

        calibrationReady:
          false,

        baselineAngle:
          null,

        flexion:
          null,

        normalizedSignal:
          null,

        knee: {
          left:
            null,

          right:
            null,

          average:
            null,
        },

        phase:
          'init',
      },
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Snapshot                                                               */
  /* ---------------------------------------------------------------------- */

  getSnapshot() {
    return {
      ...this.lastResult,

      repEngine: {
        reps:
          this.repEngine?.reps ??
          0,

        state:
          this.repEngine?.state ??
          'init',

        phase:
          this.repEngine?.state ??
          this.phase,
      },

      activeRep:
        this.activeRep,

      lastRep:
        this.lastRep,

      totalFrames:
        this.totalFrames,

      validFrames:
        this.validFrames,

      repEvent:
        this.repEvent,

      latestRep:
        this.latestRep,

      tracking: {
        ...(this.lastResult.tracking ??
          {}),
      },

      telemetry: {
        ...this.currentTelemetry,
      },

      completedReps:
        this.completedReps.slice(),

      calibration:
        this.calibration.getSnapshot(),
    };
  }
}

export default SquatAnalyzer;