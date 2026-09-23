import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  SquatAnalyzer,
} from './SquatAnalyzer.js'


function makePose() {
  return {
    timestampMs: 0,

    hasPose: true,

    landmarks:
      Array.from(
        { length: 33 },
        () => ({
          x: 0,
          y: 0,
          z: 0,
          visibility: 1,
        })
      ),

    worldLandmarks: [],

    landmarkCount: 33,

    worldLandmarkCount: 0,
  }
}


function setPoint(
  pose,
  index,
  x,
  y,
  z = 0
) {
  pose.landmarks[index] = {
    x,
    y,
    z,
    visibility: 1,
  }
}


function makeStandingPose(
  timestampMs = 0
) {
  const pose = makePose()

  pose.timestampMs =
    timestampMs

  // Left leg: straight.
  setPoint(pose, 11, -1, 3)
  setPoint(pose, 23, -1, 2)
  setPoint(pose, 25, -1, 1)
  setPoint(pose, 27, -1, 0)

  // Right leg: straight.
  setPoint(pose, 12, 1, 3)
  setPoint(pose, 24, 1, 2)
  setPoint(pose, 26, 1, 1)
  setPoint(pose, 28, 1, 0)

  // Elbows/wrists are supplied so feature
  // extraction has valid basic geometry.
  setPoint(pose, 13, -1.5, 2.5)
  setPoint(pose, 15, -2, 2)

  setPoint(pose, 14, 1.5, 2.5)
  setPoint(pose, 16, 2, 2)

  return pose
}


describe('SquatAnalyzer', () => {
  it('starts with zero reps', () => {
    const analyzer =
      new SquatAnalyzer()

    expect(
      analyzer.repEngine.reps
    ).toBe(0)
  })


  it('rejects a pose with missing required landmarks', () => {
    const analyzer =
      new SquatAnalyzer()

    const pose =
      makeStandingPose()

    pose.landmarks[25].visibility =
      0

    const result =
      analyzer.update(pose)

    expect(
      result.tracking.usable
    ).toBe(false)

    expect(
      result.tracking.requiredLandmarks.valid
    ).toBe(false)

    expect(
      result.tracking.requiredLandmarks.missing
    ).toContain('leftKnee')

    expect(result.reps).toBe(0)
  })


  it('recognizes a valid standing pose', () => {
    const analyzer =
      new SquatAnalyzer()

    const result =
      analyzer.update(
        makeStandingPose()
      )

    expect(
      result.tracking.usable
    ).toBe(true)

    expect(
      result.phase
    ).toBe('ready')

    expect(
      result.signal
    ).toBeCloseTo(180, 5)

    expect(
      result.reps
    ).toBe(0)
  })


  it('does not create a rep from a single frame', () => {
    const analyzer =
      new SquatAnalyzer()

    const result =
      analyzer.update(
        makeStandingPose()
      )

    expect(
      result.repEvent?.completed ??
        false
    ).toBe(false)

    expect(
      result.reps
    ).toBe(0)
  })


  it('can reset the whole analysis session', () => {
    const analyzer =
      new SquatAnalyzer()

    analyzer.update(
      makeStandingPose()
    )

    analyzer.reset()

    expect(
      analyzer.repEngine.reps
    ).toBe(0)

    expect(
      analyzer.activeRep
    ).toBeNull()

    expect(
      analyzer.lastRep
    ).toBeNull()

    expect(
      analyzer.totalFrames
    ).toBe(0)

    expect(
      analyzer.validFrames
    ).toBe(0)
  })
})