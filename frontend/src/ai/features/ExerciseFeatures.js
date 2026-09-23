import {
  calculateAngle2D,
  calculateAngle3D,
} from '../geometry/angles.js'

import {
  distance2D,
  distance3D,
} from '../geometry/distances.js'

export const POSE_LANDMARKS = Object.freeze({
  NOSE: 0,

  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,

  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,

  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,

  LEFT_HIP: 23,
  RIGHT_HIP: 24,

  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,

  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,

  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,

  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
})

function getLandmark(landmarks, index) {
  return landmarks?.[index] ?? null
}

/**
 * Uses world landmarks when available because their geometry
 * is less dependent on the camera's image projection.
 */
function selectLandmarks(poseFrame) {
  if (
    poseFrame?.worldLandmarks?.length === 33
  ) {
    return poseFrame.worldLandmarks
  }

  return poseFrame?.landmarks ?? []
}

function calculateAngle(a, b, c, use3D = true) {
  if (use3D) {
    return calculateAngle3D(a, b, c)
  }

  return calculateAngle2D(a, b, c)
}

function average(values) {
  const valid = values.filter(
    value => Number.isFinite(value)
  )

  if (valid.length === 0) {
    return null
  }

  return (
    valid.reduce((sum, value) => sum + value, 0) /
    valid.length
  )
}

/**
 * Extracts common biomechanical features from a pose.
 *
 * This layer does NOT decide whether a rep happened.
 */
export function extractExerciseFeatures(
  poseFrame
) {
  const landmarks = selectLandmarks(poseFrame)

  if (landmarks.length < 33) {
    return {
      hasPose: false,
    }
  }

  const lh = getLandmark(
    landmarks,
    POSE_LANDMARKS.LEFT_HIP
  )

  const rh = getLandmark(
    landmarks,
    POSE_LANDMARKS.RIGHT_HIP
  )

  const lk = getLandmark(
    landmarks,
    POSE_LANDMARKS.LEFT_KNEE
  )

  const rk = getLandmark(
    landmarks,
    POSE_LANDMARKS.RIGHT_KNEE
  )

  const la = getLandmark(
    landmarks,
    POSE_LANDMARKS.LEFT_ANKLE
  )

  const ra = getLandmark(
    landmarks,
    POSE_LANDMARKS.RIGHT_ANKLE
  )

  const ls = getLandmark(
    landmarks,
    POSE_LANDMARKS.LEFT_SHOULDER
  )

  const rs = getLandmark(
    landmarks,
    POSE_LANDMARKS.RIGHT_SHOULDER
  )

  const le = getLandmark(
    landmarks,
    POSE_LANDMARKS.LEFT_ELBOW
  )

  const re = getLandmark(
    landmarks,
    POSE_LANDMARKS.RIGHT_ELBOW
  )

  const lw = getLandmark(
    landmarks,
    POSE_LANDMARKS.LEFT_WRIST
  )

  const rw = getLandmark(
    landmarks,
    POSE_LANDMARKS.RIGHT_WRIST
  )

  const leftKneeAngle = calculateAngle(
    lh,
    lk,
    la
  )

  const rightKneeAngle = calculateAngle(
    rh,
    rk,
    ra
  )

  const leftElbowAngle = calculateAngle(
    ls,
    le,
    lw
  )

  const rightElbowAngle = calculateAngle(
    rs,
    re,
    rw
  )

  const leftHipAngle = calculateAngle(
    ls,
    lh,
    lk
  )

  const rightHipAngle = calculateAngle(
    rs,
    rh,
    rk
  )

  const leftShoulderWidth = distance3D(
    ls,
    rs
  )

  const hipWidth = distance3D(
    lh,
    rh
  )

  const ankleWidth = distance3D(
    la,
    ra
  )

  return {
    hasPose: true,

    knees: {
      left: leftKneeAngle,
      right: rightKneeAngle,
      average: average([
        leftKneeAngle,
        rightKneeAngle,
      ]),
    },

    elbows: {
      left: leftElbowAngle,
      right: rightElbowAngle,
      average: average([
        leftElbowAngle,
        rightElbowAngle,
      ]),
    },

    hips: {
      left: leftHipAngle,
      right: rightHipAngle,
      average: average([
        leftHipAngle,
        rightHipAngle,
      ]),
    },

    distances: {
      shoulderWidth: leftShoulderWidth,

      hipWidth,

      ankleWidth,

      shoulderToHipLeft:
        distance3D(ls, lh),

      shoulderToHipRight:
        distance3D(rs, rh),
    },

    /**
     * Convenience signals used by ExerciseSpec.
     */
    averageKneeAngle: average([
      leftKneeAngle,
      rightKneeAngle,
    ]),

    averageElbowAngle: average([
      leftElbowAngle,
      rightElbowAngle,
    ]),

    averageHipAngle: average([
      leftHipAngle,
      rightHipAngle,
    ]),
  }
}

/**
 * Resolve a named signal from extracted features.
 *
 * Examples:
 *   "averageKneeAngle"
 *   "averageElbowAngle"
 */
export function getFeatureSignal(
  features,
  signalName
) {
  if (!features || !signalName) {
    return null
  }

  const value = features[signalName]

  return Number.isFinite(value)
    ? value
    : null
}