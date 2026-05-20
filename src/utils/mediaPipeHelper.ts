/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { EyeLandmarkData, TrackingResult } from '../types';

// Left Eye Indices:
// Contour: [33 (outer), 133 (inner), 159 (upper), 145 (lower)]
const LEFT_EYE_OUTER = 33;
const LEFT_EYE_INNER = 133;
const LEFT_EYE_UPPER = 159;
const LEFT_EYE_LOWER = 145;
const LEFT_IRIS = 468;

// Right Eye Indices:
// Contour: [263 (outer), 362 (inner), 386 (upper), 374 (lower)]
const RIGHT_EYE_OUTER = 263;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_UPPER = 386;
const RIGHT_EYE_LOWER = 374;
const RIGHT_IRIS = 473;

// Other facial anchor points for rotation/translation tracking:
const NOSE_TIP = 1;
const CHIN = 152;
const FOREHEAD = 10;
const LEFT_TEMPLE = 127;
const RIGHT_TEMPLE = 356;

export async function initFaceLandmarker(): Promise<FaceLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
  );
  
  return await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU"
    },
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    runningMode: "VIDEO",
    numFaces: 1,
  });
}

/**
 * Calculates standard Eye Aspect Ratio (EAR) to determine blinking and gaze sizing.
 */
function calculateEAR(upper: any, lower: any, outer: any, inner: any): number {
  if (!upper || !lower || !outer || !inner) return 0.3;
  
  // Eyelid vertical distance
  const vertical = Math.sqrt(
    Math.pow(upper.x - lower.x, 2) +
    Math.pow(upper.y - lower.y, 2) +
    Math.pow(upper.z - lower.z, 2)
  );
  
  // Eye horizontal distance
  const horizontal = Math.sqrt(
    Math.pow(outer.x - inner.x, 2) +
    Math.pow(outer.y - inner.y, 2) +
    Math.pow(outer.z - inner.z, 2)
  );
  
  return horizontal > 0 ? vertical / horizontal : 0.0;
}

/**
 * Estimates head orientation (pitch, yaw, roll) using geometric landmarks
 */
export function estimateHeadPose(landmarks: any[]) {
  if (!landmarks || landmarks.length < 468) {
    return {
      rotation: { pitch: 0, yaw: 0, roll: 0 },
      translation: { x: 0, y: 0, z: 0 }
    };
  }

  const nose = landmarks[NOSE_TIP];
  const chin = landmarks[CHIN];
  const forehead = landmarks[FOREHEAD];
  const leftTemple = landmarks[LEFT_TEMPLE];
  const rightTemple = landmarks[RIGHT_TEMPLE];

  // Roll: Angle of the temple-to-temple vector
  const roll = Math.atan2(rightTemple.y - leftTemple.y, rightTemple.x - leftTemple.x);

  // Yaw: Horizontal offset of nose compared to center of temples
  const templeMidX = (leftTemple.x + rightTemple.x) * 0.5;
  const templesWidth = Math.abs(rightTemple.x - leftTemple.x);
  const yaw = templesWidth > 0 ? ((nose.x - templeMidX) / templesWidth) * -1.5 : 0; // scaled multiplier

  // Pitch: Vertical offset of nose compared to forehead-to-chin midline
  const foreheadChinMidY = (forehead.y + chin.y) * 0.5;
  const faceHeight = Math.abs(chin.y - forehead.y);
  const pitch = faceHeight > 0 ? ((nose.y - foreheadChinMidY) / faceHeight) * -1.5 : 0; // scaled multiplier

  // Translation: Translate normalized coordinates into approximate physical units or viewport offsets
  // z represents standard proximity (average depth component of facial points)
  // landmarks x and y range from 0 (left) to 1 (right)
  const x = (nose.x - 0.5) * -10.0; // Inverted for mirroring/look-direction matching
  const y = (0.5 - nose.y) * 10.0;
  
  // Proximity: higher temple width = closer to screen (negative scale representing closer distance)
  const distanceMetric = 0.3 / (templesWidth > 0 ? templesWidth : 0.3);
  const z = distanceMetric * 10.0; // Simulated depth

  return {
    rotation: { pitch, yaw, roll },
    translation: { x, y, z }
  };
}

/**
 * Parses landmarks to extract structured eye information
 */
export function extractEyeData(landmarks: any[]): EyeLandmarkData {
  if (!landmarks || landmarks.length < 478) {
    return {
      leftEyeCenter: { x: 0, y: 0, z: 0 },
      rightEyeCenter: { x: 0, y: 0, z: 0 },
      leftIrisCenter: { x: 0, y: 0, z: 0 },
      rightIrisCenter: { x: 0, y: 0, z: 0 },
      leftBlinkIntensity: 0,
      rightBlinkIntensity: 0,
      isTracking: false
    };
  }

  // Get eye landmarks
  const leftOuter = landmarks[LEFT_EYE_OUTER];
  const leftInner = landmarks[LEFT_EYE_INNER];
  const leftUpper = landmarks[LEFT_EYE_UPPER];
  const leftLower = landmarks[LEFT_EYE_LOWER];
  const leftIris = landmarks[LEFT_IRIS] || leftOuter;

  const rightOuter = landmarks[RIGHT_EYE_OUTER];
  const rightInner = landmarks[RIGHT_EYE_INNER];
  const rightUpper = landmarks[RIGHT_EYE_UPPER];
  const rightLower = landmarks[RIGHT_EYE_LOWER];
  const rightIris = landmarks[RIGHT_IRIS] || rightOuter;

  // Compute centers
  const leftEyeCenter = {
    x: (leftOuter.x + leftInner.x) * 0.5,
    y: (leftOuter.y + leftInner.y) * 0.5,
    z: (leftOuter.z + leftInner.z) * 0.5,
  };

  const rightEyeCenter = {
    x: (rightOuter.x + rightInner.x) * 0.5,
    y: (rightOuter.y + rightInner.y) * 0.5,
    z: (rightOuter.z + rightInner.z) * 0.5,
  };

  // Eyeball blinking intensities (standard thresholds: EAR < 0.17 is fully closed, EAR > 0.35 is wide open)
  const leftEAR = calculateEAR(leftUpper, leftLower, leftOuter, leftInner);
  const rightEAR = calculateEAR(rightUpper, rightLower, rightOuter, rightInner);

  // Map EAR bounds to blink intensity [0 = wide open, 1 = fully closed]
  // Normal ranges between 0.14 (closed) and 0.32 (open)
  const minEAR = 0.16;
  const maxEAR = 0.31;
  
  const leftBlinkIntensity = Math.max(0, Math.min(1, (maxEAR - leftEAR) / (maxEAR - minEAR)));
  const rightBlinkIntensity = Math.max(0, Math.min(1, (maxEAR - rightEAR) / (maxEAR - minEAR)));

  return {
    leftEyeCenter,
    rightEyeCenter,
    leftIrisCenter: { x: leftIris.x, y: leftIris.y, z: leftIris.z },
    rightIrisCenter: { x: rightIris.x, y: rightIris.y, z: rightIris.z },
    leftBlinkIntensity,
    rightBlinkIntensity,
    isTracking: true
  };
}
