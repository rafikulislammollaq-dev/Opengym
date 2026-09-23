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
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const VISIBILITY_THRESHOLD = 0.35;
const POSE_QUALITY_THRESHOLD = 0.60;

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

/*
 * Detector configuration is intentionally expressed in the normalized
 * signal domain, not as someone's raw anatomical knee angle.
 *
 * normalizedSignal:
 *
 *   standing ~= 180
 *   25° flexion ~= 155
 *   40° flexion ~= 140
 *   70° flexion ~= 110
 *
 * This is a detector configuration, not a universal biomechanical standard.
 */
const CALIBRATED_REP_CONFIG = Object.freeze({
  direction: 'high-low-high',

  readyThreshold: 170,

  descendingThreshold: 155,

  bottomThreshold: 110,

  ascendingThreshold: 135,

  lockoutThreshold: 165,

  minRom: 30,

  minDurationMs: 300,

  maxDurationMs: 6000,

  requireReadyReset: true,
});

/*
 * Once enough samples exist, we can freeze a detector baseline.
 * This keeps the normalized signal from moving underneath the state machine.
 */
const MIN_DETECTOR_BASELINE_SAMPLES = 12;

/*
 * Avoid using a wildly low accidental baseline.
 * Squat detector baseline is supposed to represent standing.
 */
const MIN_REASONABLE_BASELINE_ANGLE = 110;
const MAX_REASONABLE_BASELINE_ANGLE = 200;

