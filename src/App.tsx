/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { Camera, Eye, Info, ShieldAlert, Sliders, ToggleLeft, ToggleRight, Layout, CheckCircle, HelpCircle } from 'lucide-react';
import { TrackingResult, ViewMode, CalibrationData, ModelType } from './types';
import { initFaceLandmarker, estimateHeadPose, extractEyeData } from './utils/mediaPipeHelper';
import ThreeCanvas from './components/ThreeCanvas';
import TrackingStatus from './components/TrackingStatus';

export default function App() {
  // Navigation & Toggle States
  const [viewMode, setViewMode] = useState<ViewMode>('observer');
  const [selectedModel, setSelectedModel] = useState<ModelType>('reactor');
  const [showLandmarks, setShowLandmarks] = useState<boolean>(true);
  const [showGazeLasers, setShowGazeLasers] = useState<boolean>(true);
  
  // Model & Camera loading states
  const [modelLoading, setModelLoading] = useState<boolean>(true);
  const [modelError, setModelError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);

  // Tracking metrics states
  const [trackingResult, setTrackingResult] = useState<TrackingResult | null>(null);
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);
  const [calibrationStep, setCalibrationStep] = useState<number>(0);
  const [calibrationData, setCalibrationData] = useState<CalibrationData>({
    points: [],
    isCalibrated: false
  });

  // HTML Element references
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  // Rolling frame variables for real-time FPS estimation
  const fpsTicksRef = useRef<number[]>([]);
  const [fps, setFps] = useState<number>(0);

  // --- 1. INITIALIZE MEDIAPIPE FACE LANDMARKER ---
  useEffect(() => {
    let active = true;
    setModelLoading(true);
    
    initFaceLandmarker()
      .then((landmarker) => {
        if (!active) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setModelLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load FaceLandmarker weights:", err);
        if (active) {
          setModelError(
            "WASM/Task initialization failed. Make sure you are connected to the network to fetch the face-landmarker weights."
          );
          setModelLoading(false);
        }
      });

    return () => {
      active = false;
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }
    };
  }, []);

  // --- 2. WEBCAM STEAM IMPLEMENTATION ---
  const startWebcam = async () => {
    // Shutdown any active tracking frames or webcam streams beforehand
    stopWebcam();
    setPermissionDenied(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
          frameRate: { ideal: 30 }
        },
        audio: false
      });

      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().then(() => {
            setCameraActive(true);
            // Initiate the main processing frame loop
            startTrackingLoop();
          });
        };
      }
    } catch (err: any) {
      console.warn("Camera grant rejected:", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setPermissionDenied(true);
      } else {
        setModelError(`Webcam activation failed: ${err.message || err}`);
      }
      setCameraActive(false);
    }
  };

  const stopWebcam = () => {
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setTrackingResult(null);
  };

  // Safe release on unmount
  useEffect(() => {
    return () => {
      stopWebcam();
    };
  }, []);

  // --- 3. LIVE TRACKING LOOP & DEBUGS DRAWING ---
  const startTrackingLoop = () => {
    let lastVideoTime = -1;
    
    const tick = () => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;

      if (!video || !landmarker || video.paused || video.ended) {
        animationFrameIdRef.current = requestAnimationFrame(tick);
        return;
      }

      // Check for frame update to skip redundant computation
      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const timestampMs = performance.now();

        // RUN MEDIA-PIPE ON DEVICE DETECTOR
        const results = landmarker.detectForVideo(video, timestampMs);

        // Track and compute FPS
        const now = performance.now();
        fpsTicksRef.current = fpsTicksRef.current.filter((tickTime) => now - tickTime < 1000);
        fpsTicksRef.current.push(now);
        const currentFps = fpsTicksRef.current.length;
        setFps(currentFps);

        if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
          const landmarks = results.faceLandmarks[0];
          
          // Calculate coordinates & physical landmarks
          const eyeData = extractEyeData(landmarks);
          const headPose = estimateHeadPose(landmarks);

          const resultPayload: TrackingResult = {
            landmarks,
            eyeData,
            headRotation: headPose.rotation,
            headTranslation: headPose.translation,
            fps: currentFps,
          };

          setTrackingResult(resultPayload);

          // Draw the 2D overlays on top of the webcam feed
          draw2DOverlay(landmarks, eyeData);
        } else {
          // Reset status on signal tracking loss
          setTrackingResult(null);
          clearOverlay();
        }
      }

      animationFrameIdRef.current = requestAnimationFrame(tick);
    };

    animationFrameIdRef.current = requestAnimationFrame(tick);
  };

  // Clears the 2D SVG canvas overlay
  const clearOverlay = () => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // Renders beautiful glowing overlays on the 2D camera viewport to demonstrate tracking logic
  const draw2DOverlay = (landmarks: any[], eyeData: any) => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    // Direct resolution syncing
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // If landmarks display is disabled, don't waste CPU/GPU cycles drawing anything
    if (!showLandmarks) return;

    const w = canvas.width;
    const h = canvas.height;

    // Draw full face nodes as fine cyan points to show facial topology coverage
    ctx.fillStyle = 'rgba(0, 242, 254, 0.45)';
    // Render every 4th landmark for visibility performance in 2D debugger
    for (let i = 0; i < landmarks.length; i += 3) {
      const pt = landmarks[i];
      ctx.fillRect(pt.x * w - 1, pt.y * h - 1, 2, 2);
    }

    // Highlight eye contour grids (Left: indices around left eye, Right: indices around right eye)
    const drawContour = (indices: number[], color: string) => {
      ctx.beginPath();
      indices.forEach((idx, i) => {
        const pt = landmarks[idx];
        if (i === 0) ctx.moveTo(pt.x * w, pt.y * h);
        else ctx.lineTo(pt.x * w, pt.y * h);
      });
      ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    // Index lists of critical contours:
    const leftEyeContour = [33, 160, 158, 133, 153, 144];
    const rightEyeContour = [263, 387, 385, 362, 380, 373];

    drawContour(leftEyeContour, '#00f2fe'); // Cyan
    drawContour(rightEyeContour, '#00f2fe');

    // Highlight Irises with floating target indicators in neon pink
    if (eyeData.isTracking) {
      const leftIris = eyeData.leftIrisCenter;
      const rightIris = eyeData.rightIrisCenter;

      // Draw left iris target crosshair
      ctx.beginPath();
      ctx.arc(leftIris.x * w, leftIris.y * h, 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff0055'; // Intense pink
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.fillStyle = '#ff0055';
      ctx.beginPath();
      ctx.arc(leftIris.x * w, leftIris.y * h, 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Draw right iris target crosshair
      ctx.beginPath();
      ctx.arc(rightIris.x * w, rightIris.y * h, 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff0055';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(rightIris.x * w, rightIris.y * h, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // --- 4. GAZE CALIBRATION WIZARD ---
  const triggerCalibration = () => {
    setIsCalibrating(true);
    setCalibrationStep(0);
    setCalibrationData({
      points: [],
      isCalibrated: false,
    });
  };

  const handleCalibrationPress = () => {
    if (!trackingResult) return;

    // Capture user's eye gaze translation coordinate when they focus on the specific dynamic target
    const currentEyeX = 0.5 - (trackingResult.eyeData.leftIrisCenter.x + trackingResult.eyeData.rightIrisCenter.x) * 0.5;
    const currentEyeY = 0.5 - (trackingResult.eyeData.leftIrisCenter.y + trackingResult.eyeData.rightIrisCenter.y) * 0.5;

    // Define coordinates of calibration targets relative to screen bounds: -1 to 1 space
    const targetPoints = [
      { x: -0.8, y: -0.8 }, // Top Left
      { x: 0.8, y: -0.8 },  // Top Right
      { x: 0, y: 0 },       // Center
      { x: -0.8, y: 0.8 },  // Bottom Left
      { x: 0.8, y: 0.8 }    // Bottom Right
    ];

    const currentTarget = targetPoints[calibrationStep];
    const updatedPoints = [
      ...calibrationData.points,
      { x: currentTarget.x, y: currentTarget.y, trackedX: currentEyeX, trackedY: currentEyeY }
    ];

    if (calibrationStep < 4) {
      setCalibrationData((prev) => ({
        ...prev,
        points: updatedPoints
      }));
      setCalibrationStep((prev) => prev + 1);
    } else {
      // Completed last point calibration mapping!
      setCalibrationData({
        points: updatedPoints,
        isCalibrated: true
      });
      setIsCalibrating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070a13] text-slate-100 flex flex-col font-sans relative antialiased selecet-none">
      
      {/* Background radial gradient decoration */}
      <div className="absolute top-0 left-0 w-full h-[500px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950/25 via-[#070a13] to-transparent pointer-events-none z-0" />

      {/* --- DASHBOARD HEADER --- */}
      <header className="border-b border-slate-800/60 bg-[#070a13]/80 backdrop-blur-md px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center p-0.5 shadow-lg shadow-indigo-950/40">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Eye className="w-5 h-5 text-cyan-400" />
            </div>
          </div>
          <div>
            <h1 className="text-sm font-bold font-mono tracking-wider text-slate-200 uppercase flex items-center gap-2">
              3D EYE & FACE TRACKING LABORATORY
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-300 font-normal border border-cyan-800/40 font-mono">
                v1.1
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Interactive WebGL head perspective maps & depth parallax virtual room.
            </p>
          </div>
        </div>

        {/* Global Connection Trigger Controls */}
        <div className="flex items-center gap-3">
          {cameraActive ? (
            <button
              onClick={stopWebcam}
              type="button"
              id="deactivate-camera-btn"
              className="px-4 py-2 rounded-lg bg-rose-600/10 border border-rose-500/30 hover:bg-rose-600 hover:text-white text-rose-300 text-xs font-mono font-bold transition flex items-center gap-2 shadow-md hover:shadow-rose-950/20 active:scale-[0.98] cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              DEACTIVATE CAM
            </button>
          ) : (
            <button
              onClick={startWebcam}
              disabled={modelLoading}
              type="button"
              id="activate-camera-btn"
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white text-xs font-mono font-bold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 hover:shadow-lg hover:shadow-cyan-950/40 active:scale-[0.98] cursor-pointer"
            >
              <Camera className="w-4 h-4 animate-bounce" />
              {modelLoading ? 'INITIALIZING ENGINE...' : 'ACTIVATE TARGET CAMERA'}
            </button>
          )}
        </div>
      </header>

      {/* --- DASHBOARD LAYOUT GRID --- */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-4 gap-6 z-10">
        
        {/* LEFT COLUMN: PRIMARY 3D VIEWPORT CONTAINER */}
        <section className="lg:col-span-3 flex flex-col gap-4 min-h-[500px]">
          {/* Virtual Museum 3D Exhibit Selector */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h2 className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-4 h-4" />
                3D ARTIFACT EXHIBIT SELECTOR
              </h2>
              <p className="text-[11px] text-slate-400 font-sans mt-0.5">
                Choose a 3D construct to inspect and manipulate with active perspective head-tracking.
              </p>
            </div>
            
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setSelectedModel('reactor')}
                className={`flex-1 sm:flex-initial py-2 px-3 rounded-lg text-xs font-mono font-bold transition-all border flex items-center justify-center gap-1.5 cursor-pointer select-none ${
                  selectedModel === 'reactor'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/40 shadow-inner'
                    : 'bg-slate-950/40 text-slate-400 border-slate-800/40 hover:bg-slate-950/85 hover:text-slate-200'
                }`}
              >
                <span>🤖</span> REACTOR
              </button>

              <button
                type="button"
                onClick={() => setSelectedModel('city')}
                className={`flex-1 sm:flex-initial py-2 px-3 rounded-lg text-xs font-mono font-bold transition-all border flex items-center justify-center gap-1.5 cursor-pointer select-none ${
                  selectedModel === 'city'
                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/40 shadow-inner'
                    : 'bg-slate-950/40 text-slate-400 border-slate-800/40 hover:bg-slate-950/85 hover:text-slate-200'
                }`}
              >
                <span>🏙️</span> CYBER CITY
              </button>

              <button
                type="button"
                onClick={() => setSelectedModel('orrery')}
                className={`flex-1 sm:flex-initial py-2 px-3 rounded-lg text-xs font-mono font-bold transition-all border flex items-center justify-center gap-1.5 cursor-pointer select-none ${
                  selectedModel === 'orrery'
                    ? 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/40 shadow-inner'
                    : 'bg-slate-950/40 text-slate-400 border-slate-800/40 hover:bg-slate-950/85 hover:text-slate-200'
                }`}
              >
                <span>🌌</span> ORRERY
              </button>
            </div>
          </div>

          {/* Main 3D Screen */}
          <div className="flex-1 relative min-h-[400px]">
            <ThreeCanvas
              trackingResult={trackingResult}
              viewMode={viewMode}
              showLandmarks={showLandmarks}
              showGazeLasers={showGazeLasers}
              isBilateralSymmetric={isCalibrating}
              selectedModel={selectedModel}
            />

            {!cameraActive && (
              <div className="absolute top-12 left-4 z-20 max-w-[280px] p-4 rounded-xl bg-slate-950/85 backdrop-blur-md border border-slate-800 shadow-2xl pointer-events-auto flex flex-col gap-2 font-mono text-[10px]">
                <div className="flex items-center gap-1.5 text-amber-500 font-bold uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                  Gaze perspective: offline
                </div>
                <p className="text-slate-400 leading-relaxed font-sans text-xs">
                  Showing mouse hover parallax fallback. Activate the target camera to map your head perspective in real-time.
                </p>
                {permissionDenied ? (
                  <div className="text-[10px] text-rose-400 border border-rose-950 p-2 rounded bg-rose-950/30 font-sans mt-1">
                    Camera access blocked. Enable camera permission in your browser address bar.
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={startWebcam}
                    disabled={modelLoading}
                    id="activate-canvas-overlay-btn"
                    className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold tracking-wide transition flex items-center justify-center gap-1.5 cursor-pointer text-[10px]"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    ACTIVATE CAMERA SENSING
                  </button>
                )}
              </div>
            )}

            {/* Calibration overlay target pointer */}
            {isCalibrating && (
              <div className="absolute inset-0 z-30 bg-[#070a13]/85 flex items-center justify-center p-6 backdrop-blur-sm">
                <div className="bg-slate-900/90 max-w-md w-full p-6 rounded-2xl border border-indigo-500/30 text-center flex flex-col items-center shadow-2xl relative">
                  <div className="text-indigo-400 font-mono text-[10px] uppercase font-bold tracking-widest mb-1.5 flex items-center gap-1">
                    <Sliders className="w-3.5 h-3.5" />
                    GAZE ROTATION REGISTER STEP {calibrationStep + 1} OF 5
                  </div>
                  
                  <h3 className="text-sm font-bold text-slate-200 mb-2">
                    Adjust Your Screen Focus Gaze
                  </h3>

                  <p className="text-xs text-slate-400 mb-6 leading-relaxed">
                    Look directly at the <strong className="text-indigo-300">glowing target outer bounding point</strong> below, keeping your head steady. Click the register button when looking at it.
                  </p>

                  {/* Representative calibration locator visual */}
                  <div className="w-full h-32 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-center mb-6 relative overflow-hidden">
                    {/* Render target point based on calibrationStep */}
                    <div 
                      className="absolute p-4 flex items-center justify-center"
                      style={{
                        left: `${(0.5 + [ -0.35, 0.35, 0, -0.35, 0.35 ][calibrationStep]) * 100}%`,
                        top: `${(0.5 + [ -0.3, -0.3, 0, 0.3, 0.3 ][calibrationStep]) * 100}%`,
                        transform: 'translate(-50%, -50%)'
                      }}
                    >
                      <span className="absolute w-6 h-6 rounded-full border-2 border-cyan-400 animate-ping opacity-60"></span>
                      <span className="absolute w-4 h-4 rounded-full border-2 border-cyan-400 animate-pulse"></span>
                      <span className="w-2 h-2 bg-cyan-400 rounded-full"></span>
                    </div>
                  </div>

                  <div className="flex gap-3 w-full">
                    <button
                      onClick={() => setIsCalibrating(false)}
                      type="button"
                      id="cancel-calibration-btn"
                      className="flex-1 py-2 px-3 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-900 text-slate-400 font-mono text-xs font-semibold cursor-pointer transition"
                    >
                      ABORT
                    </button>
                    <button
                      onClick={handleCalibrationPress}
                      type="button"
                      id="register-calibration-point-btn"
                      className="flex-1 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-semibold shadow-md cursor-pointer transition active:scale-[0.98]"
                    >
                      REGISTER FOCUS
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Toolbar Options BAR */}
          <div className="p-4 bg-slate-900/40 border border-slate-800/80 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 z-10">
            {/* View Mode selections */}
            <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
              {/* Observer View Mode */}
              <button
                onClick={() => setViewMode('observer')}
                type="button"
                id="select-observer-btn"
                className={`py-2 px-4 rounded-xl text-xs font-mono font-bold transition flex items-center gap-2 cursor-pointer ${
                  viewMode === 'observer'
                    ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-950/20 border border-cyan-500/30'
                    : 'bg-slate-950/60 text-slate-400 hover:bg-slate-950 border border-slate-800/50 hover:text-slate-200'
                }`}
              >
                <Layout className="w-4 h-4" />
                OBSERVER 3D VIEW (FACEMESH)
              </button>

              {/* Parallax View Mode */}
              <button
                onClick={() => setViewMode('parallax')}
                type="button"
                id="select-parallax-btn"
                className={`py-2 px-4 rounded-xl text-xs font-mono font-bold transition flex items-center gap-2 cursor-pointer ${
                  viewMode === 'parallax'
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950/20 border border-indigo-500/30'
                    : 'bg-slate-950/60 text-slate-400 hover:bg-slate-950 border border-slate-800/50 hover:text-slate-200'
                }`}
              >
                <HelpCircle className="w-4 h-4" />
                ACTIVE PERSPECTIVE PARALLAX
              </button>
            </div>

            {/* Feature rendering toggles */}
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-slate-400">
              <label 
                className="flex items-center gap-2 cursor-pointer hover:text-slate-200 transition" 
                id="toggle-landmarks-lbl"
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={showLandmarks}
                  onChange={(e) => setShowLandmarks(e.target.checked)}
                />
                {showLandmarks ? (
                  <ToggleRight className="w-6 h-6 text-cyan-400" />
                ) : (
                  <ToggleLeft className="w-6 h-6 text-slate-500" />
                )}
                SHOW FACE CYBERMESH
              </label>

              <label 
                className="flex items-center gap-2 cursor-pointer hover:text-slate-200 transition" 
                id="toggle-gaze-lasers-lbl"
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={showGazeLasers}
                  onChange={(e) => setShowGazeLasers(e.target.checked)}
                />
                {showGazeLasers ? (
                  <ToggleRight className="w-6 h-6 text-pink-500" />
                ) : (
                  <ToggleLeft className="w-6 h-6 text-slate-500" />
                )}
                PUPIL GAZE LASERS
              </label>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: REALTIME DIAGNOSTIC WEBCAM PREVIEW & TELEMETRY */}
        <section className="lg:col-span-1 flex flex-col gap-4">
          
          {/* Real-time Video Stream view card */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-2xl p-4 overflow-hidden shadow-lg relative">
            <h3 className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 font-bold">
              <Camera className="w-4 h-4 text-cyan-400" />
              CAMERA INPUT PIPELINE
            </h3>

            {/* Webcam viewport box with mirror representation */}
            <div className="w-full aspect-video rounded-xl bg-slate-950 border border-slate-800/80 overflow-hidden relative">
              <video
                ref={videoRef}
                className={`w-full h-full object-cover scale-x-[-1] ${cameraActive ? 'block' : 'hidden'}`}
                playsInline
                muted
              />
              {cameraActive ? (
                // Overlaid live visualizers showing landmarks
                <div className="absolute inset-0 w-full h-full pointer-events-none">
                  {/* Absolute overlaid debugger canvas */}
                  <canvas
                    ref={overlayCanvasRef}
                    className="absolute inset-0 w-full h-full object-cover scale-x-[-1] pointer-events-none"
                  />
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col justify-center items-center text-slate-600 text-center p-4 bg-slate-950">
                  <Sliders className="w-6 h-6 mb-1 text-slate-700 animate-pulse" />
                  <span className="text-[10px] font-mono font-semibold">FEED STANDBY</span>
                </div>
              )}
            </div>
            
            <div className="font-mono text-[9px] text-slate-500 mt-2 text-right">
              {trackingResult ? `MATRIX: 640x480 | DELTA: ${(1000/fps).toFixed(0)}ms` : 'MATRIX: OFFLINE'}
            </div>
          </div>

          {/* Dynamic Metrics Panel */}
          <TrackingStatus
            trackingResult={trackingResult}
            loading={modelLoading}
            cameraActive={cameraActive}
            onCalibrate={triggerCalibration}
          />
        </section>

      </main>

      {/* --- STATS ACCENTS BASE FOOTER --- */}
      <footer className="border-t border-slate-900 bg-slate-950/40 py-3 px-6 text-center text-[10px] font-mono text-slate-500/80 mt-auto select-none flex flex-col md:flex-row justify-between items-center gap-2">
        <div className="flex items-center gap-1.5">
          <CheckCircle className="w-3 h-3 text-cyan-500" />
          ON-DEVICE WASM HARDWARE ACCELERATED PIPELINE WORKING
        </div>
        <div>
          COORDINATES: SYSTEM_GRID_AUTO_AXIS
        </div>
      </footer>
    </div>
  );
}
