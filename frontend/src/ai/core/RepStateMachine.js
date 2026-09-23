/**
 * Generic phase-based repetition state machine.
 *
 * Designed for exercise-specific scalar signals:
 *   - knee angle
 *   - elbow angle
 *   - shoulder angle
 *   - etc.
 *
 * The exercise supplies thresholds and direction.
 *
 * high-low-high:
 *   READY -> DESCENDING -> BOTTOM/ASCENDING -> LOCKOUT -> REP
 *
 * low-high-low:
 *   READY -> ASCENDING -> TOP/RETURNING -> LOCKOUT -> REP
 */

export const REP_STATES = Object.freeze({
  INIT: 'init',
  READY: 'ready',
  DESCENDING: 'descending',
  BOTTOM: 'bottom',
  ASCENDING: 'ascending',
})

const DEFAULT_CONFIG = Object.freeze({
  direction: 'high-low-high',

  readyThreshold: 150,
  descendingThreshold: 135,
  bottomThreshold: 105,
  ascendingThreshold: 125,
  lockoutThreshold: 160,

  minRom: 40,
  minDurationMs: 300,
  maxDurationMs: 10000,

  requireReadyReset: true,
})

export class RepStateMachine {
  constructor(config = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    }

    this.reset()
  }

  reset() {
    this.state = REP_STATES.INIT
    this.reps = 0

    this.readySignal = null
    this.startTimestamp = null
    this.startSignal = null
    this.extremeSignal = null

    this.lastTimestamp = null

    this._clearTransientResult()
  }

  update(signal, timestampMs, valid = true) {
    const result = {
      state: this.state,
      reps: this.reps,
      signal,
      repCompleted: false,
      repAccepted: false,
      reason: null,
      rom: null,
      durationMs: null,
    }

    if (!Number.isFinite(signal)) {
      result.reason = 'invalid_signal'
      return result
    }

    if (!Number.isFinite(timestampMs)) {
      result.reason = 'invalid_timestamp'
      return result
    }

    if (
      this.lastTimestamp !== null &&
      timestampMs <= this.lastTimestamp
    ) {
      result.reason = 'non_monotonic_timestamp'
      return result
    }

    this.lastTimestamp = timestampMs

    if (!valid) {
      result.reason = 'invalid_pose_quality'
      return result
    }

    if (this.config.direction === 'high-low-high') {
      this._updateHighLowHigh(signal, timestampMs)
    } else if (this.config.direction === 'low-high-low') {
      this._updateLowHighLow(signal, timestampMs)
    } else {
      this._lastReason = 'unsupported_direction'
    }

    result.state = this.state
    result.reps = this.reps

    result.repCompleted =
      this._lastRepCompleted === true

    result.repAccepted =
      this._lastRepAccepted === true

    result.reason =
      this._lastReason ?? null

    result.rom = this._lastRom
    result.durationMs = this._lastDurationMs

    this._clearTransientResult()

    return result
  }

  _updateHighLowHigh(signal, timestampMs) {
    const {
      readyThreshold,
      descendingThreshold,
      bottomThreshold,
      ascendingThreshold,
      lockoutThreshold,
      minRom,
      minDurationMs,
      maxDurationMs,
      requireReadyReset,
    } = this.config

    switch (this.state) {
      case REP_STATES.INIT: {
        if (signal >= readyThreshold) {
          this.state = REP_STATES.READY
          this.readySignal = signal
          this._lastReason = 'ready_detected'
        }

        break
      }

      case REP_STATES.READY: {
        // Keep the best/highest valid ready position.
        // This becomes the starting reference for ROM.
        this.readySignal =
          this.readySignal === null
            ? signal
            : Math.max(this.readySignal, signal)

        if (signal <= descendingThreshold) {
          this.state = REP_STATES.DESCENDING

          this.startTimestamp = timestampMs

          // IMPORTANT:
          // ROM is measured from the actual ready position,
          // not the first frame that happened to cross the
          // descending threshold.
          this.startSignal =
            this.readySignal ?? signal

          this.extremeSignal = signal

          this._lastReason = 'descent_started'
        }

        break
      }

      case REP_STATES.DESCENDING: {
        this.extremeSignal = Math.min(
          this.extremeSignal,
          signal
        )

        const durationMs =
          timestampMs - this.startTimestamp

        if (durationMs > maxDurationMs) {
          this._failRep('rep_timeout')
          break
        }

        // Full-depth path.
        if (signal <= bottomThreshold) {
          this.state = REP_STATES.BOTTOM
          this._lastReason = 'bottom_reached'
          break
        }

        // Shallow-reversal path.
        //
        // If the user starts moving back upward without
        // reaching the desired bottom threshold, we still
        // complete the movement later, but ROM validation
        // decides whether it is accepted.
        if (signal >= ascendingThreshold) {
          this.state = REP_STATES.ASCENDING
          this._lastReason = 'early_ascent_started'
        }

        break
      }

      case REP_STATES.BOTTOM: {
        this.extremeSignal = Math.min(
          this.extremeSignal,
          signal
        )

        const durationMs =
          timestampMs - this.startTimestamp

        if (durationMs > maxDurationMs) {
          this._failRep('rep_timeout')
          break
        }

        if (signal >= ascendingThreshold) {
          this.state = REP_STATES.ASCENDING
          this._lastReason = 'ascent_started'
        }

        break
      }

      case REP_STATES.ASCENDING: {
        this.extremeSignal = Math.min(
          this.extremeSignal,
          signal
        )

        const durationMs =
          timestampMs - this.startTimestamp

        if (durationMs > maxDurationMs) {
          this._failRep('rep_timeout')
          break
        }

        if (signal >= lockoutThreshold) {
          this._completeRep(
            this.startSignal - this.extremeSignal,
            durationMs,
            minRom,
            minDurationMs,
            requireReadyReset,
            signal,
            readyThreshold
          )
        }

        break
      }

      default:
        this.reset()
        this._lastReason = 'state_reset'
    }
  }

  _updateLowHighLow(signal, timestampMs) {
    const {
      readyThreshold,
      descendingThreshold,
      bottomThreshold,
      ascendingThreshold,
      lockoutThreshold,
      minRom,
      minDurationMs,
      maxDurationMs,
      requireReadyReset,
    } = this.config

    switch (this.state) {
      case REP_STATES.INIT: {
        if (signal <= readyThreshold) {
          this.state = REP_STATES.READY
          this.readySignal = signal
          this._lastReason = 'ready_detected'
        }

        break
      }

      case REP_STATES.READY: {
        // Keep the lowest ready position.
        this.readySignal =
          this.readySignal === null
            ? signal
            : Math.min(this.readySignal, signal)

        if (signal >= ascendingThreshold) {
          this.state = REP_STATES.DESCENDING

          this.startTimestamp = timestampMs

          this.startSignal =
            this.readySignal ?? signal

          this.extremeSignal = signal

          this._lastReason = 'movement_started'
        }

        break
      }

      case REP_STATES.DESCENDING: {
        this.extremeSignal = Math.max(
          this.extremeSignal,
          signal
        )

        const durationMs =
          timestampMs - this.startTimestamp

        if (durationMs > maxDurationMs) {
          this._failRep('rep_timeout')
          break
        }

        if (signal >= lockoutThreshold) {
          this.state = REP_STATES.BOTTOM
          this._lastReason = 'peak_reached'
          break
        }

        if (signal <= descendingThreshold) {
          this.state = REP_STATES.ASCENDING
          this._lastReason = 'return_started'
        }

        break
      }

      case REP_STATES.BOTTOM: {
        this.extremeSignal = Math.max(
          this.extremeSignal,
          signal
        )

        const durationMs =
          timestampMs - this.startTimestamp

        if (durationMs > maxDurationMs) {
          this._failRep('rep_timeout')
          break
        }

        if (signal <= descendingThreshold) {
          this.state = REP_STATES.ASCENDING
          this._lastReason = 'return_started'
        }

        break
      }

      case REP_STATES.ASCENDING: {
        this.extremeSignal = Math.max(
          this.extremeSignal,
          signal
        )

        const durationMs =
          timestampMs - this.startTimestamp

        if (durationMs > maxDurationMs) {
          this._failRep('rep_timeout')
          break
        }

        if (signal <= lockoutThreshold) {
          this._completeRep(
            this.extremeSignal - this.startSignal,
            durationMs,
            minRom,
            minDurationMs,
            requireReadyReset,
            signal,
            readyThreshold
          )
        }

        break
      }

      default:
        this.reset()
        this._lastReason = 'state_reset'
    }
  }

  _completeRep(
    rom,
    durationMs,
    minRom,
    minDurationMs,
    requireReadyReset,
    signal,
    readyThreshold
  ) {
    const validRom = rom >= minRom
    const validDuration =
      durationMs >= minDurationMs

    this._lastRepCompleted = true
    this._lastRom = rom
    this._lastDurationMs = durationMs

    if (validRom && validDuration) {
      this.reps += 1
      this._lastRepAccepted = true
      this._lastReason = 'rep_accepted'
    } else {
      this._lastRepAccepted = false

      if (!validRom && !validDuration) {
        this._lastReason =
          'rep_rejected_duration_and_rom'
      } else if (!validRom) {
        this._lastReason =
          'rep_rejected_rom'
      } else {
        this._lastReason =
          'rep_rejected_duration'
      }
    }

    this.startTimestamp = null
    this.startSignal = null
    this.extremeSignal = null

    if (requireReadyReset) {
      this.state =
        this._isReadySignal(
          signal,
          readyThreshold
        )
          ? REP_STATES.READY
          : REP_STATES.INIT
    } else {
      this.state = REP_STATES.READY
    }

    this.readySignal =
      this.state === REP_STATES.READY
        ? signal
        : null
  }

  _isReadySignal(signal, readyThreshold) {
    if (this.config.direction === 'high-low-high') {
      return signal >= readyThreshold
    }

    return signal <= readyThreshold
  }

  _failRep(reason) {
    this.startTimestamp = null
    this.startSignal = null
    this.extremeSignal = null

    this.state = REP_STATES.INIT
    this.readySignal = null

    this._lastReason = reason
  }

  _clearTransientResult() {
    this._lastRepCompleted = false
    this._lastRepAccepted = false
    this._lastReason = null
    this._lastRom = null
    this._lastDurationMs = null
  }
}