/* -------------------------------------------------------------------------- */
/* Utility functions                                                          */
/* -------------------------------------------------------------------------- */

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function getTimestampMs(poseFrame) {
  if (!poseFrame) {
    return null;
  }

  if (
    isFiniteNumber(
      poseFrame.timestampMs
    )
  ) {
    return poseFrame.timestampMs;
  }

  if (
    isFiniteNumber(
      poseFrame.timestamp
    )
  ) {
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

  if (
    isFiniteNumber(
      landmark.visibility
    )
  ) {
    return landmark.visibility;
  }

  if (
    isFiniteNumber(
      landmark.presence
    )
  ) {
    return landmark.presence;
  }

  /*
   * Some test fixtures omit visibility.
   * A present landmark is therefore treated as visible.
   */
  return 1;
}

/* -------------------------------------------------------------------------- */
/* Required landmark validation                                               */
/* -------------------------------------------------------------------------- */

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
          index =>
            REQUIRED_LANDMARK_NAMES[index] ??
            index
        ),
    };
  }

  const missing = [];

  let visibleCount = 0;

  for (
    const index of REQUIRED_LANDMARKS
  ) {
    const landmark =
      landmarks[index];

    const visible =
      !!landmark &&
      getVisibility(landmark) >=
        VISIBILITY_THRESHOLD;

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

function calculatePoseQuality(
  poseFrame
) {
  if (
    !hasUsablePose(
      poseFrame
    )
  ) {
    return {
      score: 0,

      percent: 0,

      valid: false,

      visibleCount: 0,

      totalCount: 33,
    };
  }

  const landmarks =
    getLandmarks(
      poseFrame
    );

  let visibleCount = 0;

  for (
    const landmark of landmarks
  ) {
    if (
      landmark &&
      getVisibility(landmark) >=
        VISIBILITY_THRESHOLD
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
      score >= POSE_QUALITY_THRESHOLD,

    visibleCount,

    totalCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Knee extraction                                                            */
/* -------------------------------------------------------------------------- */

function getKneeAngles(
  features
) {
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

  if (
    !isFiniteNumber(
      average
    )
  ) {
    if (
      isFiniteNumber(left) &&
      isFiniteNumber(right)
    ) {
      average =
        (left + right) / 2;
    } else if (
      isFiniteNumber(left)
    ) {
      average =
        left;
    } else if (
      isFiniteNumber(right)
    ) {
      average =
        right;
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
    this.spec =
      SQUAT_SPEC;

    /*
     * Generic engine exists immediately so the existing tests/API
     * can access analyzer.repEngine.reps.
     *
     * Before calibration locks, it is effectively dormant.
     */
    this.repEngine =
      new RepStateMachine({
        direction:
          'high-low-high',

        readyThreshold:
          CALIBRATED_REP_CONFIG.readyThreshold,

        descendingThreshold:
          CALIBRATED_REP_CONFIG.descendingThreshold,

        bottomThreshold:
          CALIBRATED_REP_CONFIG.bottomThreshold,

        ascendingThreshold:
          CALIBRATED_REP_CONFIG.ascendingThreshold,

        lockoutThreshold:
          CALIBRATED_REP_CONFIG.lockoutThreshold,

        minRom:
          CALIBRATED_REP_CONFIG.minRom,

        minDurationMs:
          CALIBRATED_REP_CONFIG.minDurationMs,

        maxDurationMs:
          CALIBRATED_REP_CONFIG.maxDurationMs,

        requireReadyReset:
          CALIBRATED_REP_CONFIG.requireReadyReset,
      });

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

    this.latestRep =
      null;

    this.repEvent =
      null;

    this.totalFrames =
      0;

    this.validFrames =
      0;

    /*
     * Baseline used by the detector.
     *
     * This is deliberately separate from calibration.baselineAngle.
     * If robust calibration fails, its median can still be used as a
     * fallback detector baseline.
     */
    this.detectorBaselineAngle =
      null;

    this.detectorBaselineLocked =
      false;

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
      new RepStateMachine({
        direction:
          'high-low-high',

        readyThreshold:
          CALIBRATED_REP_CONFIG.readyThreshold,

        descendingThreshold:
          CALIBRATED_REP_CONFIG.descendingThreshold,

        bottomThreshold:
          CALIBRATED_REP_CONFIG.bottomThreshold,

        ascendingThreshold:
          CALIBRATED_REP_CONFIG.ascendingThreshold,

        lockoutThreshold:
          CALIBRATED_REP_CONFIG.lockoutThreshold,

        minRom:
          CALIBRATED_REP_CONFIG.minRom,

        minDurationMs:
          CALIBRATED_REP_CONFIG.minDurationMs,

        maxDurationMs:
          CALIBRATED_REP_CONFIG.maxDurationMs,

        requireReadyReset:
          CALIBRATED_REP_CONFIG.requireReadyReset,
      });

    this.calibration.reset();

    this.phase =
      'init';

    this.repCount =
      0;

    this.activeRep =
      null;

    this.lastRep =
      null;

    this.latestRep =
      null;

    this.repEvent =
      null;

    this.totalFrames =
      0;

    this.validFrames =
      0;

    this.detectorBaselineAngle =
      null;

    this.detectorBaselineLocked =
      false;

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
  /* Main public API                                                        */
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

  update(poseFrame) {
    this.totalFrames += 1;

    /*
     * Clear the event from the previous frame.
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
    /* Timestamp validation                                             */
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

        normalizedSignal:
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

        normalizedSignal:
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
    /* Pose existence                                                    */
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

        normalizedSignal:
          null,

        validFrame:
          false,

        reason:
          'no_pose',
      });
    }

    /* --------------------------------------------------------------- */
    /* Required landmarks                                               */
    /* --------------------------------------------------------------- */

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

        normalizedSignal:
          null,

        validFrame:
          false,

        reason:
          'missing_required_landmarks',
      });
    }

    /* --------------------------------------------------------------- */
    /* Pose quality                                                     */
    /* --------------------------------------------------------------- */

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

        normalizedSignal:
          null,

        validFrame:
          false,

        reason:
          'insufficient_pose_quality',
      });
    }

    /* --------------------------------------------------------------- */
    /* Feature extraction                                               */
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

        normalizedSignal:
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
    /* Knee signal                                                     */
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

        normalizedSignal:
          null,

        validFrame:
          false,

        reason:
          'knee_angle_unavailable',
      });
    }

    this.validFrames += 1;

    /* --------------------------------------------------------------- */
    /* Calibration                                                      */
    /* --------------------------------------------------------------- */

    const calibrationResult =
      this.calibration.update(
        knees.average,
        timestampMs
      );

    /*
     * -------------------------------------------------------------
     * LOCK DETECTOR BASELINE
     * -------------------------------------------------------------
     *
     * There are three possible sources:
     *
     * 1. Official calibration baseline.
     * 2. Robust calibration median.
     * 3. Current knee angle as a last-resort seed.
     *
     * Once we have enough samples, the detector baseline is frozen.
     */
    const officialBaseline =
      isFiniteNumber(
        calibrationResult?.baselineAngle
      )
        ? calibrationResult.baselineAngle
        : null;

    const robustMedian =
      isFiniteNumber(
        calibrationResult?.medianAngle
      )
        ? calibrationResult.medianAngle
        : null;

    if (
      !this.detectorBaselineLocked
    ) {
      let candidateBaseline =
        officialBaseline ??
        null;

      if (
        candidateBaseline === null
      ) {
        if (
          robustMedian !== null &&
          calibrationResult.sampleCount >=
            MIN_DETECTOR_BASELINE_SAMPLES
        ) {
          candidateBaseline =
            robustMedian;
        }
      }

      if (
        candidateBaseline === null &&
        calibrationResult.failed &&
        robustMedian !== null
      ) {
        /*
         * Calibration failed its spread gate, but its median remains
         * useful as a robust fallback detector baseline.
         */
        candidateBaseline =
          robustMedian;
      }

      if (
        candidateBaseline !== null &&
        candidateBaseline >=
          MIN_REASONABLE_BASELINE_ANGLE &&
        candidateBaseline <=
          MAX_REASONABLE_BASELINE_ANGLE
      ) {
        this.detectorBaselineAngle =
          candidateBaseline;

        this.detectorBaselineLocked =
          true;
      }
    }

    /*
     * If the calibration succeeds later, upgrade the baseline.
     * This should happen only before actual movement has been committed
     * to the detector.
     */
    if (
      !this.detectorBaselineLocked &&
      officialBaseline !== null
    ) {
      this.detectorBaselineAngle =
        officialBaseline;

      this.detectorBaselineLocked =
        true;
    }

    /*
     * Absolute fallback seed.
     */
    if (
      !this.detectorBaselineLocked &&
      calibrationResult.sampleCount >=
        MIN_DETECTOR_BASELINE_SAMPLES
    ) {
      if (
        robustMedian !== null &&
        robustMedian >=
          MIN_REASONABLE_BASELINE_ANGLE &&
        robustMedian <=
          MAX_REASONABLE_BASELINE_ANGLE
      ) {
        this.detectorBaselineAngle =
          robustMedian;

        this.detectorBaselineLocked =
          true;
      }
    }

    /*
     * -------------------------------------------------------------
     * CALIBRATION NOT READY
     * -------------------------------------------------------------
     *
     * We no longer block the entire analyzer forever.
     *
     * If a robust baseline exists, detector processing can proceed.
     *
     * If no baseline exists yet, remain in calibration.
     */
    if (
      !this.detectorBaselineLocked
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

        normalizedSignal:
          null,

        validFrame:
          true,

        reason:
          calibrationResult.failed
            ? 'calibration_failed_waiting_for_baseline'
            : 'calibrating',
      });
    }

    /* --------------------------------------------------------------- */
    /* Personalized flexion                                             */
    /* --------------------------------------------------------------- */

    const flexion =
      this.detectorBaselineAngle -
      knees.average;

    /*
     * Noise can produce tiny negative flexion values when the detected
     * knee becomes slightly more extended than the baseline.
     *
     * That should simply mean "standing".
     */
    const stableFlexion =
      Math.max(
        0,
        flexion
      );

    /* --------------------------------------------------------------- */
    /* Normalized detector signal                                        */
    /* --------------------------------------------------------------- */

    const normalizedSignal =
      clamp(
        180 -
          stableFlexion,
        0,
        180
      );

    /* --------------------------------------------------------------- */
    /* Feed the actual state machine                                    */
    /* --------------------------------------------------------------- */

    /*
     * The rep engine is already configured for the normalized signal
     * in the constructor/reset path.
     *
     * IMPORTANT:
     * We do not reset it when calibration fails.
     */
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
    /* Telemetry                                                        */
    /* --------------------------------------------------------------- */

    this._updateTelemetry(
      knees,
      timestampMs,
      stableFlexion
    );

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
    /* Completed repetition                                            */
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

      this.currentTelemetry =
        createEmptyTelemetry();

      this.telemetryStartTimeMs =
        null;
    }

    /* --------------------------------------------------------------- */
    /* Active repetition                                                */
    /* --------------------------------------------------------------- */

    const engineState =
      this.repEngine?.state ??
      'init';

    if (
      engineState === 'descending' ||
      engineState === 'bottom' ||
      engineState === 'ascending'
    ) {
      this.activeRep = {
        phase:
          engineState,

        signal:
          normalizedSignal,

        flexion:
          stableFlexion,

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

      flexion:
        stableFlexion,

      normalizedSignal,

      validFrame:
        true,

      reason:
        repResult.repCompleted
          ? (
              repResult.repAccepted
                ? 'rep_accepted'
                : (
                    repResult.reason ??
                    'rep_rejected'
                  )
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
     * Start movement telemetry once the subject leaves
     * the approximately standing zone.
     */
    if (
      this.currentTelemetry
        .sampleCount === 0 &&
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

    /*
     * No movement telemetry yet.
     */
    if (
      this.currentTelemetry
        .sampleCount === 0
    ) {
      return;
    }

    const telemetry =
      this.currentTelemetry;

    telemetry.sampleCount +=
      1;

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
        telemetry.minLeftKneeAngle === null
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
        telemetry.minRightKneeAngle === null
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

    if (
      this.telemetryStartTimeMs !== null
    ) {
      telemetry.durationMs =
        Math.max(
          0,
          timestampMs -
            this.telemetryStartTimeMs
        );
    }
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

    normalizedSignal,

    validFrame,

    reason,

    error = null,
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

      latestRep:
        this.latestRep,

      repEvent:
        this.repEvent,

      totalFrames:
        this.totalFrames,

      validFrames:
        this.validFrames,

      tracking,

      /*
       * Raw pose quality.
       */
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
       * Compatibility scalar.
       */
      signal:
        knee.average,

      /*
       * Personalized movement signal.
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
        this.detectorBaselineAngle ??
        null,

      detectorBaselineAngle:
        this.detectorBaselineAngle,

      detectorBaselineLocked:
        this.detectorBaselineLocked,

      calibration,

      validPose:
        !!validFrame,

      validFrame:
        !!validFrame,

      reason,

      error,

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

      telemetry: {
        ...this.currentTelemetry,
      },

      completedReps:
        this.completedReps.slice(),

      /*
       * Debug/diagnostic information.
       *
       * This lets the UI show exactly why the rep engine
       * is or is not moving.
       */
      analysis: {
        calibrationState:
          calibration?.state ??
          'calibrating',

        calibrationReady:
          !!calibration?.ready,

        calibrationFailed:
          !!calibration?.failed,

        baselineAngle:
          calibration?.baselineAngle ??
          null,

        robustMedianAngle:
          calibration?.medianAngle ??
          null,

        detectorBaselineAngle:
          this.detectorBaselineAngle,

        detectorBaselineLocked:
          this.detectorBaselineLocked,

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

        repEngineState:
          this.repEngine?.state ??
          'init',

        repCount:
          this.repEngine?.reps ??
          0,

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

      latestRep:
        null,

      repEvent:
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
              index =>
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

      detectorBaselineAngle:
        null,

      detectorBaselineLocked:
        false,

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

        calibrationFailed:
          false,

        baselineAngle:
          null,

        robustMedianAngle:
          null,

        detectorBaselineAngle:
          null,

        detectorBaselineLocked:
          false,

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

        repEngineState:
          'init',

        repCount:
          0,

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

      latestRep:
        this.latestRep,

      repEvent:
        this.repEvent,

      totalFrames:
        this.totalFrames,

      validFrames:
        this.validFrames,

      detectorBaselineAngle:
        this.detectorBaselineAngle,

      detectorBaselineLocked:
        this.detectorBaselineLocked,

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