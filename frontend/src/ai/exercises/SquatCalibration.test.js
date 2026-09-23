import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  CALIBRATION_STATES,
  SquatCalibration,
  median,
  medianAbsoluteDeviation,
} from './SquatCalibration.js'


describe('SquatCalibration', () => {
  it('starts in the calibrating state', () => {
    const calibration =
      new SquatCalibration()

    expect(
      calibration.state
    ).toBe(
      CALIBRATION_STATES.CALIBRATING
    )

    expect(
      calibration.baselineAngle
    ).toBeNull()

    expect(
      calibration.samples
    ).toHaveLength(0)
  })


  it('calculates a median correctly', () => {
    expect(
      median([140, 142, 144])
    ).toBe(142)

    expect(
      median([140, 142, 144, 146])
    ).toBe(143)
  })


  it('calculates median absolute deviation', () => {
    const values = [
      140,
      142,
      144,
    ]

    const center =
      median(values)

    expect(
      medianAbsoluteDeviation(
        values,
        center
      )
    ).toBe(2)
  })


  it('calibrates a stable standing angle', () => {
    const calibration =
      new SquatCalibration({
        minSamples: 5,
        maxDurationMs: 2000,
        maxMadDegrees: 4,
      })

    const angles = [
      143,
      142,
      144,
      143,
      143,
    ]

    let result

    angles.forEach((angle, index) => {
      result =
        calibration.update(
          angle,
          index * 100
        )
    })

    expect(
      calibration.state
    ).toBe(
      CALIBRATION_STATES.READY
    )

    expect(
      calibration.baselineAngle
    ).toBe(143)

    expect(
      result.ready
    ).toBe(true)

    expect(
      result.reason
    ).toBe(
      'calibration_complete'
    )
  })


  it('is resistant to one outlier because it uses the median', () => {
    const calibration =
      new SquatCalibration({
        minSamples: 5,
        maxDurationMs: 2000,
        maxMadDegrees: 4,
      })

    const angles = [
      143,
      144,
      142,
      175,
      143,
    ]

    angles.forEach((angle, index) => {
      calibration.update(
        angle,
        index * 100
      )
    })

    expect(
      calibration.state
    ).toBe(
      CALIBRATION_STATES.READY
    )

    expect(
      calibration.baselineAngle
    ).toBe(143)
  })


  it('converts a current knee angle into relative flexion', () => {
    const calibration =
      new SquatCalibration({
        minSamples: 5,
        maxDurationMs: 2000,
        maxMadDegrees: 4,
      })

    const angles = [
      143,
      142,
      144,
      143,
      143,
    ]

    angles.forEach((angle, index) => {
      calibration.update(
        angle,
        index * 100
      )
    })

    expect(
      calibration.getFlexion(103)
    ).toBe(40)

    expect(
      calibration.getFlexion(93)
    ).toBe(50)
  })


  it('does not produce flexion before calibration', () => {
    const calibration =
      new SquatCalibration({
        minSamples: 5,
      })

    expect(
      calibration.getFlexion(100)
    ).toBeNull()
  })


  it('rejects invalid angles', () => {
    const calibration =
      new SquatCalibration()

    const result =
      calibration.update(
        Number.NaN,
        0
      )

    expect(
      result.acceptedSample
    ).toBe(false)

    expect(
      result.reason
    ).toBe('invalid_angle')

    expect(
      calibration.samples
    ).toHaveLength(0)
  })


  it('rejects non-monotonic timestamps', () => {
    const calibration =
      new SquatCalibration()

    calibration.update(
      143,
      100
    )

    const result =
      calibration.update(
        143,
        50
      )

    expect(
      result.acceptedSample
    ).toBe(false)

    expect(
      result.reason
    ).toBe(
      'non_monotonic_timestamp'
    )
  })


  it('fails if the standing pose remains unstable', () => {
    const calibration =
      new SquatCalibration({
        minSamples: 5,
        maxDurationMs: 500,
        maxMadDegrees: 1,
      })

    calibration.update(130, 0)
    calibration.update(150, 100)
    calibration.update(130, 200)
    calibration.update(150, 300)

    const result =
      calibration.update(
        130,
        500
      )

    expect(
      calibration.state
    ).toBe(
      CALIBRATION_STATES.FAILED
    )

    expect(
      result.ready
    ).toBe(false)

    expect(
      result.failureReason
    ).toBe(
      'standing_pose_not_stable'
    )
  })


  it('can be reset', () => {
    const calibration =
      new SquatCalibration({
        minSamples: 3,
      })

    calibration.update(143, 0)
    calibration.update(143, 100)

    calibration.reset()

    expect(
      calibration.state
    ).toBe(
      CALIBRATION_STATES.CALIBRATING
    )

    expect(
      calibration.baselineAngle
    ).toBeNull()

    expect(
      calibration.samples
    ).toHaveLength(0)
  })
})