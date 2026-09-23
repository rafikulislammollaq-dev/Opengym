/**
 * Pose quality utilities.
 *
 * These functions answer:
 * "Can we trust the landmarks in this frame?"
 *
 * They do NOT decide whether the user is doing a rep.
 */

export function getLandmarkVisibility(landmark) {
  if (!landmark) return 0

  if (typeof landmark.visibility === 'number') {
    return landmark.visibility
  }

  return 1
}

export function isLandmarkVisible(
  landmark,
  minimumVisibility = 0.5
) {
  return getLandmarkVisibility(landmark) >= minimumVisibility
}

export function countVisibleLandmarks(
  landmarks,
  minimumVisibility = 0.5
) {
  if (!Array.isArray(landmarks)) return 0

  return landmarks.reduce(
    (count, landmark) =>
      count +
      (isLandmarkVisible(
        landmark,
        minimumVisibility
      )
        ? 1
        : 0),
    0
  )
}

export function calculatePoseQuality(
  poseFrame,
  minimumVisibility = 0.5
) {
  if (!poseFrame?.hasPose) {
    return {
      valid: false,
      score: 0,
      visibleLandmarks: 0,
      totalLandmarks: 0,
    }
  }

  const landmarks = poseFrame.landmarks ?? []

  const visibleLandmarks = countVisibleLandmarks(
    landmarks,
    minimumVisibility
  )

  const totalLandmarks = landmarks.length

  const score =
    totalLandmarks > 0
      ? visibleLandmarks / totalLandmarks
      : 0

  return {
    valid: score >= 0.5,
    score,
    visibleLandmarks,
    totalLandmarks,
  }
}