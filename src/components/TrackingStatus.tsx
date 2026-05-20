/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Eye, ShieldAlert, CheckCircle2, RotateCw, Activity, ArrowRightLeft } from 'lucide-react';
import { TrackingResult } from '../types';

interface TrackingStatusProps {
  trackingResult: TrackingResult | null;
  loading: boolean;
  cameraActive: boolean;
  onCalibrate: () => void;
}

export default function TrackingStatus({
  trackingResult,
  loading,
  cameraActive,
  onCalibrate,
}: TrackingStatusProps) {
  
  const isTracking = trackingResult && trackingResult.landmarks.length > 0;

  // Convert roll, pitch, yaw from radians to clean degrees
  const pitchDeg = trackingResult ? Math.round(trackingResult.headRotation.pitch * (180 / Math.PI)) : 0;
  const yawDeg = trackingResult ? Math.round(trackingResult.headRotation.yaw * (180 / Math.PI)) : 0;
  const rollDeg = trackingResult ? Math.round(trackingResult.headRotation.roll * (180 / Math.PI)) : 0;

  // Eye Coordinates formatting
  const leftEye = trackingResult ? trackingResult.eyeData.leftEyeCenter : { x: 0.5, y: 0.5, z: 0 };
  const rightEye = trackingResult ? trackingResult.eyeData.rightEyeCenter : { x: 0.5, y: 0.5, z: 0 };

  const averageZ = trackingResult ? trackingResult.headTranslation.z.toFixed(1) : '0.0';

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Tracker Connection Status */}
      <div className="bg-slate-900/60 backdrop-blur-md rounded-xl p-4 border border-slate-800">
        <h3 className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5 font-bold">
          <Activity className="w-4 h-4 text-cyan-400" />
          SYSTEM METRICS & LINK STATUS
        </h3>

        <div className="flex flex-col gap-2">
          {/* Camera Status */}
          <div className="flex justify-between items-center py-1.5 border-b border-slate-800/50">
            <span className="text-xs text-slate-400">WEBCAM INTERFACE</span>
            {cameraActive ? (
              <span className="text-xs text-emerald-400 font-semibold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping"></span>
                CONNECTED
              </span>
            ) : (
              <span className="text-xs text-rose-400 font-semibold bg-rose-950/40 px-2 py-0.5 rounded border border-rose-800/30 flex items-center gap-1">
                DISCONNECTED
              </span>
            )}
          </div>

          {/* Model Status */}
          <div className="flex justify-between items-center py-1.5 border-b border-slate-800/50">
            <span className="text-xs text-slate-400">MEDIAPIPE TRACKER</span>
            {loading ? (
              <span className="text-xs text-amber-400 font-mono animate-pulse">BOOTING WEIGHTS...</span>
            ) : isTracking ? (
              <span className="text-xs text-cyan-400 font-semibold bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-800/30 flex items-center gap-1">
                ACTIVE
              </span>
            ) : (
              <span className="text-xs text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                PENDING SIGNAL
              </span>
            )}
          </div>

          {/* FPS Counter */}
          <div className="flex justify-between items-center py-1.5">
            <span className="text-xs text-slate-400">LANDMARKING RATE</span>
            <span className="text-xs font-mono font-bold text-slate-300">
              {isTracking ? `${trackingResult.fps} FPS` : '0 FPS'}
            </span>
          </div>
        </div>
      </div>

      {/* Coordinate Systems & Proximity */}
      <div className="bg-slate-900/60 backdrop-blur-md rounded-xl p-4 border border-slate-800 flex-1">
        <h3 className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-1.5 font-bold">
          <Eye className="w-4 h-4 text-cyan-400" />
          EYE COORDINATE MAPS
        </h3>

        {!isTracking ? (
          <div className="h-44 border border-dashed border-slate-800 rounded-lg flex flex-col justify-center items-center gap-2 p-4 text-center">
            <ShieldAlert className="w-8 h-8 text-slate-600 animate-pulse" />
            <span className="text-xs text-slate-500 font-medium font-sans">
              No tracking signal. Please align your face inside the webcam viewport.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Visual Blink Meters */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-[10px] font-mono text-slate-400 font-bold mb-1">LEFT BLINK EYE ASPECT</div>
                <div className="w-full bg-slate-800 h-2.5 rounded overflow-hidden relative">
                  <div
                    className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full transition-all duration-75"
                    style={{ width: `${Math.round(trackingResult.eyeData.leftBlinkIntensity * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-[10px] font-mono text-slate-500">EAR</span>
                  <span className="text-[10px] font-mono text-cyan-400 font-bold">
                    {Math.round(trackingResult.eyeData.leftBlinkIntensity * 100)}%
                  </span>
                </div>
              </div>

              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-[10px] font-mono text-slate-400 font-bold mb-1">RIGHT BLINK EYE ASPECT</div>
                <div className="w-full bg-slate-800 h-2.5 rounded overflow-hidden relative">
                  <div
                    className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full transition-all duration-75"
                    style={{ width: `${Math.round(trackingResult.eyeData.rightBlinkIntensity * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-[10px] font-mono text-slate-500">EAR</span>
                  <span className="text-[10px] font-mono text-cyan-400 font-bold">
                    {Math.round(trackingResult.eyeData.rightBlinkIntensity * 100)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Absolute Eye coordinates relative to camera viewport */}
            <div className="bg-slate-950/85 p-3 rounded-lg border border-slate-800/60">
              <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400 border-b border-slate-800/30 pb-1.5 mb-2 font-bold">
                <ArrowRightLeft className="w-3.5 h-3.5 text-indigo-400" />
                COORDINATE MATRIX (X, Y, Z)
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div>
                  <div className="text-slate-500 font-bold">LEFT EYE CENTER</div>
                  <div className="text-cyan-400 mt-0.5">X: <span className="text-slate-300">{(0.5 - leftEye.x).toFixed(3)}</span></div>
                  <div className="text-cyan-400">Y: <span className="text-slate-300">{(0.5 - leftEye.y).toFixed(3)}</span></div>
                </div>
                <div>
                  <div className="text-slate-500 font-bold">RIGHT EYE CENTER</div>
                  <div className="text-cyan-400 mt-0.5">X: <span className="text-slate-300">{(0.5 - rightEye.x).toFixed(3)}</span></div>
                  <div className="text-cyan-400">Y: <span className="text-slate-300">{(0.5 - rightEye.y).toFixed(3)}</span></div>
                </div>
              </div>
            </div>

            {/* Depth translation bar */}
            <div className="bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/40">
              <div className="flex justify-between text-[11px] font-mono text-slate-400 uppercase font-bold mb-1">
                <span>Distance from Screen Z</span>
                <span className="text-indigo-400">{averageZ} units</span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-400 h-full transition-all"
                  style={{ width: `${Math.min(100, Math.max(10, (15 - trackingResult.headTranslation.z) * 10))}%` }}
                />
              </div>
            </div>

            {/* Rotational Gauges */}
            <div className="grid grid-cols-3 gap-2 mt-1">
              <div className="bg-slate-950/30 p-2 rounded border border-slate-800/80 text-center">
                <div className="text-[9px] font-mono text-slate-500 font-bold uppercase mb-0.5">PITCH</div>
                <div className="text-xs font-mono font-bold text-slate-200">{pitchDeg}°</div>
                <div className="text-[8px] font-mono text-slate-500">LOOK UP/DOWN</div>
              </div>
              
              <div className="bg-slate-950/30 p-2 rounded border border-slate-800/80 text-center">
                <div className="text-[9px] font-mono text-slate-500 font-bold uppercase mb-0.5">YAW</div>
                <div className="text-xs font-mono font-bold text-slate-200">{yawDeg}°</div>
                <div className="text-[8px] font-mono text-slate-500">LOOK LEFT/RIGHT</div>
              </div>

              <div className="bg-slate-950/30 p-2 rounded border border-slate-800/80 text-center">
                <div className="text-[9px] font-mono text-slate-500 font-bold uppercase mb-0.5">ROLL</div>
                <div className="text-xs font-mono font-bold text-slate-200">{rollDeg}°</div>
                <div className="text-[8px] font-mono text-slate-500">HEAD TILT</div>
              </div>
            </div>

            {/* Align & Calibrate Gaze */}
            <button
              onClick={onCalibrate}
              type="button"
              id="calibrate-tracker-btn"
              className="mt-2 w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-semibold transition flex items-center justify-center gap-2 cursor-pointer shadow-lg active:scale-[0.98]"
            >
              <RotateCw className="w-3.5 h-3.5" />
              CALIBRATE TRACKING
            </button>
          </div>
        )}
      </div>

      {/* Guide/Instructions */}
      <div className="bg-slate-900/30 p-4 rounded-xl border border-slate-800/60 font-sans text-xs text-slate-400 flex flex-col gap-2 leading-relaxed">
        <h4 className="font-mono text-[10px] uppercase font-bold text-slate-300 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-500" />
          DIAGNOSTIC & SETUP DIRECTIVE
        </h4>
        <p>
          Position yourself roughly <strong className="text-slate-300">50-70 cm</strong> away from your camera in a well-lit environment.
        </p>
        <p>
          In <strong className="text-cyan-400">Parallax Mode</strong>, we treat the observer's eyes as the active 3D camera viewpoint. Slide your head side-to-side to see depth-parallax behind the columns!
        </p>
      </div>
    </div>
  );
}
