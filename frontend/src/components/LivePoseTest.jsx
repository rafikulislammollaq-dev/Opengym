import { useEffect, useRef, useState } from 'react'
import {
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils,
} from '@mediapipe/tasks-vision'

import {
  createPoseFrame,
} from '../ai/pose/PoseFrame.js'

import {
  PoseLandmarkFilter,
} from '../ai/filters/OneEuroFilter.js'

import {
  SquatAnalyzer,
} from '../ai/exercises/SquatAnalyzer.js'

import {
  SquatFormAnalyzer,
} from '../ai/exercises/SquatFormAnalyzer.js'

import {
  GymCoachService,
} from '../ai/coach/GymCoachService.js'


const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'


export default function LivePoseTest() {
  // =========================================================
  // DOM REFERENCES
  // =========================================================

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)

  // =========================================================
  // AI REFERENCES
  // =========================================================

  const poseLandmarkerRef = useRef(null)

  const imageFilterRef = useRef(
    new PoseLandmarkFilter({
      minCutoff: 1.0,
      beta: 0.005,
      dCutoff: 1.0,
    })
  )

  const worldFilterRef = useRef(
    new PoseLandmarkFilter({
      minCutoff: 1.0,
      beta: 0.005,
      dCutoff: 1.0,
    })
  )

  const squatAnalyzerRef = useRef(
    new SquatAnalyzer()
  )

  const formAnalyzerRef = useRef(
    new SquatFormAnalyzer({
      cameraView: 'side',
    })
  )

  const coachServiceRef = useRef(
    new GymCoachService()
  )

  // =========================================================
  // PROCESSING REFERENCES
  // =========================================================

  const animationFrameRef = useRef(null)

  const processingActiveRef = useRef(false)

  const streamRef = useRef(null)

  const videoUrlRef = useRef(null)

  const endedRef = useRef(false)

  // =========================================================
  // UI STATE
  // =========================================================

  const [status, setStatus] =
    useState('Loading MediaPipe...')

  const [mode, setMode] =
    useState('none')

  const [sourceName, setSourceName] =
    useState('')

  const [cameraReady, setCameraReady] =
    useState(false)

  const [personDetected, setPersonDetected] =
    useState(false)

  const [fps, setFps] =
    useState(0)

  // =========================================================
  // SQUAT STATE
  // =========================================================

  const [reps, setReps] =
    useState(0)

  const [phase, setPhase] =
    useState('init')

  const [leftKnee, setLeftKnee] =
    useState(null)

  const [rightKnee, setRightKnee] =
    useState(null)

  const [averageKnee, setAverageKnee] =
    useState(null)

  const [rom, setRom] =
    useState(null)

  const [poseQuality, setPoseQuality] =
    useState(null)

  const [latestRep, setLatestRep] =
    useState(null)

  const [latestForm, setLatestForm] =
    useState(null)

  const [latestCoach, setLatestCoach] =
    useState('')


  // =========================================================
  // INITIALIZE MEDIAPIPE
  // =========================================================

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      try {
        setStatus(
          'Loading MediaPipe...'
        )

        const vision =
          await FilesetResolver.forVisionTasks(
            WASM_URL
          )

        let poseLandmarker

        // ---------------------------------------------------
        // Try GPU first
        // ---------------------------------------------------

        try {
          poseLandmarker =
            await PoseLandmarker.createFromOptions(
              vision,
              {
                baseOptions: {
                  modelAssetPath:
                    MODEL_URL,

                  delegate:
                    'GPU',
                },

                runningMode:
                  'VIDEO',

                numPoses:
                  1,

                minPoseDetectionConfidence:
                  0.35,

                minPosePresenceConfidence:
                  0.35,

                minTrackingConfidence:
                  0.35,
              }
            )
        } catch (gpuError) {
          console.warn(
            'GPU initialization failed. Falling back to CPU.',
            gpuError
          )

          // -------------------------------------------------
          // CPU fallback
          // -------------------------------------------------

          poseLandmarker =
            await PoseLandmarker.createFromOptions(
              vision,
              {
                baseOptions: {
                  modelAssetPath:
                    MODEL_URL,

                  delegate:
                    'CPU',
                },

                runningMode:
                  'VIDEO',

                numPoses:
                  1,

                minPoseDetectionConfidence:
                  0.35,

                minPosePresenceConfidence:
                  0.35,

                minTrackingConfidence:
                  0.35,
              }
            )
        }

        if (cancelled) {
          poseLandmarker.close()
          return
        }

        poseLandmarkerRef.current =
          poseLandmarker

        setStatus(
          'MediaPipe ready ✓ — choose Camera or Upload Video'
        )
      } catch (error) {
        console.error(
          'MediaPipe initialization failed:',
          error
        )

        setStatus(
          error instanceof Error
            ? `MediaPipe error: ${error.message}`
            : 'MediaPipe initialization failed'
        )
      }
    }

    initialize()

    return () => {
      cancelled = true

      processingActiveRef.current =
        false

      if (animationFrameRef.current) {
        cancelAnimationFrame(
          animationFrameRef.current
        )

        animationFrameRef.current =
          null
      }

      if (streamRef.current) {
        streamRef.current
          .getTracks()
          .forEach(track =>
            track.stop()
          )

        streamRef.current =
          null
      }

      if (videoUrlRef.current) {
        URL.revokeObjectURL(
          videoUrlRef.current
        )

        videoUrlRef.current =
          null
      }

      if (poseLandmarkerRef.current) {
        poseLandmarkerRef.current.close()

        poseLandmarkerRef.current =
          null
      }
    }
  }, [])


  // =========================================================
  // RESET AI SESSION
  // =========================================================

  function resetAnalysis() {
    imageFilterRef.current.reset()

    worldFilterRef.current.reset()

    squatAnalyzerRef.current.reset()

    formAnalyzerRef.current.reset()

    setReps(0)

    setPhase('init')

    setLeftKnee(null)

    setRightKnee(null)

    setAverageKnee(null)

    setRom(null)

    setPoseQuality(null)

    setLatestRep(null)

    setLatestForm(null)

    setLatestCoach('')

    setPersonDetected(false)
  }


  // =========================================================
  // CLEAR CANVAS
  // =========================================================

  function clearCanvas() {
    const canvas =
      canvasRef.current

    if (!canvas) {
      return
    }

    const ctx =
      canvas.getContext('2d')

    if (!ctx) {
      return
    }

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    )
  }


  // =========================================================
  // STOP ONLY THE AI LOOP
  // =========================================================

  function stopProcessing() {
    processingActiveRef.current =
      false

    if (animationFrameRef.current) {
      cancelAnimationFrame(
        animationFrameRef.current
      )

      animationFrameRef.current =
        null
    }
  }


  // =========================================================
  // STOP CURRENT SOURCE COMPLETELY
  // =========================================================

  function stopSource() {
    stopProcessing()

    if (streamRef.current) {
      streamRef.current
        .getTracks()
        .forEach(track =>
          track.stop()
        )

      streamRef.current =
        null
    }

    if (videoUrlRef.current) {
      URL.revokeObjectURL(
        videoUrlRef.current
      )

      videoUrlRef.current =
        null
    }

    const video =
      videoRef.current

    if (video) {
      video.pause()

      video.srcObject =
        null

      video.removeAttribute(
        'src'
      )

      video.load()

      video.onplay =
        null

      video.onpause =
        null

      video.onended =
        null

      video.onseeked =
        null

      video.onloadedmetadata =
        null

      video.controls =
        false
    }

    endedRef.current =
      false

    clearCanvas()

    resetAnalysis()

    setCameraReady(false)

    setFps(0)

    setSourceName('')
  }


  // =========================================================
  // PROCESS CURRENT FRAME
  // =========================================================

  function processCurrentFrame() {
    const video =
      videoRef.current

    const canvas =
      canvasRef.current

    const poseLandmarker =
      poseLandmarkerRef.current

    if (
      !processingActiveRef.current ||
      !video ||
      !canvas ||
      !poseLandmarker
    ) {
      return
    }

    if (
      video.readyState <
      HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      animationFrameRef.current =
        requestAnimationFrame(
          processCurrentFrame
        )

      return
    }

    if (
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      animationFrameRef.current =
        requestAnimationFrame(
          processCurrentFrame
        )

      return
    }

    // -------------------------------------------------------
    // Match canvas to video resolution
    // -------------------------------------------------------

    if (
      canvas.width !==
        video.videoWidth ||
      canvas.height !==
        video.videoHeight
    ) {
      canvas.width =
        video.videoWidth

      canvas.height =
        video.videoHeight
    }

    const ctx =
      canvas.getContext('2d')

    if (!ctx) {
      return
    }

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    )

    const drawingUtils =
      new DrawingUtils(ctx)

    // -------------------------------------------------------
    // MediaPipe video timestamp
    // -------------------------------------------------------

    const timestamp =
      performance.now()

    try {
      const result =
        poseLandmarker.detectForVideo(
          video,
          timestamp
        )

      const rawImageLandmarks =
        result?.landmarks?.[0] ?? []

      const rawWorldLandmarks =
        result?.worldLandmarks?.[0] ?? []

      // =====================================================
      // NO PERSON
      // =====================================================

      if (
        rawImageLandmarks.length === 0
      ) {
        setPersonDetected(false)

        setPoseQuality(null)

        setStatus(
          'No person detected'
        )

        animationFrameRef.current =
          requestAnimationFrame(
            processCurrentFrame
          )

        return
      }

      // =====================================================
      // FILTER IMAGE LANDMARKS
      // =====================================================

      const filteredImageLandmarks =
        imageFilterRef.current.filter(
          rawImageLandmarks,
          timestamp
        )

      // =====================================================
      // FILTER WORLD LANDMARKS
      // =====================================================

      const filteredWorldLandmarks =
        rawWorldLandmarks.length > 0
          ? worldFilterRef.current.filter(
              rawWorldLandmarks,
              timestamp
            )
          : []

      // =====================================================
      // DRAW SKELETON IMMEDIATELY
      //
      // IMPORTANT:
      // Visualization is independent from exercise validity.
      // A bad frame should not freeze/remove the skeleton.
      // =====================================================

      drawingUtils.drawConnectors(
        filteredImageLandmarks,
        PoseLandmarker.POSE_CONNECTIONS
      )

      drawingUtils.drawLandmarks(
        filteredImageLandmarks,
        {
          radius: 4,
        }
      )

      // =====================================================
      // BUILD POSE FRAME
      // =====================================================

      const poseFrame =
        createPoseFrame(
          {
            landmarks: [
              filteredImageLandmarks,
            ],

            worldLandmarks:
              filteredWorldLandmarks.length > 0
                ? [
                    filteredWorldLandmarks,
                  ]
                : [],
          },

          timestamp
        )

      // =====================================================
      // RUN SQUAT ANALYZER
      // =====================================================

      const analysis =
        squatAnalyzerRef.current.update(
          poseFrame
        )

      // =====================================================
      // PERSON EXISTS EVEN IF ANALYSIS QUALITY IS LOW
      // =====================================================

      setPersonDetected(true)

      // =====================================================
      // POSE QUALITY
      // =====================================================

      setPoseQuality(
        analysis.tracking.poseQuality
      )

      // =====================================================
      // LOW QUALITY FRAME
      //
      // Skeleton remains visible.
      // Rep engine simply doesn't trust this frame.
      // =====================================================

      if (
        !analysis.tracking.usable
      ) {
        setStatus(
          'Person detected · waiting for clearer body visibility'
        )

        if (
          processingActiveRef.current
        ) {
          animationFrameRef.current =
            requestAnimationFrame(
              processCurrentFrame
            )
        }

        return
      }

      // =====================================================
      // VALID ANALYSIS
      // =====================================================

      setStatus(
        analysis.repEvent?.accepted
          ? 'Valid squat rep completed ✓'
          : `Tracking squat · ${analysis.phase}`
      )

      // =====================================================
      // PHASE
      // =====================================================

      setPhase(
        analysis.phase
      )

      // =====================================================
      // REPS
      // =====================================================

      setReps(
        analysis.reps
      )

      // =====================================================
      // KNEE TELEMETRY
      // =====================================================

      setLeftKnee(
        Number.isFinite(
          analysis.knee.left
        )
          ? analysis.knee.left
          : null
      )

      setRightKnee(
        Number.isFinite(
          analysis.knee.right
        )
          ? analysis.knee.right
          : null
      )

      setAverageKnee(
        Number.isFinite(
          analysis.knee.average
        )
          ? analysis.knee.average
          : null
      )

      // =====================================================
      // FORM EVIDENCE LAYER
      //
      // Geometry stays internal. This layer collects
      // structured evidence that a later LLM can turn into
      // normal human coaching language.
      // =====================================================

      formAnalyzerRef.current.observeFrame({
        poseFrame,
        timestampMs: timestamp,
        flexion:
          Number.isFinite(
            analysis.flexion
          )
            ? analysis.flexion
            : null,
        leftKneeAngle:
          Number.isFinite(
            analysis.knee.left
          )
            ? analysis.knee.left
            : null,
        rightKneeAngle:
          Number.isFinite(
            analysis.knee.right
          )
            ? analysis.knee.right
            : null,
        phase: analysis.phase,
      })

      // =====================================================
      // REP EVENT
      // =====================================================

      if (
        analysis.repEvent?.completed
      ) {
        const formReport =
          formAnalyzerRef.current.completeRep({
            timestampMs: timestamp,
            repNumber: analysis.reps,
            accepted:
              !!analysis.repEvent.accepted,
            romDegrees:
              Number.isFinite(
                analysis.repEvent.rom
              )
                ? analysis.repEvent.rom
                : Number.isFinite(
                    analysis.latestRep?.rom
                  )
                  ? analysis.latestRep.rom
                  : null,
          })

        setLatestForm(
          formReport
        )

        const coaching =
          coachServiceRef.current.evaluateRep({
            exercise: 'squat',
            report: formReport,
          })

        setLatestCoach(
          coaching.coaching
        )

        if (
          analysis.repEvent.accepted
        ) {
          setStatus(
            `Rep #${analysis.reps} completed ✓ · form evidence captured`
          )
        } else {
          setStatus(
            `Movement completed but rejected: ${
              analysis.repEvent.reason ??
              'validation'
            } · form evidence captured`
          )
        }
      }

      // =====================================================
      // LATEST REP
      // =====================================================

      if (
        analysis.latestRep
      ) {
        setLatestRep(
          analysis.latestRep
        )

        if (
          Number.isFinite(
            analysis.latestRep.rom
          )
        ) {
          setRom(
            analysis.latestRep.rom
          )
        }
      }
    } catch (error) {
      console.error(
        'Pose processing error:',
        error
      )

      setStatus(
        error instanceof Error
          ? `Pose error: ${error.message}`
          : 'Pose processing error'
      )
    }

    // =======================================================
    // NEXT FRAME
    // =======================================================

    if (
      processingActiveRef.current
    ) {
      animationFrameRef.current =
        requestAnimationFrame(
          processCurrentFrame
        )
    } else {
      animationFrameRef.current =
        null
    }
  }


  // =========================================================
  // START AI PROCESSING
  // =========================================================

  function startProcessing() {
    if (
      processingActiveRef.current
    ) {
      return
    }

    if (
      !poseLandmarkerRef.current
    ) {
      setStatus(
        'MediaPipe is still loading...'
      )

      return
    }

    processingActiveRef.current =
      true

    setCameraReady(true)

    animationFrameRef.current =
      requestAnimationFrame(
        processCurrentFrame
      )
  }


  // =========================================================
  // CAMERA MODE
  // =========================================================

  async function handleCamera() {
    stopSource()

    setMode('camera')

    setStatus(
      'Requesting camera...'
    )

    try {
      const stream =
        await navigator.mediaDevices.getUserMedia(
          {
            video: {
              facingMode:
                'user',

              width: {
                ideal: 1280,
              },

              height: {
                ideal: 720,
              },
            },

            audio: false,
          }
        )

      streamRef.current =
        stream

      const video =
        videoRef.current

      if (!video) {
        throw new Error(
          'Video element not available.'
        )
      }

      video.srcObject =
        stream

      video.removeAttribute(
        'src'
      )

      video.muted =
        true

      video.playsInline =
        true

      video.controls =
        false

      endedRef.current =
        false

      video.onplay =
        () => {
          startProcessing()
        }

      video.onpause =
        () => {
          stopProcessing()

          clearCanvas()
        }

      video.onseeked =
        () => {
          resetAnalysis()

          clearCanvas()
        }

      video.onended =
        () => {
          stopProcessing()

          clearCanvas()

          setCameraReady(false)

          setStatus(
            `Camera stream ended — ${squatAnalyzerRef.current.repEngine.reps} squat reps`
          )
        }

      await video.play()

      setCameraReady(true)

      setStatus(
        'Camera running ✓'
      )
    } catch (error) {
      console.error(
        'Camera error:',
        error
      )

      setCameraReady(false)

      if (
        error?.name ===
        'NotFoundError'
      ) {
        setStatus(
          'No camera found — use Upload Video'
        )
      } else if (
        error?.name ===
        'NotAllowedError'
      ) {
        setStatus(
          'Camera permission denied — use Upload Video'
        )
      } else {
        setStatus(
          error instanceof Error
            ? error.message
            : 'Camera could not be started'
        )
      }
    }
  }


  // =========================================================
  // VIDEO UPLOAD
  // =========================================================

  function handleVideoFile(event) {
    const file =
      event.target.files?.[0]

    if (!file) {
      return
    }

    stopSource()

    if (
      !file.type.startsWith(
        'video/'
      )
    ) {
      setStatus(
        'Please select a video file.'
      )

      return
    }

    const url =
      URL.createObjectURL(
        file
      )

    videoUrlRef.current =
      url

    setMode('video')

    setSourceName(
      file.name
    )

    endedRef.current =
      false

    const video =
      videoRef.current

    if (!video) {
      setStatus(
        'Video element not available.'
      )

      return
    }

    video.srcObject =
      null

    video.src =
      url

    video.muted =
      true

    video.playsInline =
      true

    video.controls =
      true

    // =======================================================
    // PLAY
    // =======================================================

    video.onplay =
      () => {
        // If the browser is replaying a video that already
        // reached the end, start a completely fresh analysis.
        if (
          endedRef.current
        ) {
          endedRef.current =
            false

          resetAnalysis()

          clearCanvas()
        }

        startProcessing()

        setStatus(
          'Analyzing uploaded video...'
        )
      }

    // =======================================================
    // PAUSE
    // =======================================================

    video.onpause =
      () => {
        stopProcessing()

        clearCanvas()
      }

    // =======================================================
    // SEEK
    // =======================================================

    video.onseeked =
      () => {
        // Previous temporal information is no longer valid
        // after a seek, so start the analysis state over.
        resetAnalysis()

        clearCanvas()
      }

    // =======================================================
    // END
    // =======================================================

    video.onended =
      () => {
        stopProcessing()

        clearCanvas()

        setCameraReady(false)

        endedRef.current =
          true

        const finalReps =
          squatAnalyzerRef.current
            .repEngine
            .reps

        setStatus(
          `Video finished — ${finalReps} squat reps detected`
        )
      }

    // =======================================================
    // METADATA LOADED
    // =======================================================

    video.onloadedmetadata =
      async () => {
        try {
          await video.play()

          setCameraReady(true)

          setStatus(
            'Analyzing uploaded video...'
          )
        } catch (error) {
          console.error(
            'Video playback error:',
            error
          )

          setStatus(
            error instanceof Error
              ? error.message
              : 'Could not play video'
          )
        }
      }
  }


  // =========================================================
  // RENDER
  // =========================================================

  return (
    <div
      style={{
        minHeight:
          '100vh',

        background:
          '#0d0f12',

        color:
          '#fff',

        padding:
          24,

        boxSizing:
          'border-box',
      }}
    >
      <div
        style={{
          width:
            '100%',

          maxWidth:
            1050,

          margin:
            '0 auto',
        }}
      >
        <h1
          style={{
            marginBottom:
              8,
          }}
        >
          Live Pose Test
        </h1>

        <p
          style={{
            marginTop:
              0,

            color:
              '#aeb4bd',
          }}
        >
          MediaPipe → filtering → squat analysis →
          form analysis → rule-based coaching
        </p>

        {/* =================================================
            SOURCE BUTTONS
        ================================================= */}

        <div
          style={{
            display:
              'flex',

            gap:
              10,

            flexWrap:
              'wrap',

            marginBottom:
              16,
          }}
        >
          <button
            type="button"
            onClick={
              handleCamera
            }
            style={{
              border:
                0,

              borderRadius:
                10,

              padding:
                '12px 18px',

              cursor:
                'pointer',

              background:
                '#22c55e',

              color:
                '#07110a',

              fontWeight:
                700,
            }}
          >
            📷 Use Camera
          </button>

          <button
            type="button"
            onClick={() =>
              fileInputRef.current?.click()
            }
            style={{
              border:
                0,

              borderRadius:
                10,

              padding:
                '12px 18px',

              cursor:
                'pointer',

              background:
                '#30343b',

              color:
                '#fff',

              fontWeight:
                700,
            }}
          >
            📁 Upload Video
          </button>

          <input
            ref={
              fileInputRef
            }
            type="file"
            accept="video/*"
            onChange={
              handleVideoFile
            }
            style={{
              display:
                'none',
            }}
          />
        </div>

        {/* =================================================
            SOURCE NAME
        ================================================= */}

        {sourceName && (
          <div
            style={{
              color:
                '#aeb4bd',

              marginBottom:
                12,

              fontSize:
                14,
            }}
          >
            Video: {sourceName}
          </div>
        )}

        {/* =================================================
            VIDEO
        ================================================= */}

        <div
          style={{
            position:
              'relative',

            width:
              '100%',

            aspectRatio:
              '16 / 9',

            overflow:
              'hidden',

            borderRadius:
              16,

            background:
              '#000',

            border:
              '1px solid #2a2f36',
          }}
        >
          <video
            ref={
              videoRef
            }
            autoPlay
            muted
            playsInline
            style={{
              position:
                'absolute',

              inset:
                0,

              width:
                '100%',

              height:
                '100%',

              objectFit:
                'contain',
            }}
          />

          <canvas
            ref={
              canvasRef
            }
            style={{
              position:
                'absolute',

              inset:
                0,

              width:
                '100%',

              height:
                '100%',

              objectFit:
                'contain',

              pointerEvents:
                'none',
            }}
          />

          {/* =================================================
              REP HUD
          ================================================= */}

          <div
            style={{
              position:
                'absolute',

              top:
                16,

              left:
                16,

              padding:
                '12px 16px',

              borderRadius:
                14,

              background:
                'rgba(0, 0, 0, 0.72)',

              backdropFilter:
                'blur(8px)',
            }}
          >
            <div
              style={{
                fontSize:
                  12,

                color:
                  '#9ca3af',
              }}
            >
              SQUAT REPS
            </div>

            <div
              style={{
                fontSize:
                  36,

                lineHeight:
                  1,

                fontWeight:
                  900,

                marginTop:
                  4,
              }}
            >
              {reps}
            </div>
          </div>
        </div>

        {/* =================================================
            STATUS
        ================================================= */}

        <div
          style={{
            marginTop:
              16,

            display:
              'grid',

            gridTemplateColumns:
              'repeat(3, minmax(0, 1fr))',

            gap:
              12,
          }}
        >
          <InfoCard
            title="Status"
            value={status}
          />

          <InfoCard
            title="Source"
            value={
              mode === 'camera'
                ? 'Camera'
                : mode === 'video'
                  ? 'Uploaded video'
                  : 'None'
            }
          />

          <InfoCard
            title="Detection / FPS"
            value={`${personDetected ? 'Person ✓' : 'Searching...'} · ${fps} FPS`}
          />
        </div>

        {/* =================================================
            TELEMETRY
        ================================================= */}

        <div
          style={{
            marginTop:
              12,

            display:
              'grid',

            gridTemplateColumns:
              'repeat(4, minmax(0, 1fr))',

            gap:
              12,
          }}
        >
          <InfoCard
            title="Phase"
            value={phase}
          />

          <InfoCard
            title="Left Knee"
            value={
              Number.isFinite(
                leftKnee
              )
                ? `${leftKnee.toFixed(1)}°`
                : '—'
            }
          />

          <InfoCard
            title="Right Knee"
            value={
              Number.isFinite(
                rightKnee
              )
                ? `${rightKnee.toFixed(1)}°`
                : '—'
            }
          />

          <InfoCard
            title="Average Knee"
            value={
              Number.isFinite(
                averageKnee
              )
                ? `${averageKnee.toFixed(1)}°`
                : '—'
            }
          />
        </div>

        {/* =================================================
            QUALITY / ROM
        ================================================= */}

        <div
          style={{
            marginTop:
              12,

            display:
              'grid',

            gridTemplateColumns:
              'repeat(3, minmax(0, 1fr))',

            gap:
              12,
          }}
        >
          <InfoCard
            title="Pose Quality"
            value={
              poseQuality
                ? `${(
                    poseQuality.score *
                    100
                  ).toFixed(0)}% · ${
                    poseQuality.visibleLandmarks
                  }/${
                    poseQuality.totalLandmarks
                  } visible`
                : '—'
            }
          />

          <InfoCard
            title="Latest ROM"
            value={
              Number.isFinite(
                rom
              )
                ? `${rom.toFixed(1)}°`
                : '—'
            }
          />

          <InfoCard
            title="Latest Rep"
            value={
              latestRep
                ? `#${latestRep.number} · ${
                    latestRep.accepted
                      ? 'Accepted'
                      : 'Rejected'
                  }`
                : '—'
            }
          />
        </div>

        {/* =================================================
            LAST REP DETAIL
        ================================================= */}

        {latestRep && (
          <div
            style={{
              marginTop:
                12,

              padding:
                16,

              borderRadius:
                12,

              background:
                '#171a1f',
            }}
          >
            <div
              style={{
                fontWeight:
                  700,

                marginBottom:
                  10,
              }}
            >
              Rep #{latestRep.number}
            </div>

            <div
              style={{
                display:
                  'grid',

                gridTemplateColumns:
                  'repeat(4, minmax(0, 1fr))',

                gap:
                  12,

                color:
                  '#c5cbd3',

                fontSize:
                  14,
              }}
            >
              <div>
                ROM:{' '}
                {Number.isFinite(
                  latestRep.rom
                )
                  ? `${latestRep.rom.toFixed(
                      1
                    )}°`
                  : '—'}
              </div>

              <div>
                Duration:{' '}
                {Number.isFinite(
                  latestRep.durationMs
                )
                  ? `${Math.round(
                      latestRep.durationMs
                    )} ms`
                  : '—'}
              </div>

              <div>
                Min knee:{' '}
                {Number.isFinite(
                  latestRep.minimumKneeAngle
                )
                  ? `${latestRep.minimumKneeAngle.toFixed(
                      1
                    )}°`
                  : '—'}
              </div>

              <div>
                Asymmetry:{' '}
                {Number.isFinite(
                  latestRep.maximumKneeAsymmetry
                )
                  ? `${latestRep.maximumKneeAsymmetry.toFixed(
                      1
                    )}°`
                  : '—'}
              </div>
            </div>
          </div>
        )}

        {latestForm && (
          <div
            style={{
              marginTop:
                12,

              padding:
                16,

              borderRadius:
                12,

              background:
                '#171a1f',
            }}
          >
            <div
              style={{
                fontWeight:
                  700,

                marginBottom:
                  8,
              }}
            >
              Coach
            </div>

            {latestCoach && (
              <div
                style={{
                  color:
                    '#ffffff',

                  fontSize:
                    15,

                  lineHeight:
                    1.55,
                }}
              >
                {latestCoach}
              </div>
            )}

            <div
              style={{
                marginTop:
                  12,

                color:
                  '#8f96a0',

                fontSize:
                  13,

                lineHeight:
                  1.5,
              }}
            >
              Rule-based coaching · book v1.0.0 · Rep #{latestForm.repNumber}
            </div>
          </div>
        )}

        {/* =================================================
            PIPELINE
        ================================================= */}

        <div
          style={{
            marginTop:
              16,

            padding:
              16,

            borderRadius:
              12,

            background:
              '#111318',

            color:
              '#8f96a0',

            fontSize:
              13,

            lineHeight:
              1.6,
          }}
        >
          <div
            style={{
              color:
                '#fff',

              fontWeight:
                700,

              marginBottom:
                8,
            }}
          >
            AI pipeline
          </div>

          <div>
            MediaPipe → PoseFrame → One Euro →
            SquatAnalyzer → RepStateMachine →
            SquatFormAnalyzer → Rule Coach → Feedback
          </div>
        </div>
      </div>
    </div>
  )
}


// ===========================================================
// INFO CARD
// ===========================================================

function InfoCard({
  title,
  value,
}) {
  return (
    <div
      style={{
        background:
          '#171a1f',

        borderRadius:
          12,

        padding:
          16,

        minWidth:
          0,
      }}
    >
      <div
        style={{
          color:
            '#8f96a0',

          fontSize:
            13,
        }}
      >
        {title}
      </div>

      <div
        style={{
          marginTop:
            6,

          fontWeight:
            600,

          overflowWrap:
            'anywhere',
        }}
      >
        {value}
      </div>
    </div>
  )
}