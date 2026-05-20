/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GazePoint {
  x: number; // Normalized -1 to 1 (screen coordinate system)
  y: number; // Normalized -1 to 1
}

export interface EyeLandmarkData {
  leftEyeCenter: { x: number; y: number; z: number };
  rightEyeCenter: { x: number; y: number; z: number };
  leftIrisCenter: { x: number; y: number; z: number };
  rightIrisCenter: { x: number; y: number; z: number };
  leftBlinkIntensity: number; // 0 to 1 (1 is closed)
  rightBlinkIntensity: number; // 0 to 1 (1 is closed)
  isTracking: boolean;
}

export interface TrackingResult {
  landmarks: { x: number; y: number; z: number }[];
  eyeData: EyeLandmarkData;
  headRotation: { pitch: number; yaw: number; roll: number };
  headTranslation: { x: number; y: number; z: number };
  fps: number;
}

export type ViewMode = 'observer' | 'parallax' | 'calibration';

export type ModelType = 'reactor' | 'city' | 'orrery';

export interface CalibrationData {
  points: { x: number; y: number; trackedX: number; trackedY: number }[];
  isCalibrated: boolean;
}
