// src/ai/exercises/SquatAnalyzer.js

import { SquatCalibration } from './SquatCalibration.js';
import { SQUAT_SPEC } from './SquatSpec.js';
import { RepStateMachine } from '../core/RepStateMachine.js';
import { toRepMachineConfig } from '../core/ExerciseSpec.js';
import * as FeatureAPI from '../features/ExerciseFeatures.js';

/*
 * Feature extractor compatibility.
 *
 * Supports the possible export names from ExerciseFeatures.js.
 */
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

  const landmarks = getLandmarks(poseFrame);

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

  /*
   * Test fixtures sometimes do not contain visibility.
   * A present landmark is treated as visible in that case.
   */
  return 1;
}

/* -------------------------------------------------------------------------- */
/* MediaPipe landmark validation                                              */
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
  const landmarks = getLandmarks(poseFrame);

  if (!Array.isArray(landmarks)) {
    return {
      valid: false,
      visibleCount: 0,
      requiredCount: REQUIRED_LANDMARKS.length,
      missing: REQUIRED_LANDMARKS.map(
        (index) =>
          REQUIRED_LANDMARK_NAMES[index] ??
          index
      ),
    };
  }

  const missing = [];
  let visibleCount = 0;

  for (const index of REQUIRED_LANDMARKS) {
    const landmark = landmarks[index];

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

  const landmarks = getLandmarks(poseFrame);

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
/* Knee signal                                                                */
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

  /*
   * Fallback if the generic extractor exposes bilateral values
   * but does not calculate the average itself.
   */
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
/* Squat Analyzer                                                             */
/* -------------------------------------------------------------------------- */

export class SquatAnalyzer {
  constructor({
    calibration = {},
  } = {}) {
    this.spec = SQUAT_SPEC;

    /*
     * Generic temporal repetition engine.
     */
    this.repEngine =
      new RepStateMachine(
        toRepMachineConfig(
          this.spec
        )
      );

    /*
     * Individualized standing calibration.
     */
    this.calibration =
      new SquatCalibration({
        ...calibration,
      });

    this.phase = 'init';

    this.repCount = 0;

    /*
     * Public compatibility fields.
     */
    this.activeRep = null;
    this.lastRep = null;

    /*
     * Frame counters.
     */
    this.totalFrames = 0;
    this.validFrames = 0;

    this.lastTimestampMs = null;

    this.currentTelemetry =
      createEmptyTelemetry();

    this.completedReps = [];

    this.telemetryStartTimeMs = null;

    this.lastResult =
      this._createInitialResult();
  }

  /* ---------------------------------------------------------------------- */
  /* Reset                                                                  */
  /* ---------------------------------------------------------------------- */

  reset() {
    /*
     * Re-create the generic rep engine.
     */
    this.repEngine =
      new RepStateMachine(
        toRepMachineConfig(
          this.spec
        )
      );

    /*
     * Reset personalized calibration.
     */
    this.calibration.reset();

    this.phase = 'init';

    this.repCount = 0;

    /*
     * Reset public compatibility state.
     */
    this.activeRep = null;
    this.lastRep = null;

    /*
     * Reset frame counters.
     */
    this.totalFrames = 0;
    this.validFrames = 0;

    this.lastTimestampMs = null;

    this.currentTelemetry =
      createEmptyTelemetry();

    this.completedReps = [];

    this.telemetryStartTimeMs = null;

    this.lastResult =
      this._createInitialResult();

    return this.lastResult;
  }

  /* ---------------------------------------------------------------------- */
  /* Main API                                                               */
  /* ---------------------------------------------------------------------- */

  analyze(poseFrame) {
    return this.update(poseFrame);
  }

  process(poseFrame) {
    return this.update(poseFrame);
  }

  update(poseFrame) {
    /*
     * Count every frame presented to the analyzer.
     */
    this.totalFrames += 1;

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

    /*
     * ---------------------------------------------------------------
     * Timestamp validation
     * ---------------------------------------------------------------
     */

    if (
      timestampMs === null
    ) {
      this.phase = 'init';

      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle: null,
        leftKneeAngle: null,
        rightKneeAngle: null,

        calibration:
          this.calibration.getSnapshot(),

        flexion: null,

        validFrame: false,

        reason:
          'invalid_timestamp',
      });
    }

    if (
      this.lastTimestampMs !== null &&
      timestampMs <
        this.lastTimestampMs
    ) {
      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle: null,
        leftKneeAngle: null,
        rightKneeAngle: null,

        calibration:
          this.calibration.getSnapshot(),

        flexion: null,

        validFrame: false,

        reason:
          'non_monotonic_timestamp',
      });
    }

    this.lastTimestampMs =
      timestampMs;

    /*
     * ---------------------------------------------------------------
     * Pose validation
     * ---------------------------------------------------------------
     */

    if (
      !hasUsablePose(
        poseFrame
      )
    ) {
      this.phase = 'init';

      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle: null,
        leftKneeAngle: null,
        rightKneeAngle: null,

        calibration:
          this.calibration.getSnapshot(),

        flexion: null,

        validFrame: false,

        reason:
          'no_pose',
      });
    }

    if (
      !required.valid
    ) {
      this.phase = 'init';

      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle: null,
        leftKneeAngle: null,
        rightKneeAngle: null,

        calibration:
          this.calibration.getSnapshot(),

        flexion: null,

        validFrame: false,

        reason:
          'missing_required_landmarks',
      });
    }

    if (
      !poseQuality.valid
    ) {
      this.phase = 'init';

      return this._buildResult({
        poseQuality,
        required,

        averageKneeAngle: null,
        leftKneeAngle: null,
        rightKneeAngle: null,

        calibration:
          this.calibration.getSnapshot(),

        flexion: null,

        validFrame: false,

        reason:
          'insufficient_pose_quality',
      });
    }

    /*
     * ---------------------------------------------------------------
     * Feature extraction
     * ---------------------------------------------------------------
     */

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

        averageKneeAngle: null,
        leftKneeAngle: null,
        rightKneeAngle: null,

        calibration:
          this.calibration.getSnapshot(),

        flexion: null,

        validFrame: false,

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

    /*
     * ---------------------------------------------------------------
     * Knee signal validation
     * ---------------------------------------------------------------
     */

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

        flexion: null,

        validFrame: false,

        reason:
          'knee_angle_unavailable',
      });
    }

    /*
     * ---------------------------------------------------------------
     * PERSONAL BASELINE CALIBRATION
     * ---------------------------------------------------------------
     */

    const calibrationResult =
      this.calibration.update(
        knees.average,
        timestampMs
      );

    /*
     * This frame passed pose + landmark + quality + feature
     * validation, so it is a valid analyzer frame.
     */
    this.validFrames += 1;

    /*
     * ---------------------------------------------------------------
     * Calibration failed
     * ---------------------------------------------------------------
     */

    if (
      calibrationResult.failed
    ) {
      this.phase = 'init';

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

        flexion: null,

        validFrame: true,

        reason:
          calibrationResult.reason,
      });
    }

    /*
     * ---------------------------------------------------------------
     * Calibration still running
     * ---------------------------------------------------------------
     */

    if (
      !calibrationResult.ready
    ) {
      this.phase = 'ready';

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

        flexion: null,

        validFrame: true,

        reason:
          calibrationResult.reason,
      });
    }

    /*
     * ---------------------------------------------------------------
     * Calibrated tracking
     * ---------------------------------------------------------------
     */

    const flexion =
      this.calibration.getFlexion(
        knees.average
      );

    this.phase =
      this._deriveDiagnosticPhase(
        flexion
      );

    this._updateTelemetry(
      knees,
      timestampMs,
      flexion
    );

    this.repCount =
      Number.isFinite(
        this.repEngine?.reps
      )
        ? this.repEngine.reps
        : 0;

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

      validFrame: true,

      reason:
        'tracking',
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Diagnostic phase                                                       */
  /* ---------------------------------------------------------------------- */

  _deriveDiagnosticPhase(
    flexion
  ) {
    if (
      !isFiniteNumber(
        flexion
      )
    ) {
      return 'init';
    }

    /*
     * These are diagnostic zones only.
     * They are not rep-counting thresholds.
     */
    if (
      flexion < 8
    ) {
      return 'ready';
    }

    if (
      flexion < 35
    ) {
      return 'descending';
    }

    return 'bottom';
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
     * Start telemetry once movement exceeds
     * the small standing-noise zone.
     */
    if (
      this.currentTelemetry.sampleCount ===
        0 &&
      isFiniteNumber(flexion) &&
      flexion >= 8
    ) {
      this.currentTelemetry = {
        startKneeAngle:
          average,

        minKneeAngle:
          average,

        finalKneeAngle:
          average,

        romDegrees: 0,

        durationMs: 0,

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

        maxKneeAsymmetryDegrees: 0,

        sampleCount: 1,
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
      isFiniteNumber(knees.left) &&
      isFiniteNumber(knees.right)
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

    validFrame,

    reason,

    error = null,
  }) {
    const trackingUsable =
      !!validFrame &&
      !!required?.valid &&
      !!poseQuality?.valid;

    const tracking = {
      usable:
        trackingUsable,

      valid:
        trackingUsable,

      reason:
        trackingUsable
          ? 'tracking'
          : reason,

      poseQuality:
        poseQuality.percent,

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

      /*
       * Existing UI/tests expect:
       *
       * result.tracking.requiredLandmarks.valid
       * result.tracking.requiredLandmarks.missing
       */
      requiredLandmarks: {
        valid:
          !!required?.valid,

        visibleCount:
          required?.visibleCount ?? 0,

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
       * Primary state.
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
       * Existing tracking contract.
       */
      tracking,

      /*
       * Pose diagnostics.
       */
      poseQuality:
        poseQuality.percent,

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
       * Knee signal.
       */
      averageKneeAngle:
        isFiniteNumber(
          averageKneeAngle
        )
          ? averageKneeAngle
          : null,

      kneeAngle:
        isFiniteNumber(
          averageKneeAngle
        )
          ? averageKneeAngle
          : null,

      leftKneeAngle:
        isFiniteNumber(
          leftKneeAngle
        )
          ? leftKneeAngle
          : null,

      rightKneeAngle:
        isFiniteNumber(
          rightKneeAngle
        )
          ? rightKneeAngle
          : null,

      /*
       * Compatibility field expected by
       * SquatAnalyzer tests.
       */
      signal:
        isFiniteNumber(
          averageKneeAngle
        )
          ? averageKneeAngle
          : null,

      /*
       * Personalized signal.
       */
      flexion:
        isFiniteNumber(flexion)
          ? flexion
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
       * Public engine.
       */
      repEngine: {
        reps:
          this.repEngine?.reps ??
          0,

        phase:
          this.repEngine?.phase ??
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
       * Structured diagnostics.
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
          isFiniteNumber(flexion)
            ? flexion
            : null,

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

      tracking: {
        usable:
          false,

        valid:
          false,

        reason:
          'not_started',

        poseQuality:
          0,

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

      poseQuality:
        0,

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

        phase:
          this.repEngine?.phase ??
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