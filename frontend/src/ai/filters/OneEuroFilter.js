/**
 * One Euro Filter
 *
 * Designed for noisy real-time signals where we want:
 * - strong smoothing when movement is slow
 * - low latency when movement becomes fast
 *
 * We use one scalar filter for each coordinate/channel.
 */

export class OneEuroFilter {
  constructor({
    minCutoff = 1.0,
    beta = 0.005,
    dCutoff = 1.0,
  } = {}) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff

    this.xPrev = null
    this.dxPrev = 0
    this.tPrev = null
  }

  alpha(cutoff, frequency) {
    const tau = 1 / (2 * Math.PI * cutoff)
    const te = 1 / frequency

    return 1 / (1 + tau / te)
  }

  filter(value, timestampMs) {
    if (!Number.isFinite(value)) {
      return this.xPrev
    }

    if (
      this.tPrev === null ||
      this.xPrev === null
    ) {
      this.xPrev = value
      this.tPrev = timestampMs
      this.dxPrev = 0

      return value
    }

    const dtSeconds =
      (timestampMs - this.tPrev) / 1000

    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return this.xPrev
    }

    const frequency = 1 / dtSeconds

    const rawDerivative =
      (value - this.xPrev) / dtSeconds

    const derivativeAlpha = this.alpha(
      this.dCutoff,
      frequency
    )

    const derivative =
      derivativeAlpha * rawDerivative +
      (1 - derivativeAlpha) * this.dxPrev

    const cutoff =
      this.minCutoff +
      this.beta * Math.abs(derivative)

    const valueAlpha = this.alpha(
      cutoff,
      frequency
    )

    const filtered =
      valueAlpha * value +
      (1 - valueAlpha) * this.xPrev

    this.xPrev = filtered
    this.dxPrev = derivative
    this.tPrev = timestampMs

    return filtered
  }

  reset() {
    this.xPrev = null
    this.dxPrev = 0
    this.tPrev = null
  }
}


/**
 * One Euro filtering for a MediaPipe landmark.
 *
 * A separate scalar filter is used for x/y/z.
 */
export class OneEuroLandmarkFilter {
  constructor(options = {}) {
    this.x = new OneEuroFilter(options)
    this.y = new OneEuroFilter(options)
    this.z = new OneEuroFilter(options)
  }

  filter(landmark, timestampMs) {
    if (!landmark) {
      return null
    }

    return {
      ...landmark,

      x: this.x.filter(
        landmark.x,
        timestampMs
      ),

      y: this.y.filter(
        landmark.y,
        timestampMs
      ),

      z: this.z.filter(
        landmark.z ?? 0,
        timestampMs
      ),
    }
  }

  reset() {
    this.x.reset()
    this.y.reset()
    this.z.reset()
  }
}


/**
 * Filter a complete pose.
 *
 * MediaPipe Pose Landmarker normally gives 33 landmarks.
 */
export class PoseLandmarkFilter {
  constructor(options = {}) {
    this.filters = Array.from(
      { length: 33 },
      () => new OneEuroLandmarkFilter(options)
    )
  }

  filter(landmarks, timestampMs) {
    if (!Array.isArray(landmarks)) {
      return []
    }

    return landmarks.map((landmark, index) => {
      if (!this.filters[index]) {
        this.filters[index] =
          new OneEuroLandmarkFilter()
      }

      return this.filters[index].filter(
        landmark,
        timestampMs
      )
    })
  }

  reset() {
    for (const filter of this.filters) {
      filter.reset()
    }
  }
}