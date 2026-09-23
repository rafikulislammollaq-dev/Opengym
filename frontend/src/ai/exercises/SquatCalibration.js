// src/ai/exercises/SquatCalibration.js

export const CALIBRATION_STATES = Object.freeze({
  CALIBRATING: 'calibrating',
  READY: 'ready',
  FAILED: 'failed',
});

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const sorted = values
    .filter(isFiniteNumber)
    .slice()
    .sort((a, b) => a - b);

  if (sorted.length === 0) {
    return null;
  }

  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (
      sorted[middle - 1] +
      sorted[middle]
    ) / 2;
  }

  return sorted[middle];
}

export function medianAbsoluteDeviation(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const med = median(values);

  if (med === null) {
    return null;
  }

  const deviations = values
    .filter(isFiniteNumber)
    .map((value) =>
      Math.abs(value - med)
    );

  return median(deviations);
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const sorted = values
    .filter(isFiniteNumber)
    .slice()
    .sort((a, b) => a - b);

  if (sorted.length === 0) {
    return null;
  }

  if (p <= 0) {
    return sorted[0];
  }

  if (p >= 1) {
    return sorted[sorted.length - 1];
  }

  const index =
    (sorted.length - 1) * p;

  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const fraction = index - lower;

  return (
    sorted[lower] +
    (sorted[upper] - sorted[lower]) *
      fraction
  );
}

function interquartileRange(values) {
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);

  if (q1 === null || q3 === null) {
    return null;
  }

  return q3 - q1;
}

export class SquatCalibration {
  constructor({
    minSamples = 12,
    maxDurationMs = 2000,
    maxMadDegrees = 4,
    maxIqrDegrees = 8,
  } = {}) {
    if (
      !Number.isInteger(minSamples) ||
      minSamples <= 0
    ) {
      throw new RangeError(
        'minSamples must be a positive integer'
      );
    }

    if (
      !Number.isFinite(maxDurationMs) ||
      maxDurationMs <= 0
    ) {
      throw new RangeError(
        'maxDurationMs must be greater than 0'
      );
    }

    if (
      !Number.isFinite(maxMadDegrees) ||
      maxMadDegrees < 0
    ) {
      throw new RangeError(
        'maxMadDegrees must be a non-negative number'
      );
    }

    if (
      !Number.isFinite(maxIqrDegrees) ||
      maxIqrDegrees < 0
    ) {
      throw new RangeError(
        'maxIqrDegrees must be a non-negative number'
      );
    }

    this.minSamples = minSamples;
    this.maxDurationMs = maxDurationMs;
    this.maxMadDegrees = maxMadDegrees;
    this.maxIqrDegrees = maxIqrDegrees;

    this.reset();
  }

  reset() {
    this.state =
      CALIBRATION_STATES.CALIBRATING;

    this.samples = [];

    this.startTimeMs = null;
    this.lastTimestampMs = null;

    this.baselineAngle = null;

    this.medianAngle = null;
    this.madDegrees = null;
    this.iqrDegrees = null;

    this.failureReason = null;
  }

