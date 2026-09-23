// src/ai/exercises/SquatFormAnalyzer.js
//
// Stage 1 form layer:
// - keeps the hard real-time measurements deterministic
// - turns each completed squat rep into structured evidence
// - prepares an LLM-ready coaching context
//
// IMPORTANT:
// The app UI should not expose these raw geometric measurements directly.
// A later LLM/coach layer should turn the evidence into normal human feedback.

export const FORM_STATUS = Object.freeze({
  GOOD: 'good',
  ATTENTION: 'attention',
  INSUFFICIENT_DATA: 'insufficient_data',
  NOT_ASSESSED: 'not_assessed',
})

const MP = Object.freeze({
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
})

const DEFAULT_OPTIONS = Object.freeze({
  minRomDegrees: 60,
  torsoLeanAttentionDegrees: 35,
  kneePathAttentionRatio: 0.18,
  symmetryAttentionDegrees: 12,
  minRepDurationMs: 300,
  maxRepDurationMs: 6000,
  stabilityJitterDegrees: 8,
  cameraView: 'side',
})

function finite(value) {
  return Number.isFinite(value)
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function round(value, decimals = 1) {
  if (!finite(value)) {
    return null
  }

  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function distance(a, b) {
  if (!a || !b) {
    return null
  }

  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz =
    finite(a.z) && finite(b.z)
      ? a.z - b.z
      : 0

  const value = Math.sqrt(
    dx * dx +
      dy * dy +
      dz * dz
  )

  return finite(value) ? value : null
}

function midpoint(a, b) {
  if (!a || !b) {
    return null
  }

  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z:
      finite(a.z) && finite(b.z)
        ? (a.z + b.z) / 2
        : 0,
  }
}

function angleFromVertical(a, b) {
  // Vector a -> b, expressed as deviation from vertical.
  if (!a || !b) {
    return null
  }

  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz =
    finite(a.z) && finite(b.z)
      ? b.z - a.z
      : 0

  const horizontal = Math.sqrt(
    dx * dx +
      dz * dz
  )

  const vertical = Math.abs(dy)

  if (
    !finite(horizontal) ||
    !finite(vertical) ||
    (horizontal === 0 && vertical === 0)
  ) {
    return null
  }

  return (
    Math.atan2(
      horizontal,
      vertical
    ) *
    (180 / Math.PI)
  )
}

function getVisibility(landmark) {
  if (!landmark) {
    return 0
  }

  if (finite(landmark.visibility)) {
    return clamp(
      landmark.visibility,
      0,
      1
    )
  }

  if (finite(landmark.presence)) {
    return clamp(
      landmark.presence,
      0,
      1
    )
  }

  return 1
}

function extractLandmarkSets(poseFrame) {
  if (!poseFrame) {
    return {
      image: null,
      world: null,
    }
  }

  const image =
    poseFrame.landmarks ??
    poseFrame.poseLandmarks ??
    null

  const world =
    poseFrame.worldLandmarks ??
    poseFrame.poseWorldLandmarks ??
    null

  return {
    image:
      Array.isArray(image) && image.length >= 29
        ? image
        : null,
    world:
      Array.isArray(world) && world.length >= 29
        ? world
        : null,
  }
}

function pickLandmark(
  image,
  world,
  index
) {
  const worldPoint =
    world?.[index] ?? null

  const imagePoint =
    image?.[index] ?? null

  // Prefer world landmarks when they exist because they are
  // less dependent on the rendered video dimensions.
  if (worldPoint) {
    return {
      x: worldPoint.x,
      y: worldPoint.y,
      z: finite(worldPoint.z)
        ? worldPoint.z
        : 0,
      visibility: getVisibility(
        worldPoint
      ),
      source: 'world',
    }
  }

  if (imagePoint) {
    return {
      x: imagePoint.x,
      y: imagePoint.y,
      z: finite(imagePoint.z)
        ? imagePoint.z
        : 0,
      visibility: getVisibility(
        imagePoint
      ),
      source: 'image',
    }
  }

  return null
}

function getSquatPoints(poseFrame) {
  const {
    image,
    world,
  } = extractLandmarkSets(
    poseFrame
  )

  return {
    leftShoulder:
      pickLandmark(
        image,
        world,
        MP.LEFT_SHOULDER
      ),
    rightShoulder:
      pickLandmark(
        image,
        world,
        MP.RIGHT_SHOULDER
      ),
    leftHip:
      pickLandmark(
        image,
        world,
        MP.LEFT_HIP
      ),
    rightHip:
      pickLandmark(
        image,
        world,
        MP.RIGHT_HIP
      ),
    leftKnee:
      pickLandmark(
        image,
        world,
        MP.LEFT_KNEE
      ),
    rightKnee:
      pickLandmark(
        image,
        world,
        MP.RIGHT_KNEE
      ),
    leftAnkle:
      pickLandmark(
        image,
        world,
        MP.LEFT_ANKLE
      ),
    rightAnkle:
      pickLandmark(
        image,
        world,
        MP.RIGHT_ANKLE
      ),
  }
}

function allRequiredVisible(points) {
  const required = [
    points.leftShoulder,
    points.rightShoulder,
    points.leftHip,
    points.rightHip,
    points.leftKnee,
    points.rightKnee,
    points.leftAnkle,
    points.rightAnkle,
  ]

  return required.every(
    point =>
      point &&
      point.visibility >= 0.35
  )
}

function calculateTorsoLean(points) {
  const shoulderMid =
    midpoint(
      points.leftShoulder,
      points.rightShoulder
    )

  const hipMid =
    midpoint(
      points.leftHip,
      points.rightHip
    )

  return angleFromVertical(
    hipMid,
    shoulderMid
  )
}

function calculateKneePathOffsetRatio(
  hip,
  knee,
  ankle
) {
  if (!hip || !knee || !ankle) {
    return null
  }

  const legLength =
    distance(
      hip,
      ankle
    )

  if (
    !finite(legLength) ||
    legLength <= 0
  ) {
    return null
  }

  // Compare the observed knee position against the
  // straight hip -> ankle path at the knee's normalized
  // vertical position. This is deliberately called
  // "path offset" because the meaning is camera/view dependent.
  const dy =
    ankle.y - hip.y

  const t =
    Math.abs(dy) > 1e-6
      ? (knee.y - hip.y) / dy
      : 0.5

  const expectedX =
    hip.x +
    (ankle.x - hip.x) *
      clamp(t, 0, 1)

  const lateralOffset =
    Math.abs(
      knee.x -
        expectedX
    )

  return lateralOffset / legLength
}

function classify(
  value,
  attentionThreshold,
  {
    higherIsWorse = true,
    hasEnoughData = true,
  } = {}
) {
  if (
    !hasEnoughData ||
    !finite(value)
  ) {
    return FORM_STATUS.INSUFFICIENT_DATA
  }

  const attention =
    higherIsWorse
      ? value >= attentionThreshold
      : value <= attentionThreshold

  return attention
    ? FORM_STATUS.ATTENTION
    : FORM_STATUS.GOOD
}

function median(values) {
  const finiteValues = values
    .filter(finite)
    .slice()
    .sort(
      (a, b) => a - b
    )

  if (
    finiteValues.length === 0
  ) {
    return null
  }

  const mid =
    Math.floor(
      finiteValues.length / 2
    )

  if (
    finiteValues.length % 2 === 0
  ) {
    return (
      finiteValues[mid - 1] +
      finiteValues[mid]
    ) / 2
  }

  return finiteValues[mid]
}

function standardDeviation(values) {
  const finiteValues =
    values.filter(finite)

  if (
    finiteValues.length < 2
  ) {
    return 0
  }

  const mean =
    finiteValues.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    finiteValues.length

  const variance =
    finiteValues.reduce(
      (sum, value) =>
        sum +
        (value - mean) ** 2,
      0
    ) /
    finiteValues.length

  return Math.sqrt(
    Math.max(
      0,
      variance
    )
  )
}

function createEmptyRep() {
  return {
    repNumber: null,
    startedAtMs: null,
    completedAtMs: null,
    durationMs: null,
    accepted: false,
    romDegrees: null,
    maxTorsoLeanDegrees: null,
    maxKneeAsymmetryDegrees: null,
    maxLeftKneePathOffsetRatio: null,
    maxRightKneePathOffsetRatio: null,
    sampleCount: 0,
    torsoLeanSamples: [],
    kneeAsymmetrySamples: [],
    leftKneePathOffsetSamples: [],
    rightKneePathOffsetSamples: [],
    flexionSamples: [],
  }
}

export class SquatFormAnalyzer {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    }

    this.reset()
  }

  reset() {
    this.currentRep =
      createEmptyRep()

    this.completedReps = []

    this.lastTimestampMs =
      null

    this.lastTorsoLeanDegrees =
      null
  }

  startRep(
    repNumber = null,
    timestampMs = null
  ) {
    this.currentRep =
      createEmptyRep()

    this.currentRep.repNumber =
      repNumber

    if (finite(timestampMs)) {
      this.currentRep.startedAtMs =
        timestampMs
    }
  }

  observeFrame({
    poseFrame = null,
    timestampMs = null,
    flexion = null,
    leftKneeAngle = null,
    rightKneeAngle = null,
    phase = null,
  } = {}) {
    const timestamp =
      finite(timestampMs)
        ? timestampMs
        : null

    if (
      timestamp !== null &&
      this.lastTimestampMs !== null &&
      timestamp < this.lastTimestampMs
    ) {
      return {
        valid: false,
        reason:
          'non_monotonic_timestamp',
      }
    }

    if (
      timestamp !== null
    ) {
      this.lastTimestampMs =
        timestamp
    }

    const points =
      getSquatPoints(
        poseFrame
      )

    const usable =
      allRequiredVisible(
        points
      )

    const torsoLean =
      usable
        ? calculateTorsoLean(
            points
          )
        : null

    const leftPathOffset =
      usable
        ? calculateKneePathOffsetRatio(
            points.leftHip,
            points.leftKnee,
            points.leftAnkle
          )
        : null

    const rightPathOffset =
      usable
        ? calculateKneePathOffsetRatio(
            points.rightHip,
            points.rightKnee,
            points.rightAnkle
          )
        : null

    const kneeAsymmetry =
      finite(leftKneeAngle) &&
      finite(rightKneeAngle)
        ? Math.abs(
            leftKneeAngle -
              rightKneeAngle
          )
        : null

    if (
      !finite(
        this.currentRep.startedAtMs
      ) &&
      timestamp !== null &&
      phase === 'descending'
    ) {
      this.startRep(
        this.currentRep.repNumber,
        timestamp
      )
    }

    if (
      timestamp !== null &&
      finite(
        this.currentRep.startedAtMs
      )
    ) {
      this.currentRep.sampleCount +=
        1
    }

    if (finite(torsoLean)) {
      this.currentRep.torsoLeanSamples.push(
        torsoLean
      )

      this.lastTorsoLeanDegrees =
        torsoLean
    }

    if (finite(kneeAsymmetry)) {
      this.currentRep.kneeAsymmetrySamples.push(
        kneeAsymmetry
      )
    }

    if (finite(leftPathOffset)) {
      this.currentRep.leftKneePathOffsetSamples.push(
        leftPathOffset
      )
    }

    if (finite(rightPathOffset)) {
      this.currentRep.rightKneePathOffsetSamples.push(
        rightPathOffset
      )
    }

    if (finite(flexion)) {
      this.currentRep.flexionSamples.push(
        flexion
      )
    }

    return {
      valid: true,
      usable,
      timestampMs: timestamp,
      phase,
      torsoLeanDegrees:
        round(torsoLean),
      kneeAsymmetryDegrees:
        round(kneeAsymmetry),
      leftKneePathOffsetRatio:
        round(
          leftPathOffset,
          3
        ),
      rightKneePathOffsetRatio:
        round(
          rightPathOffset,
          3
        ),
      sampleCount:
        this.currentRep.sampleCount,
    }
  }

  completeRep({
    timestampMs = null,
    repNumber = null,
    accepted = true,
    romDegrees = null,
  } = {}) {
    const completedAt =
      finite(timestampMs)
        ? timestampMs
        : null

    if (
      this.currentRep.startedAtMs ===
      null
    ) {
      // Create a synthetic start only when the
      // caller already knows a rep completed.
      if (
        completedAt !== null
      ) {
        this.currentRep.startedAtMs =
          Math.max(
            0,
            completedAt -
              this.options.minRepDurationMs
          )
      }
    }

    this.currentRep.completedAtMs =
      completedAt

    if (repNumber !== null) {
      this.currentRep.repNumber =
        repNumber
    }

    this.currentRep.accepted =
      !!accepted

    this.currentRep.romDegrees =
      finite(romDegrees)
        ? romDegrees
        : this._deriveRom()

    if (
      this.currentRep.startedAtMs !==
        null &&
      completedAt !== null
    ) {
      this.currentRep.durationMs =
        Math.max(
          0,
          completedAt -
            this.currentRep.startedAtMs
        )
    }

    const report =
      this._buildRepReport(
        this.currentRep
      )

    this.completedReps.push(
      report
    )

    this.currentRep =
      createEmptyRep()

    return report
  }

  processFrame(args = {}) {
    return this.observeFrame(
      args
    )
  }

  finalizeRep(args = {}) {
    return this.completeRep(
      args
    )
  }

  _deriveRom() {
    const values =
      this.currentRep.flexionSamples

    if (
      values.length === 0
    ) {
      return null
    }

    return Math.max(
      0,
      Math.max(...values) -
        Math.min(...values)
    )
  }

  _buildRepReport(rep) {
    const torsoLean =
      rep.maxTorsoLeanDegrees ??
      (rep.torsoLeanSamples.length
        ? Math.max(
            ...rep.torsoLeanSamples
          )
        : null)

    const kneeAsymmetry =
      rep.maxKneeAsymmetryDegrees ??
      (rep.kneeAsymmetrySamples.length
        ? Math.max(
            ...rep.kneeAsymmetrySamples
          )
        : null)

    const leftPath =
      rep.maxLeftKneePathOffsetRatio ??
      (rep.leftKneePathOffsetSamples.length
        ? Math.max(
            ...rep.leftKneePathOffsetSamples
          )
        : null)

    const rightPath =
      rep.maxRightKneePathOffsetRatio ??
      (rep.rightKneePathOffsetSamples.length
        ? Math.max(
            ...rep.rightKneePathOffsetSamples
          )
        : null)

    const rom =
      finite(rep.romDegrees)
        ? rep.romDegrees
        : null

    const depthStatus =
      finite(rom)
        ? classify(
            rom,
            this.options.minRomDegrees,
            {
              higherIsWorse: false,
            }
          )
        : FORM_STATUS.INSUFFICIENT_DATA

    const torsoStatus =
      classify(
        torsoLean,
        this.options.torsoLeanAttentionDegrees
      )

    const symmetryStatus =
      classify(
        kneeAsymmetry,
        this.options.symmetryAttentionDegrees
      )

    // Knee path is deliberately not given a direct
    // "bad/good" interpretation for side-view footage.
    // The raw evidence is retained for a future camera-view
    // classifier / biomechanics model.
    const kneeTrackingStatus =
      this.options.cameraView ===
      'front' ||
      this.options.cameraView ===
      'rear'
        ? classify(
            Math.max(
              finite(leftPath)
                ? leftPath
                : 0,
              finite(rightPath)
                ? rightPath
                : 0
            ),
            this.options.kneePathAttentionRatio
          )
        : FORM_STATUS.NOT_ASSESSED

    const duration =
      rep.durationMs

    let tempoStatus =
      FORM_STATUS.INSUFFICIENT_DATA

    if (finite(duration)) {
      if (
        duration <
        this.options.minRepDurationMs
      ) {
        tempoStatus =
          FORM_STATUS.ATTENTION
      } else if (
        duration >
        this.options.maxRepDurationMs
      ) {
        tempoStatus =
          FORM_STATUS.ATTENTION
      } else {
        tempoStatus =
          FORM_STATUS.GOOD
      }
    }

    const torsoJitter =
      standardDeviation(
        rep.torsoLeanSamples
      )

    const stabilityStatus =
      rep.torsoLeanSamples.length >= 3
        ? classify(
            torsoJitter,
            this.options.stabilityJitterDegrees
          )
        : FORM_STATUS.INSUFFICIENT_DATA

    return {
      exercise: 'squat',
      repNumber:
        rep.repNumber,
      accepted:
        rep.accepted,

      measurements: {
        romDegrees:
          round(rom),
        durationMs:
          finite(duration)
            ? Math.round(duration)
            : null,
        maxTorsoLeanDegrees:
          round(torsoLean),
        maxKneeAsymmetryDegrees:
          round(kneeAsymmetry),
        maxLeftKneePathOffsetRatio:
          round(leftPath, 3),
        maxRightKneePathOffsetRatio:
          round(rightPath, 3),
        torsoLeanJitterDegrees:
          round(torsoJitter),
        sampleCount:
          rep.sampleCount,
      },

      assessment: {
        depth: {
          status:
            depthStatus,
          evidence:
            'rep_range_of_motion',
        },

        torso: {
          status:
            torsoStatus,
          evidence:
            'maximum_torso_lean',
        },

        symmetry: {
          status:
            symmetryStatus,
          evidence:
            'left_right_knee_difference',
        },

        kneeTracking: {
          status:
            kneeTrackingStatus,
          evidence:
            this.options.cameraView ===
            'side'
              ? 'camera_view_not_suitable_for_direct_lateral_alignment_judgement'
              : 'knee_path_offset',
        },

        tempo: {
          status:
            tempoStatus,
          evidence:
            'rep_duration',
        },

        stability: {
          status:
            stabilityStatus,
          evidence:
            'torso_lean_variability',
        },
      },

      coachFacts:
        this._buildCoachFacts({
          depthStatus,
          torsoStatus,
          symmetryStatus,
          kneeTrackingStatus,
          tempoStatus,
          stabilityStatus,
          rom,
          torsoLean,
          kneeAsymmetry,
          duration,
          cameraView:
            this.options.cameraView,
        }),
    }
  }

  _buildCoachFacts({
    depthStatus,
    torsoStatus,
    symmetryStatus,
    kneeTrackingStatus,
    tempoStatus,
    stabilityStatus,
    rom,
    torsoLean,
    kneeAsymmetry,
    duration,
    cameraView,
  }) {
    const facts = []

    if (
      depthStatus === FORM_STATUS.GOOD
    ) {
      facts.push(
        'Squat range of motion reached the configured minimum target.'
      )
    } else if (
      depthStatus === FORM_STATUS.ATTENTION
    ) {
      facts.push(
        'Squat range of motion did not reach the configured minimum target.'
      )
    }

    if (
      torsoStatus === FORM_STATUS.ATTENTION
    ) {
      facts.push(
        'The torso leaned forward beyond the current coaching threshold during the rep.'
      )
    } else if (
      torsoStatus === FORM_STATUS.GOOD
    ) {
      facts.push(
        'Torso lean stayed within the current coaching threshold.'
      )
    }

    if (
      symmetryStatus === FORM_STATUS.ATTENTION
    ) {
      facts.push(
        'The left and right knee measurements diverged beyond the current symmetry threshold.'
      )
    } else if (
      symmetryStatus === FORM_STATUS.GOOD
    ) {
      facts.push(
        'Left/right knee measurements stayed reasonably symmetric.'
      )
    }

    if (
      cameraView === 'side' &&
      kneeTrackingStatus ===
        FORM_STATUS.NOT_ASSESSED
    ) {
      facts.push(
        'Direct frontal knee-alignment judgement is intentionally withheld from side-view footage.'
      )
    } else if (
      kneeTrackingStatus ===
      FORM_STATUS.ATTENTION
    ) {
      facts.push(
        'The measured knee path exceeded the current alignment threshold.'
      )
    }

    if (
      tempoStatus === FORM_STATUS.ATTENTION
    ) {
      if (
        finite(duration) &&
        duration <
          this.options.minRepDurationMs
      ) {
        facts.push(
          'The rep was completed faster than the configured minimum duration.'
        )
      } else if (
        finite(duration) &&
        duration >
          this.options.maxRepDurationMs
      ) {
        facts.push(
          'The rep took longer than the configured maximum duration.'
        )
      }
    } else if (
      tempoStatus === FORM_STATUS.GOOD
    ) {
      facts.push(
        'Rep duration stayed inside the configured tempo window.'
      )
    }

    if (
      stabilityStatus ===
      FORM_STATUS.ATTENTION
    ) {
      facts.push(
        'Torso movement varied noticeably during the rep.'
      )
    }

    // Numeric values are kept as evidence for the LLM.
    if (finite(rom)) {
      facts.push(
        `Measured rep ROM: ${round(rom)} degrees.`
      )
    }

    if (finite(torsoLean)) {
      facts.push(
        `Maximum measured torso lean: ${round(torsoLean)} degrees.`
      )
    }

    if (finite(kneeAsymmetry)) {
      facts.push(
        `Maximum left/right knee-angle difference: ${round(kneeAsymmetry)} degrees.`
      )
    }

    return facts
  }

  getLatestRep() {
    return (
      this.completedReps.length > 0
        ? this.completedReps[
            this.completedReps.length - 1
          ]
        : null
    )
  }

  getSnapshot() {
    return {
      currentRep: {
        repNumber:
          this.currentRep.repNumber,
        startedAtMs:
          this.currentRep.startedAtMs,
        sampleCount:
          this.currentRep.sampleCount,
      },
      completedReps:
        this.completedReps.slice(),
      latestRep:
        this.getLatestRep(),
    }
  }

  buildLLMContext({
    workout = {},
    user = {},
    latestRepOnly = true,
  } = {}) {
    const reps =
      latestRepOnly
        ? this.completedReps.slice(-1)
        : this.completedReps.slice()

    const compactReps =
      reps.map(
        rep => ({
          repNumber:
            rep.repNumber,
          accepted:
            rep.accepted,
          assessment:
            rep.assessment,
          measurements:
            rep.measurements,
          coachFacts:
            rep.coachFacts,
        })
      )

    return {
      version:
        'squat-form-context-v1',

      user: {
        goal:
          user.goal ?? null,
        experience:
          user.experience ?? null,
      },

      workout: {
        exercise:
          workout.exercise ??
          'squat',
        setNumber:
          workout.setNumber ?? null,
        plannedReps:
          workout.plannedReps ?? null,
      },

      camera: {
        view:
          this.options.cameraView,
        note:
          'Form conclusions are limited by camera placement and landmark visibility.',
      },

      reps:
        compactReps,

      instructions: [
        'Write natural human coaching feedback, not a computer-vision report.',
        'Do not mention raw landmark indices.',
        'Do not invent observations that are absent from the evidence.',
        'Separate confirmed observations from uncertain or unassessed items.',
        'Keep feedback actionable and concise.',
        'Do not make medical diagnoses or claims about injury.',
      ],
    }
  }

  buildLLMPrompt({
    workout = {},
    user = {},
    latestRepOnly = true,
  } = {}) {
    const context =
      this.buildLLMContext({
        workout,
        user,
        latestRepOnly,
      })

    return [
      'You are the coaching layer for a fitness app.',
      'Turn the structured squat evidence below into short, human coaching feedback.',
      '',
      'Rules:',
      '- Speak naturally to the user.',
      '- Lead with what went well.',
      '- Mention only evidence-supported issues.',
      '- Give at most two technique corrections.',
      '- Do not expose raw computer-vision jargon unless it helps the user.',
      '- If an item was not assessed because of camera view, say so only when relevant.',
      '- Never diagnose an injury or medical condition.',
      '',
      'STRUCTURED EVIDENCE:',
      JSON.stringify(
        context,
        null,
        2
      ),
    ].join('\n')
  }
}

export default SquatFormAnalyzer
