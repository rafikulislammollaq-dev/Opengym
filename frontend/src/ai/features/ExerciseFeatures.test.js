import { describe, expect, it } from 'vitest'

import {
  POSE_LANDMARKS,
  extractExerciseFeatures,
  getFeatureSignal,
} from './ExerciseFeatures.js'

function makeLandmarks() {
  return Array.from(
    { length: 33 },
    () => ({
      x: 0,
      y: 0,
      z: 0,
      visibility: 1,
    })
  )
}

function setPoint(
  landmarks,
  index,
  x,
  y,
  z = 0
) {
  landmarks[index] = {
    x,
    y,
    z,
    visibility: 1,
  }
}

describe('ExerciseFeatures', () => {
  it('contains the expected landmark indices', () => {
    expect(
      POSE_LANDMARKS.LEFT_HIP
    ).toBe(23)

    expect(
      POSE_LANDMARKS.RIGHT_HIP
    ).toBe(24)

    expect(
      POSE_LANDMARKS.LEFT_KNEE
    ).toBe(25)

    expect(
      POSE_LANDMARKS.RIGHT_KNEE
    ).toBe(26)
  })

  it('rejects an incomplete pose', () => {
    const features =
      extractExerciseFeatures({
        landmarks: [],
        worldLandmarks: [],
      })

    expect(features.hasPose).toBe(false)
  })

  it('calculates a straight left leg as approximately 180 degrees', () => {
    const landmarks =
      makeLandmarks()

    setPoint(
      landmarks,
      POSE_LANDMARKS.LEFT_HIP,
      0,
      2,
      0
    )

    setPoint(
      landmarks,
      POSE_LANDMARKS.LEFT_KNEE,
      0,
      1,
      0
    )

    setPoint(
      landmarks,
      POSE_LANDMARKS.LEFT_ANKLE,
      0,
      0,
      0
    )

    // Mirror the same geometry on the right
    // so the average knee angle remains valid.
    setPoint(
      landmarks,
      POSE_LANDMARKS.RIGHT_HIP,
      1,
      2,
      0
    )

    setPoint(
      landmarks,
      POSE_LANDMARKS.RIGHT_KNEE,
      1,
      1,
      0
    )

    setPoint(
      landmarks,
      POSE_LANDMARKS.RIGHT_ANKLE,
      1,
      0,
      0
    )

    setPoint(
      landmarks,
      POSE_LANDMARKS.LEFT_SHOULDER,
      0,
      3,
      0
    )

    setPoint(
      landmarks,
      POSE_LANDMARKS.RIGHT_SHOULDER,
      1,
      3,
      0
    )

    const features =
      extractExerciseFeatures({
        landmarks,
      })

    expect(
      features.knees.left
    ).toBeCloseTo(180, 5)

    expect(
      features.knees.right
    ).toBeCloseTo(180, 5)

    expect(
      features.averageKneeAngle
    ).toBeCloseTo(180, 5)
  })

  it('prefers world landmarks when available', () => {
    const imageLandmarks =
      makeLandmarks()

    const worldLandmarks =
      makeLandmarks()

    // Image-space geometry: bent.
    setPoint(
      imageLandmarks,
      POSE_LANDMARKS.LEFT_HIP,
      0,
      2
    )

    setPoint(
      imageLandmarks,
      POSE_LANDMARKS.LEFT_KNEE,
      0,
      1
    )

    setPoint(
      imageLandmarks,
      POSE_LANDMARKS.LEFT_ANKLE,
      1,
      1
    )

    // World-space geometry: straight.
    setPoint(
      worldLandmarks,
      POSE_LANDMARKS.LEFT_HIP,
      0,
      2,
      0
    )

    setPoint(
      worldLandmarks,
      POSE_LANDMARKS.LEFT_KNEE,
      0,
      1,
      0
    )

    setPoint(
      worldLandmarks,
      POSE_LANDMARKS.LEFT_ANKLE,
      0,
      0,
      0
    )

    const features =
      extractExerciseFeatures({
        landmarks: imageLandmarks,
        worldLandmarks,
      })

    expect(
      features.knees.left
    ).toBeCloseTo(180, 5)
  })

  it('resolves a named feature signal', () => {
    const features = {
      averageKneeAngle: 97.5,
    }

    expect(
      getFeatureSignal(
        features,
        'averageKneeAngle'
      )
    ).toBe(97.5)
  })

  it('returns null for an unknown signal', () => {
    const features = {
      averageKneeAngle: 97.5,
    }

    expect(
      getFeatureSignal(
        features,
        'doesNotExist'
      )
    ).toBeNull()
  })
})