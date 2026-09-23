/**
 * Generic distance utilities for pose analysis.
 */

/**
 * Euclidean distance using x/y coordinates.
 */
export function distance2D(a, b) {
  if (!a || !b) {
    return null
  }

  return Math.hypot(
    a.x - b.x,
    a.y - b.y
  )
}

/**
 * Euclidean distance using x/y/z coordinates.
 *
 * MediaPipe world landmarks can use this for
 * camera-independent body measurements.
 */
export function distance3D(a, b) {
  if (!a || !b) {
    return null
  }

  return Math.hypot(
    a.x - b.x,
    a.y - b.y,
    (a.z ?? 0) - (b.z ?? 0)
  )
}

/**
 * Generic distance helper.
 *
 * Defaults to 3D because our feature engine prefers
 * world-landmark geometry when available.
 */
export function distance(
  a,
  b,
  options = {}
) {
  const use3D = options.use3D !== false

  return use3D
    ? distance3D(a, b)
    : distance2D(a, b)
}