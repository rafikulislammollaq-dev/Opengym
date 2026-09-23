/**
 * Converts a MediaPipe PoseLandmarker result into the internal
 * pose-frame representation used by the exercise engine.
 *
 * The rest of the AI system should depend on this structure,
 * not directly on the MediaPipe result object.
 */

export function createPoseFrame(result, timestampMs = performance.now()) {
  const landmarks = result?.landmarks?.[0] ?? []
  const worldLandmarks = result?.worldLandmarks?.[0] ?? []

  return {
    timestampMs,

    landmarks,
    worldLandmarks,

    hasPose: landmarks.length > 0,

    landmarkCount: landmarks.length,
    worldLandmarkCount: worldLandmarks.length,
  }
}

export function emptyPoseFrame(timestampMs = performance.now()) {
  return {
    timestampMs,

    landmarks: [],
    worldLandmarks: [],

    hasPose: false,

    landmarkCount: 0,
    worldLandmarkCount: 0,
  }
}