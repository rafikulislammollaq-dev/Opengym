import { useEffect, useRef, useState } from 'react'
import {
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils,
} from '@mediapipe/tasks-vision'

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

export default function LivePoseTest() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)

  const poseLandmarkerRef = useRef(null)
  const animationFrameRef = useRef(null)
  const streamRef = useRef(null)
  const videoUrlRef = useRef(null)

  const [status, setStatus] = useState('Loading MediaPipe...')
  const [mode, setMode] = useState('none')
  const [cameraReady, setCameraReady] = useState(false)
  const [personDetected, setPersonDetected] = useState(false)
  const [fps, setFps] = useState(0)
  const [videoName, setVideoName] = useState('')

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      try {
        setStatus('Loading MediaPipe...')

        const vision = await FilesetResolver.forVisionTasks(WASM_URL)

        let poseLandmarker

        try {
          poseLandmarker = await PoseLandmarker.createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath: MODEL_URL,
                delegate: 'GPU',
              },
              runningMode: 'VIDEO',
              numPoses: 1,
              minPoseDetectionConfidence: 0.5,
              minPosePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            }
          )
        } catch (gpuError) {
          console.warn(
            'GPU delegate failed. Falling back to CPU.',
            gpuError
          )

          poseLandmarker = await PoseLandmarker.createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath: MODEL_URL,
                delegate: 'CPU',
              },
              runningMode: 'VIDEO',
              numPoses: 1,
              minPoseDetectionConfidence: 0.5,
              minPosePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            }
          )
        }

        if (cancelled) {
          poseLandmarker.close()
          return
        }

        poseLandmarkerRef.current = poseLandmarker
        setStatus('MediaPipe ready ✓ — choose Camera or Upload Video')
      } catch (error) {
        console.error('MediaPipe initialization failed:', error)

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

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }

      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current)
      }

      if (poseLandmarkerRef.current) {
        poseLandmarkerRef.current.close()
        poseLandmarkerRef.current = null
      }
    }
  }, [])

  const stopProcessing = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.srcObject = null
    }

    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current)
      videoUrlRef.current = null
    }

    const canvas = canvasRef.current

    if (canvas) {
      const ctx = canvas.getContext('2d')

      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }

    setCameraReady(false)
    setPersonDetected(false)
    setFps(0)
  }

  const processVideo = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const poseLandmarker = poseLandmarkerRef.current

    if (!video || !canvas || !poseLandmarker) {
      return
    }

    const ctx = canvas.getContext('2d')

    if (!ctx) {
      return
    }

    const drawingUtils = new DrawingUtils(ctx)

    let frames = 0
    let fpsStart = performance.now()

    const loop = () => {
      if (!video || video.readyState < 2) {
        animationFrameRef.current = requestAnimationFrame(loop)
        return
      }

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        animationFrameRef.current = requestAnimationFrame(loop)
        return
      }

      if (
        canvas.width !== video.videoWidth ||
        canvas.height !== video.videoHeight
      ) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const timestamp = performance.now()

      try {
        const result = poseLandmarker.detectForVideo(
          video,
          timestamp
        )

        const landmarks = result?.landmarks ?? []

        if (landmarks.length > 0) {
          setPersonDetected(true)

          const person = landmarks[0]

          drawingUtils.drawConnectors(
            person,
            PoseLandmarker.POSE_CONNECTIONS
          )

          drawingUtils.drawLandmarks(person, {
            radius: 4,
          })
        } else {
          setPersonDetected(false)
        }

        frames++

        const now = performance.now()

        if (now - fpsStart >= 1000) {
          setFps(frames)
          frames = 0
          fpsStart = now
        }
      } catch (error) {
        console.error('Pose detection error:', error)
      }

      animationFrameRef.current = requestAnimationFrame(loop)
    }

    animationFrameRef.current = requestAnimationFrame(loop)
  }

  const handleCamera = async () => {
    stopProcessing()

    setMode('camera')
    setVideoName('')
    setStatus('Requesting camera...')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })

      streamRef.current = stream

      const video = videoRef.current

      if (!video) {
        throw new Error('Video element not available')
      }

      video.srcObject = stream
      video.muted = true
      video.playsInline = true

      await video.play()

      setCameraReady(true)
      setStatus('Camera running ✓')

      processVideo()
    } catch (error) {
      console.error('Camera error:', error)

      setCameraReady(false)

      if (error?.name === 'NotFoundError') {
        setStatus(
          'No camera found — use Upload Video instead'
        )
      } else if (error?.name === 'NotAllowedError') {
        setStatus(
          'Camera permission denied — use Upload Video instead'
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

  const handleVideoFile = event => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    stopProcessing()

    if (!file.type.startsWith('video/')) {
      setStatus('Please choose a video file.')
      return
    }

    const videoUrl = URL.createObjectURL(file)

    videoUrlRef.current = videoUrl

    setMode('video')
    setVideoName(file.name)

    const video = videoRef.current

    if (!video) {
      setStatus('Video element not available')
      return
    }

    video.srcObject = null
    video.src = videoUrl
    video.muted = true
    video.playsInline = true
    video.controls = true

    video.onloadedmetadata = async () => {
      try {
        await video.play()

        setCameraReady(true)
        setStatus('Analyzing uploaded video...')

        processVideo()
      } catch (error) {
        console.error('Video playback error:', error)

        setStatus(
          error instanceof Error
            ? error.message
            : 'Could not play video'
        )
      }
    }
  }

  const handleVideoEnded = () => {
    setStatus('Video finished ✓')
    setCameraReady(false)

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0d0f12',
        color: '#fff',
        padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 1000,
          margin: '0 auto',
        }}
      >
        <h1 style={{ marginBottom: 8 }}>
          Live Pose Test
        </h1>

        <p
          style={{
            marginTop: 0,
            color: '#aeb4bd',
          }}
        >
          MediaPipe Pose Landmarker — AI checkpoint
        </p>

        <div
          style={{
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: 16,
          }}
        >
          <button
            type="button"
            onClick={handleCamera}
            style={{
              border: 0,
              borderRadius: 10,
              padding: '12px 18px',
              cursor: 'pointer',
              background: '#22c55e',
              color: '#07110a',
              fontWeight: 700,
            }}
          >
            📷 Use Camera
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: 0,
              borderRadius: 10,
              padding: '12px 18px',
              cursor: 'pointer',
              background: '#30343b',
              color: '#fff',
              fontWeight: 700,
            }}
          >
            📁 Upload Video
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleVideoFile}
            style={{ display: 'none' }}
          />
        </div>

        {videoName && (
          <div
            style={{
              color: '#aeb4bd',
              marginBottom: 12,
              fontSize: 14,
            }}
          >
            Video: {videoName}
          </div>
        )}

        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '16 / 9',
            overflow: 'hidden',
            borderRadius: 16,
            background: '#000',
            border: '1px solid #2a2f36',
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            onEnded={handleVideoEnded}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />

          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              pointerEvents: 'none',
            }}
          />
        </div>

        <div
          style={{
            marginTop: 16,
            display: 'grid',
            gridTemplateColumns:
              'repeat(3, minmax(0, 1fr))',
            gap: 12,
          }}
        >
          <div
            style={{
              background: '#171a1f',
              borderRadius: 12,
              padding: 16,
            }}
          >
            <div
              style={{
                color: '#8f96a0',
                fontSize: 13,
              }}
            >
              Status
            </div>

            <div style={{ marginTop: 6 }}>
              {status}
            </div>
          </div>

          <div
            style={{
              background: '#171a1f',
              borderRadius: 12,
              padding: 16,
            }}
          >
            <div
              style={{
                color: '#8f96a0',
                fontSize: 13,
              }}
            >
              Source
            </div>

            <div style={{ marginTop: 6 }}>
              {mode === 'camera'
                ? 'Camera'
                : mode === 'video'
                  ? 'Uploaded video'
                  : 'None'}
            </div>
          </div>

          <div
            style={{
              background: '#171a1f',
              borderRadius: 12,
              padding: 16,
            }}
          >
            <div
              style={{
                color: '#8f96a0',
                fontSize: 13,
              }}
            >
              Detection / FPS
            </div>

            <div style={{ marginTop: 6 }}>
              {personDetected
                ? 'Person ✓'
                : 'Searching...'}{' '}
              · {fps} FPS
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}