/**
 * Generic angle utilities for pose analysis.
 *
 * All functions return the angle at point B in degrees.
 */

/**
 * Calculate angle A-B-C using x/y coordinates.
 */
export function calculateAngle2D(a, b, c) {
  if (!a || !b || !c) {
    return null
  }

  const abx = a.x - b.x
  const aby = a.y - b.y

  const cbx = c.x - b.x
  const cby = c.y - b.y

  const magnitudeAB = Math.hypot(abx, aby)
  const magnitudeCB = Math.hypot(cbx, cby)

  if (
    magnitudeAB === 0 ||
    magnitudeCB === 0
  ) {
    return null
  }

  const dot =
    abx * cbx +
    aby * cby

  const cosine =
    dot /
    (magnitudeAB * magnitudeCB)

  // Floating-point protection:
  // acos() requires a value in [-1, 1].
  const clampedCosine = Math.max(
    -1,
    Math.min(1, cosine)
  )

  return (
    Math.acos(clampedCosine) *
    (180 / Math.PI)
  )
}

/**
 * Calculate angle A-B-C using x/y/z coordinates.
 *
 * We use this for MediaPipe world landmarks when available.
 */
export function calculateAngle3D(a, b, c) {
  if (!a || !b || !c) {
    return null
  }

  const abx = a.x - b.x
  const aby = a.y - b.y
  const abz = (a.z ?? 0) - (b.z ?? 0)

  const cbx = c.x - b.x
  const cby = c.y - b.y
  const cbz = (c.z ?? 0) - (b.z ?? 0)

  const magnitudeAB = Math.hypot(
    abx,
    aby,
    abz
  )

  const magnitudeCB = Math.hypot(
    cbx,
    cby,
    cbz
  )

  if (
    magnitudeAB === 0 ||
    magnitudeCB === 0
  ) {
    return null
  }

  const dot =
    abx * cbx +
    aby * cby +
    abz * cbz

  const cosine =
    dot /
    (magnitudeAB * magnitudeCB)

  const clampedCosine = Math.max(
    -1,
    Math.min(1, cosine)
  )

  return (
    Math.acos(clampedCosine) *
    (180 / Math.PI)
  )
}

/**
 * Calculate the angle using whichever representation
 * the caller provides.
 */
export function calculateAngle(
  a,
  b,
  c,
  options = {}
) {
  const use3D = options.use3D !== false

  return use3D
    ? calculateAngle3D(a, b, c)
    : calculateAngle2D(a, b, c)
}