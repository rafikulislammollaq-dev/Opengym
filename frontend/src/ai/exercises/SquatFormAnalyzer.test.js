// src/ai/exercises/SquatFormAnalyzer.test.js

import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  FORM_STATUS,
  SquatFormAnalyzer,
} from './SquatFormAnalyzer.js'

function landmark(
  x,
  y,
  z = 0,
  visibility = 1
) {
  return {
    x,
    y,
    z,
    visibility,
  }
}

function makePose({
  torsoLean = 10,
  kneeGap = 0.01,
} = {}) {
  const points = Array.from(
    { length: 33 },
    () => landmark(
      0.5,
      0.5,
      0,
      1
    )
  )

  const torsoHeight = 0.30
  const shoulderCenterX =
    0.50 +
      Math.tan(
        torsoLean *
          Math.PI /
          180
      ) *
      torsoHeight

  points[11] =
    landmark(
      shoulderCenterX - 0.02,
      0.25,
      0,
      1
    )

  points[12] =
    landmark(
      shoulderCenterX + 0.02,
      0.25,
      0,
      1
    )

  points[23] =
    landmark(
      0.48,
      0.55,
      0,
      1
    )

  points[24] =
    landmark(
      0.52,
      0.55,
      0,
      1
    )

  points[25] =
    landmark(
      0.39 +
        kneeGap,
      0.72,
      0,
      1
    )

  points[26] =
    landmark(
      0.61 -
        kneeGap,
      0.72,
      0,
      1
    )

  points[27] =
    landmark(
      0.38,
      0.9,
      0,
      1
    )

  points[28] =
    landmark(
      0.62,
      0.9,
      0,
      1
    )

  return {
    timestampMs: 0,
    landmarks: points,
    worldLandmarks: points,
  }
}

describe(
  'SquatFormAnalyzer',
  () => {
    it(
      'collects a rep and reports adequate depth',
      () => {
        const analyzer =
          new SquatFormAnalyzer({
            cameraView:
              'side',
          })

        analyzer.startRep(
          1,
          1000
        )

        analyzer.observeFrame({
          poseFrame:
            makePose(),
          timestampMs:
            1100,
          flexion: 10,
          leftKneeAngle:
            165,
          rightKneeAngle:
            164,
          phase:
            'descending',
        })

        analyzer.observeFrame({
          poseFrame:
            makePose({
              torsoLean: 12,
            }),
          timestampMs:
            1600,
          flexion: 72,
          leftKneeAngle:
            100,
          rightKneeAngle:
            102,
          phase:
            'bottom',
        })

        const report =
          analyzer.completeRep({
            timestampMs:
              2700,
            accepted: true,
            romDegrees: 72,
          })

        expect(
          report.repNumber
        ).toBe(1)

        expect(
          report.accepted
        ).toBe(true)

        expect(
          report.assessment.depth.status
        ).toBe(
          FORM_STATUS.GOOD
        )

        expect(
          report.assessment.kneeTracking.status
        ).toBe(
          FORM_STATUS.NOT_ASSESSED
        )
      }
    )

    it(
      'flags excessive torso lean',
      () => {
        const analyzer =
          new SquatFormAnalyzer({
            cameraView:
              'side',
          })

        analyzer.startRep(
          1,
          0
        )

        analyzer.observeFrame({
          poseFrame:
            makePose({
              torsoLean: 45,
            }),
          timestampMs:
            500,
          flexion: 40,
          leftKneeAngle:
            120,
          rightKneeAngle:
            121,
          phase:
            'bottom',
        })

        const report =
          analyzer.completeRep({
            timestampMs:
              1500,
            accepted: true,
            romDegrees: 70,
          })

        expect(
          report.assessment.torso.status
        ).toBe(
          FORM_STATUS.ATTENTION
        )
      }
    )

    it(
      'uses the front view for knee-path assessment',
      () => {
        const analyzer =
          new SquatFormAnalyzer({
            cameraView:
              'front',
          })

        analyzer.startRep(
          1,
          0
        )

        analyzer.observeFrame({
          poseFrame:
            makePose({
              kneeGap:
                0.12,
            }),
          timestampMs:
            500,
          flexion: 55,
          leftKneeAngle:
            115,
          rightKneeAngle:
            128,
          phase:
            'bottom',
        })

        const report =
          analyzer.completeRep({
            timestampMs:
              1500,
            accepted: true,
            romDegrees: 70,
          })

        expect(
          report.assessment.kneeTracking.status
        ).not.toBe(
          FORM_STATUS.NOT_ASSESSED
        )
      }
    )

    it(
      'builds an LLM prompt instead of forcing a raw-metric UI response',
      () => {
        const analyzer =
          new SquatFormAnalyzer()

        analyzer.startRep(
          1,
          0
        )

        analyzer.observeFrame({
          poseFrame:
            makePose(),
          timestampMs:
            500,
          flexion: 70,
          leftKneeAngle:
            100,
          rightKneeAngle:
            101,
          phase:
            'bottom',
        })

        analyzer.completeRep({
          timestampMs:
            1500,
          accepted: true,
          romDegrees: 70,
        })

        const prompt =
          analyzer.buildLLMPrompt({
            workout: {
              setNumber: 2,
            },
          })

        expect(
          prompt
        ).toContain(
          'human coaching feedback'
        )

        expect(
          prompt
        ).toContain(
          'STRUCTURED EVIDENCE'
        )
      }
    )
  }
)