  update(kneeAngle, timestampMs) {
    /*
     * Invalid pose measurements are rejected without
     * throwing so the real-time analyzer can continue.
     */
    if (!isFiniteNumber(kneeAngle)) {
      return this._result({
        acceptedSample: false,
        reason: 'invalid_angle',
      });
    }

    if (!isFiniteNumber(timestampMs)) {
      return this._result({
        acceptedSample: false,
        reason: 'invalid_timestamp',
      });
    }

    /*
     * Calibration is immutable after success.
     */
    if (
      this.state ===
      CALIBRATION_STATES.READY
    ) {
      return this._result({
        acceptedSample: false,
        reason: 'calibration_complete',
      });
    }

    /*
     * Failed calibration stays failed until reset().
     */
    if (
      this.state ===
      CALIBRATION_STATES.FAILED
    ) {
      return this._result({
        acceptedSample: false,
        reason: this.failureReason,
      });
    }

    /*
     * First accepted frame establishes the timer.
     */
    if (this.startTimeMs === null) {
      this.startTimeMs = timestampMs;
    }

    /*
     * Reject backwards timestamps.
     */
    if (
      this.lastTimestampMs !== null &&
      timestampMs < this.lastTimestampMs
    ) {
      return this._result({
        acceptedSample: false,
        reason: 'non_monotonic_timestamp',
      });
    }

    this.lastTimestampMs = timestampMs;

    /*
     * Store the valid sample.
     */
    this.samples.push(kneeAngle);

    this.medianAngle =
      median(this.samples);

    this.madDegrees =
      medianAbsoluteDeviation(
        this.samples
      );

    this.iqrDegrees =
      interquartileRange(
        this.samples
      );

    const elapsedMs =
      timestampMs - this.startTimeMs;

    const enoughSamples =
      this.samples.length >=
      this.minSamples;

    /*
     * MAD:
     *
     * Measures how tightly the measurements
     * cluster around the median.
     */
    const madStable =
      this.madDegrees !== null &&
      this.madDegrees <=
        this.maxMadDegrees;

    /*
     * IQR:
     *
     * Gives us another robust spread measure.
     *
     * A single extreme outlier normally does not
     * make the IQR large when the remaining samples
     * are tightly clustered.
     */
    const iqrStable =
      this.iqrDegrees !== null &&
      this.iqrDegrees <=
        this.maxIqrDegrees;

    /*
     * IMPORTANT:
     *
     * We deliberately do NOT use first-half vs
     * second-half drift as a hard calibration gate.
     *
     * Why?
     *
     * Suppose the camera produces:
     *
     * 170 170 170 170 100 170 170 170 ...
     *
     * The user's real standing angle is still ~170°.
     *
     * A single bad frame should not cause the entire
     * calibration to fail.
     *
     * Median + MAD + IQR are intentionally robust
     * against this kind of isolated measurement error.
     */
    const stable =
      madStable &&
      iqrStable;

    /*
     * Successful calibration.
     */
    if (
      enoughSamples &&
      stable
    ) {
      this.state =
        CALIBRATION_STATES.READY;

      this.baselineAngle =
        this.medianAngle;

      return this._result({
        acceptedSample: true,
        reason: 'calibration_complete',
      });
    }

    /*
     * Calibration window expired.
     */
    if (
      elapsedMs >=
      this.maxDurationMs
    ) {
      this.state =
        CALIBRATION_STATES.FAILED;

      if (!enoughSamples) {
        this.failureReason =
          'insufficient_samples';
      } else {
        this.failureReason =
          'standing_pose_not_stable';
      }

      return this._result({
        acceptedSample: true,
        reason: this.failureReason,
      });
    }

    /*
     * Still collecting calibration samples.
     */
    return this._result({
      acceptedSample: true,
      reason: 'calibrating',
    });
  }

  getProgress(
    timestampMs = this.lastTimestampMs
  ) {
    if (
      this.state ===
        CALIBRATION_STATES.READY ||
      this.state ===
        CALIBRATION_STATES.FAILED
    ) {
      return 1;
    }

    if (
      this.startTimeMs === null ||
      timestampMs === null ||
      !isFiniteNumber(timestampMs)
    ) {
      return 0;
    }

    const elapsedMs = Math.max(
      0,
      timestampMs -
        this.startTimeMs
    );

    return Math.min(
      1,
      elapsedMs /
        this.maxDurationMs
    );
  }

  getFlexion(currentKneeAngle) {
    if (
      this.state !==
        CALIBRATION_STATES.READY ||
      this.baselineAngle === null ||
      !isFiniteNumber(
        currentKneeAngle
      )
    ) {
      return null;
    }

    /*
     * Relative flexion:
     *
     * standing = 170°
     * current  = 130°
     *
     * flexion = 40°
     */
    return (
      this.baselineAngle -
      currentKneeAngle
    );
  }

  getSnapshot() {
    let reason = 'calibrating';

    if (
      this.state ===
      CALIBRATION_STATES.READY
    ) {
      reason =
        'calibration_complete';
    }

    if (
      this.state ===
      CALIBRATION_STATES.FAILED
    ) {
      reason =
        this.failureReason;
    }

    return this._result({
      acceptedSample: false,
      reason,
    });
  }

  _result({
    acceptedSample = false,
    reason = null,
  } = {}) {
    const elapsedMs =
      this.startTimeMs !== null &&
      this.lastTimestampMs !== null
        ? Math.max(
            0,
            this.lastTimestampMs -
              this.startTimeMs
          )
        : 0;

    return {
      state: this.state,

      ready:
        this.state ===
        CALIBRATION_STATES.READY,

      failed:
        this.state ===
        CALIBRATION_STATES.FAILED,

      acceptedSample,

      reason,

      baselineAngle:
        this.baselineAngle,

      sampleCount:
        this.samples.length,

      minSamples:
        this.minSamples,

      medianAngle:
        this.medianAngle,

      madDegrees:
        this.madDegrees,

      iqrDegrees:
        this.iqrDegrees,

      elapsedMs,

      progress:
        this.getProgress(),

      failureReason:
        this.failureReason,

      isReady:
        this.state ===
        CALIBRATION_STATES.READY,

      isFailed:
        this.state ===
        CALIBRATION_STATES.FAILED,
    };
  }
}