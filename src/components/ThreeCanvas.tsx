/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TrackingResult, ViewMode, ModelType } from '../types';

interface ThreeCanvasProps {
  trackingResult: TrackingResult | null;
  viewMode: ViewMode;
  showLandmarks: boolean;
  showGazeLasers: boolean;
  isBilateralSymmetric: boolean;
  selectedModel: ModelType;
}

// Landmark connectivity loops for glowing cybernetic outlines
const CONNECTIVITY_LOOPS = [
  // Face outer boundary (representative indices)
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
  // Left Eyebrow
  [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  // Right Eyebrow
  [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
  // Nose Bridge & Base
  [168, 6, 197, 195, 5, 4, 1, 19, 94, 2],
  [98, 97, 2, 326, 327],
  // Left Eye Contour
  [33, 160, 158, 133, 153, 144, 33],
  // Right Eye Contour
  [263, 387, 385, 362, 380, 373, 263],
  // Outer Mouth Loop
  [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61],
  // Inner Mouth Loop
  [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78]
];

export default function ThreeCanvas({
  trackingResult,
  viewMode,
  showLandmarks,
  showGazeLasers,
  isBilateralSymmetric,
  selectedModel
}: ThreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Keep dynamic props in refs to avoid re-triggering the main setup useEffect
  const trackingDataRef = useRef<TrackingResult | null>(null);
  trackingDataRef.current = trackingResult;

  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;

  const showLandmarksRef = useRef(showLandmarks);
  showLandmarksRef.current = showLandmarks;

  const showGazeLasersRef = useRef(showGazeLasers);
  showGazeLasersRef.current = showGazeLasers;

  const isBilateralSymmetricRef = useRef(isBilateralSymmetric);
  isBilateralSymmetricRef.current = isBilateralSymmetric;

  // Adaptive smoothing caches to prevent high-frequency noise of raw camera streams
  const smoothedHeadRef = useRef({ x: 0, y: 0, z: 12.0 });
  const smoothedGazeRef = useRef({ x: 0, y: 0 });

  // Predictive state tracking to compensate for camera/face-mesh lag
  const lastRawHeadRef = useRef({ x: 0, y: 0, z: 12.0 });
  const lastRawGazeRef = useRef({ x: 0, y: 0 });
  const headVelocityRef = useRef({ x: 0, y: 0, z: 0 });
  const gazeVelocityRef = useRef({ x: 0, y: 0 });

  // Store three.js component references
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    
    // Virtual Objects
    faceGroup: THREE.Group;
    faceParticles: THREE.Points;
    faceLines: THREE.LineSegments;
    leftEyeNode: THREE.Group;
    rightEyeNode: THREE.Group;
    leftGazeLine: THREE.Line;
    rightGazeLine: THREE.Line;
    
    // Parallax World Objects
    parallaxGroup: THREE.Group;
    screenPlane: THREE.GridHelper;
    roomGroup: THREE.Group;

    // Eyeball structures
    leftPupil: THREE.Mesh;
    rightPupil: THREE.Mesh;
    leftIrisMesh: THREE.Mesh;
    rightIrisMesh: THREE.Mesh;

    // Specular focal light and foreground layer
    focusLight: THREE.PointLight;
    foregroundDust: THREE.Points;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    // --- SCENE SETUP ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1d); // Radiant space obsidian blue
    scene.fog = new THREE.FogExp2(0x0a0f1d, 0.015);

    // --- CAMERA SETUP ---
    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 500;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 22);

    // --- RENDERER SETUP ---
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      precision: 'mediump',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height);


    // --- CONTROLS ---
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 3;
    controls.maxDistance = 60;

    // --- MOUSE TRACKING FALLBACK FOR PARALLAX MODE ---
    let mouseX = 0;
    let mouseY = 0;
    const handlePointerMove = (e: PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      // Translate to relative coordinates [-3.0, 3.0]
      mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 6.0;
      mouseY = (0.5 - (e.clientY - rect.top) / rect.height) * 6.0;
    };
    containerRef.current.addEventListener('pointermove', handlePointerMove);

    // --- LIGHTS ---
    const ambientLight = new THREE.AmbientLight(0x0d1b2a, 1.5);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x00f2fe, 2.0); // Neon cyan
    dirLight1.position.set(10, 15, 10);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xff007f, 1.5); // Neon Magenta
    dirLight2.position.set(-10, -5, -10);
    scene.add(dirLight2);

    const focusLight = new THREE.PointLight(0x00ffcc, 3.0, 30); // Bright mint
    focusLight.position.set(0, 0, 5);
    scene.add(focusLight);

    // --- HELPER GRIDS & SCREEN ALIGNED GRAPHICS ---
    const spaceGrid = new THREE.GridHelper(50, 50, 0x1f2937, 0x111827);
    spaceGrid.position.y = -10;
    scene.add(spaceGrid);
    spaceGrid.updateMatrix();
    spaceGrid.matrixAutoUpdate = false;

    const screenPlane = new THREE.GridHelper(16, 16, 0x4f46e5, 0x1e1b4b); // Floating indigo monitor boundary
    screenPlane.rotation.x = Math.PI / 2;
    screenPlane.position.set(0, 0, 0); // At coordinates z=0, representing camera mapping plane
    scene.add(screenPlane);
    screenPlane.updateMatrix();
    screenPlane.matrixAutoUpdate = false;

    // --- VIRTUAL CYBERNETIC FACE GROUP ---
    const faceGroup = new THREE.Group();
    scene.add(faceGroup);

    // 1. Create Landmark Particle Cloud
    const particleCount = 478;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const baseColor = new THREE.Color(0x00ffcc);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;

      colors[i * 3] = baseColor.r;
      colors[i * 3 + 1] = baseColor.g;
      colors[i * 3 + 2] = baseColor.b;
    }

    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pointsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const pointsMaterial = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    const faceParticles = new THREE.Points(pointsGeometry, pointsMaterial);
    faceGroup.add(faceParticles);

    // 2. Create Cyber Connecting Lines
    const lineIndices: number[] = [];
    CONNECTIVITY_LOOPS.forEach((loop) => {
      for (let i = 0; i < loop.length - 1; i++) {
        lineIndices.push(loop[i], loop[i + 1]);
      }
    });

    const linesGeometry = new THREE.BufferGeometry();
    linesGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
    linesGeometry.setIndex(lineIndices);

    const linesMaterial = new THREE.LineBasicMaterial({
      color: 0x00f2fe, // Cyan wireframe
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      linewidth: 1, // Note: WebGL standard restricts fat lines, so 1 is safest
    });
    const faceLines = new THREE.LineSegments(linesGeometry, linesMaterial);
    faceGroup.add(faceLines);

    // 3. Eyeballs & Pupils (Dual detailed eyeball groups)
    // Left eye eyeball group
    const leftEyeNode = new THREE.Group();
    // Right eye eyeball group
    const rightEyeNode = new THREE.Group();

    // Sclera (White eye background)
    const eyeScleraGeo = new THREE.SphereGeometry(0.35, 32, 16);
    const eyeScleraMat = new THREE.MeshPhongMaterial({
      color: 0xf8fafc,
      shininess: 120,
      emissive: 0x1e293b,
    });

    // Iris (Cyan ring)
    const irisGeo = new THREE.SphereGeometry(0.355, 32, 16, 0, Math.PI * 2, 0, Math.PI / 4);
    const irisMat = new THREE.MeshPhongMaterial({
      color: 0x00d2ff,
      shininess: 150,
      emissive: 0x001144,
    });
    
    // Pupil (Black hole center)
    const pupilGeo = new THREE.SphereGeometry(0.358, 32, 16, 0, Math.PI * 2, 0, Math.PI / 7);
    const pupilMat = new THREE.MeshBasicMaterial({
      color: 0x050505,
    });

    // Build left eye assembly
    const leftSclera = new THREE.Mesh(eyeScleraGeo, eyeScleraMat);
    const leftIrisMesh = new THREE.Mesh(irisGeo, irisMat);
    const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
    leftIrisMesh.rotation.x = Math.PI / 2; // Rotate forward
    leftPupil.rotation.x = Math.PI / 2;
    leftEyeNode.add(leftSclera, leftIrisMesh, leftPupil);

    // Build right eye assembly
    const rightSclera = new THREE.Mesh(eyeScleraGeo, eyeScleraMat);
    const rightIrisMesh = new THREE.Mesh(irisGeo, irisMat);
    const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
    rightIrisMesh.rotation.x = Math.PI / 2;
    rightPupil.rotation.x = Math.PI / 2;
    rightEyeNode.add(rightSclera, rightIrisMesh, rightPupil);

    faceGroup.add(leftEyeNode);
    faceGroup.add(rightEyeNode);

    // 4. Laser Gaze Beams (Lasers extending forward out of pupils)
    const laserMat = new THREE.LineBasicMaterial({
      color: 0xff0055, // Laser Pink-Red
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });

    const laserPointsLeft = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 15)];
    const laserGeoLeft = new THREE.BufferGeometry().setFromPoints(laserPointsLeft);
    const leftGazeLine = new THREE.Line(laserGeoLeft, laserMat);

    const laserPointsRight = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 15)];
    const laserGeoRight = new THREE.BufferGeometry().setFromPoints(laserPointsRight);
    const rightGazeLine = new THREE.Line(laserGeoRight, laserMat);

    leftEyeNode.add(leftGazeLine);
    rightEyeNode.add(rightGazeLine);

    // --- PARALLAX ACTIVE PERSPECTIVE ENVIRONMENT ---
    // A 3D layered room visible in "parallax" perspective view modes
    const parallaxGroup = new THREE.Group();
    scene.add(parallaxGroup);

    const roomGroup = new THREE.Group();
    parallaxGroup.add(roomGroup);

    // Far wall panel with neon grid wireframe
    const wallGeo = new THREE.BoxGeometry(16, 16, 1);
    const wallMat = new THREE.MeshPhongMaterial({
      color: 0x090d16,
      emissive: 0x05051a,
      wireframe: true
    });
    const farWall = new THREE.Mesh(wallGeo, wallMat);
    farWall.position.set(0, 0, -8);
    roomGroup.add(farWall);
    farWall.updateMatrix();
    farWall.matrixAutoUpdate = false;

    // Supportive depth columns in the background to anchor depth parallax
    const columnGeo = new THREE.BoxGeometry(0.15, 12, 0.15);
    const columnMat = new THREE.MeshBasicMaterial({ color: 0x1e1b4b, transparent: true, opacity: 0.3 });
    for (let c = -4; c <= 4; c += 2) {
      if (c === 0) continue;
      const colL = new THREE.Mesh(columnGeo, columnMat);
      colL.position.set(c * 1.8, 0, -6);
      roomGroup.add(colL);
      colL.updateMatrix();
      colL.matrixAutoUpdate = false;
    }

    // Virtual sky grid / ceiling (creates extreme vertical perspective anchoring when looking up from a lower perspective)
    const ceilingGrid = new THREE.GridHelper(16, 16, 0xff0055, 0x1e1b4b); // Cyber Magenta
    ceilingGrid.position.set(0, 6, 0);
    roomGroup.add(ceilingGrid);
    ceilingGrid.updateMatrix();
    ceilingGrid.matrixAutoUpdate = false;

    // Floor neon circuit mesh for look-down anchoring
    const floorGrid = new THREE.GridHelper(16, 16, 0x00f2fe, 0x1e1b4b); // Glowing Cyan
    floorGrid.position.set(0, -5, 0);
    roomGroup.add(floorGrid);
    floorGrid.updateMatrix();
    floorGrid.matrixAutoUpdate = false;

    // --- MODEL 1: GYROSCOPIC FUSION REACTOR ---
    const reactorGroup = new THREE.Group();
    roomGroup.add(reactorGroup);

    // Golden Outer Gimbal Ring
    const torusGeo1 = new THREE.TorusGeometry(2.8, 0.08, 16, 100);
    const torusMat1 = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // Warm Gold
      metalness: 0.9,
      roughness: 0.1,
    });
    const r1 = new THREE.Mesh(torusGeo1, torusMat1);
    reactorGroup.add(r1);

    // Cyan Middle Gimbal Ring
    const torusGeo2 = new THREE.TorusGeometry(2.0, 0.06, 16, 100);
    const torusMat2 = new THREE.MeshStandardMaterial({
      color: 0x06b6d4, // Neon Cyan
      metalness: 0.9,
      roughness: 0.1,
    });
    const r2 = new THREE.Mesh(torusGeo2, torusMat2);
    r2.rotation.y = Math.PI / 4;
    reactorGroup.add(r2);

    // Magenta Inner Gimbal Ring
    const torusGeo3 = new THREE.TorusGeometry(1.3, 0.04, 16, 100);
    const torusMat3 = new THREE.MeshStandardMaterial({
      color: 0xec4899, // Cyber Pink
      metalness: 0.8,
      roughness: 0.15,
    });
    const r3 = new THREE.Mesh(torusGeo3, torusMat3);
    r3.rotation.x = Math.PI / 4;
    reactorGroup.add(r3);

    // Central Sphere Core (Fusion Plasma Core)
    const plasmaGeo = new THREE.SphereGeometry(0.6, 32, 24);
    const plasmaMat = new THREE.MeshPhongMaterial({
      color: 0x00ffcc, // Toxic Mint Spark
      emissive: 0x003344,
      shininess: 120,
    });
    const plasmaCore = new THREE.Mesh(plasmaGeo, plasmaMat);
    reactorGroup.add(plasmaCore);

    // Ambient floating fusion spark points
    const sparksGeo = new THREE.BufferGeometry();
    const sparksCount = 120;
    const sparksPositions = new Float32Array(sparksCount * 3);
    for (let s = 0; s < sparksCount; s++) {
      const radius = 0.7 + Math.random() * 2.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      sparksPositions[s * 3] = radius * Math.sin(phi) * Math.cos(theta);
      sparksPositions[s * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      sparksPositions[s * 3 + 2] = radius * Math.cos(phi);
    }
    sparksGeo.setAttribute('position', new THREE.BufferAttribute(sparksPositions, 3));
    const sparksMat = new THREE.PointsMaterial({
      color: 0x00ffcc,
      size: 0.08,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });
    const sparksPoints = new THREE.Points(sparksGeo, sparksMat);
    reactorGroup.add(sparksPoints);

    // Top and bottom reactor magnetic focal funnels (adds spectacular vertical looking angles!)
    const coneMat = new THREE.MeshStandardMaterial({
      color: 0x1e1b4b,
      metalness: 0.9,
      roughness: 0.2,
      wireframe: true
    });
    
    // Top collector
    const topCapGeo = new THREE.ConeGeometry(0.8, 0.4, 16, 2, true);
    const topCap = new THREE.Mesh(topCapGeo, coneMat);
    topCap.position.set(0, 3.2, 0);
    topCap.rotation.x = Math.PI; // point down
    reactorGroup.add(topCap);
    topCap.updateMatrix();
    topCap.matrixAutoUpdate = false;

    // Bottom collector
    const bottomCap = new THREE.Mesh(topCapGeo, coneMat);
    bottomCap.position.set(0, -3.2, 0); // point up
    reactorGroup.add(bottomCap);
    bottomCap.updateMatrix();
    bottomCap.matrixAutoUpdate = false;

    // Magnetic containment fields (rings hovering near caps)
    const ringGeo = new THREE.RingGeometry(0.9, 1.1, 32);
    const ringMatCyan = new THREE.MeshBasicMaterial({ color: 0x06b6d4, side: THREE.DoubleSide, transparent: true, opacity: 0.75 });
    const ringMatPink = new THREE.MeshBasicMaterial({ color: 0xec4899, side: THREE.DoubleSide, transparent: true, opacity: 0.75 });
    
    const topRing = new THREE.Mesh(ringGeo, ringMatCyan);
    topRing.rotation.x = Math.PI / 2;
    topRing.position.set(0, 2.9, 0);
    reactorGroup.add(topRing);
    topRing.updateMatrix();
    topRing.matrixAutoUpdate = false;

    const bottomRing = new THREE.Mesh(ringGeo, ringMatPink);
    bottomRing.rotation.x = Math.PI / 2;
    bottomRing.position.set(0, -2.9, 0);
    reactorGroup.add(bottomRing);
    bottomRing.updateMatrix();
    bottomRing.matrixAutoUpdate = false;


    // --- MODEL 2: NEO-TOKYO CYBER CITY ---
    const cityGroup = new THREE.Group();
    roomGroup.add(cityGroup);

    // Cyber street lanes (Base reference floor grid that makes parallax movement highly visible)
    // Cyber street lanes (Base reference floor grid that makes parallax movement highly visible)
    const cityFloorGrid = new THREE.GridHelper(5, 10, 0xec4899, 0x06b6d4); // Magenta & Cyan intersections
    cityFloorGrid.position.set(0, -2.001, 0);
    cityGroup.add(cityFloorGrid);
    cityFloorGrid.updateMatrix();
    cityFloorGrid.matrixAutoUpdate = false;

    const towers: THREE.Mesh[] = [];
    const towerMaterial = new THREE.MeshStandardMaterial({
      color: 0x0b0f1d,
      roughness: 0.15,
      metalness: 0.85,
      transparent: true,
      opacity: 0.88,
    });

    const towerBorderMat = new THREE.LineBasicMaterial({
      color: 0x4f46e5, // Futuristic Indigo outline
      transparent: true,
      opacity: 0.7,
    });

    // Spawn buildings grid (varying architectural towers)
    for (let xCoord = -2.2; xCoord <= 2.2; xCoord += 1.1) {
      for (let zCoord = -2.2; zCoord <= 2.2; zCoord += 1.1) {
        if (Math.abs(xCoord) < 0.2 && Math.abs(zCoord) < 0.2) continue; // Leave center space for cyber monument

        const h = 1.0 + Math.random() * 2.8;
        const w = 0.45 + Math.random() * 0.25;
        const geo = new THREE.BoxGeometry(w, h, w);
        const tMesh = new THREE.Mesh(geo, towerMaterial);
        
        tMesh.position.set(xCoord, h / 2 - 2.0, zCoord); // Elevate relative to bottom plane y=-2
        cityGroup.add(tMesh);

        // Glowing horizontal banding (floors window lights to exaggerate vertical depth shift)
        const stripeCount = Math.floor(h / 0.6) + 1;
        const stripeColor = Math.random() > 0.5 ? 0x00f2fe : 0xff0055; // cyber cyan or neon magenta
        const stripeMat = new THREE.MeshBasicMaterial({
          color: stripeColor,
          transparent: true,
          opacity: 0.85,
        });
        
        for (let sIdx = 1; sIdx < stripeCount; sIdx++) {
          const sHeight = 0.038;
          const sGeo = new THREE.BoxGeometry(w * 1.025, sHeight, w * 1.025);
          const sMesh = new THREE.Mesh(sGeo, stripeMat);
          const sY = -h / 2 + (sIdx * (h / stripeCount));
          sMesh.position.set(0, sY, 0);
          tMesh.add(sMesh);
          
          sMesh.updateMatrix();
          sMesh.matrixAutoUpdate = false;
        }

        // Glowing Roof Cap (Becomes exceptionally visible and radiant when viewing from a high perspective/looking down!)
        const roofColor = Math.random() > 0.5 ? 0x06b6d4 : 0xec4899; // Cyan or Magenta
        const roofSize = w * 0.95;
        const roofGeo = new THREE.PlaneGeometry(roofSize, roofSize);
        const roofMat = new THREE.MeshBasicMaterial({
          color: roofColor,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.95,
        });
        const roofMesh = new THREE.Mesh(roofGeo, roofMat);
        roofMesh.rotation.x = Math.PI / 2; // Flat horizontal cap
        roofMesh.position.set(0, h / 2 + 0.005, 0); // Directly on top
        tMesh.add(roofMesh);
        
        roofMesh.updateMatrix();
        roofMesh.matrixAutoUpdate = false;

        // Helipad circle or design details on top of the roof cap for extra craftsmanship
        const capRingGeo = new THREE.RingGeometry(roofSize * 0.22, roofSize * 0.32, 16);
        const capRingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
        const capRing = new THREE.Mesh(capRingGeo, capRingMat);
        capRing.rotation.x = Math.PI / 2;
        capRing.position.set(0, h / 2 + 0.01, 0);
        tMesh.add(capRing);
        
        capRing.updateMatrix();
        capRing.matrixAutoUpdate = false;

        // Some towers shoot vertical neon searchlight beams into the cyber sky (highly interactive as you look up/down!)
        if (Math.random() > 0.6) {
          const beamGeo = new THREE.CylinderGeometry(0.015, 0.1, 4.0, 8, 1, true);
          const beamMat = new THREE.MeshBasicMaterial({
            color: roofColor,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
          });
          const beam = new THREE.Mesh(beamGeo, beamMat);
          beam.position.set(0, h / 2 + 2.0, 0); // Just above roof
          tMesh.add(beam);
          
          beam.updateMatrix();
          beam.matrixAutoUpdate = false;
        }

        // Cyber metallic borders
        const helperGeom = new THREE.EdgesGeometry(geo);
        const edgesLines = new THREE.LineSegments(helperGeom, towerBorderMat);
        tMesh.add(edgesLines);
        
        edgesLines.updateMatrix();
        edgesLines.matrixAutoUpdate = false;

        tMesh.updateMatrix();
        tMesh.matrixAutoUpdate = false;
        towers.push(tMesh);
      }
    }

    // Central Monument (Floating Icosahedron sculpture representing quantum computing node)
    const monumentGeo = new THREE.IcosahedronGeometry(0.55, 1);
    const monumentMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e, // Intense Rose Pink
      metalness: 0.95,
      roughness: 0.1,
    });
    const monument = new THREE.Mesh(monumentGeo, monumentMat);
    monument.position.set(0, 1.2, 0);
    cityGroup.add(monument);

    // Glowing coordinate rings enclosing the monument
    const auraGeo = new THREE.TorusGeometry(0.8, 0.025, 8, 48);
    const auraMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.65 });
    const auraRing = new THREE.Mesh(auraGeo, auraMat);
    auraRing.rotation.x = Math.PI / 2;
    monument.add(auraRing);

    // Dynamic Gaze Target Reticle (Directly visualizes Estimated Eye View Point in 3D City space!)
    const reticleGeo = new THREE.RingGeometry(0.12, 0.16, 32);
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe, // Glowing cyan crosshair
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const cityGazeReticle = new THREE.Mesh(reticleGeo, reticleMat);
    cityGazeReticle.position.set(0, 0, 1.0);
    cityGroup.add(cityGazeReticle);

    // Fleet of miniature neon sky transports (Hover cars flying between towers)
    const hoverCars: THREE.Mesh[] = [];
    const carGeo = new THREE.ConeGeometry(0.05, 0.15, 4);
    carGeo.rotateX(Math.PI / 2);
    const carMat = new THREE.MeshBasicMaterial({ color: 0x10b981 }); // Glowing emerald hover cars
    for (let cIdx = 0; cIdx < 5; cIdx++) {
      const car = new THREE.Mesh(carGeo, carMat);
      // Give initial random distribution
      car.position.set(
        (Math.random() - 0.5) * 3,
        Math.random() * 1.5 - 0.4,
        (Math.random() - 0.5) * 3
      );
      cityGroup.add(car);
      hoverCars.push(car);
    }


    // --- MODEL 3: QUANTUM CELESTIAL ORRERY ---
    const orreryGroup = new THREE.Group();
    roomGroup.add(orreryGroup);

    // Glowing Central Sun Star
    const sunGeom = new THREE.SphereGeometry(0.7, 32, 24);
    const sunMaterial = new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // Solar gold
      emissive: 0x7c2d12,
      roughness: 0.05,
      metalness: 0.9,
    });
    const sunOrb = new THREE.Mesh(sunGeom, sunMaterial);
    orreryGroup.add(sunOrb);

    // Polar coordinate axes/grid poles for Orrery (adds incredible structural lines when viewed from top/bottom!)
    const poleGeo = new THREE.CylinderGeometry(0.015, 0.015, 4.0, 8);
    const poleMat = new THREE.MeshBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.5 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    orreryGroup.add(pole);
    pole.updateMatrix();
    pole.matrixAutoUpdate = false;

    // Subtle coordinate lattice sphere enclosure
    const sphereWireGeo = new THREE.SphereGeometry(3.6, 12, 12);
    const sphereWireMat = new THREE.MeshBasicMaterial({
      color: 0x334155,
      wireframe: true,
      transparent: true,
      opacity: 0.15
    });
    const latticeGlobe = new THREE.Mesh(sphereWireGeo, sphereWireMat);
    orreryGroup.add(latticeGlobe);
    latticeGlobe.updateMatrix();
    latticeGlobe.matrixAutoUpdate = false;

    // Concentric Orbit Lines helper
    const makeOrbit = (radius: number) => {
      const ringLineGeo = new THREE.RingGeometry(radius - 0.015, radius + 0.015, 64);
      const ringLineMat = new THREE.MeshBasicMaterial({
        color: 0x334155,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.4,
      });
      const orbitRing = new THREE.Mesh(ringLineGeo, ringLineMat);
      orbitRing.rotation.x = Math.PI / 2;
      orreryGroup.add(orbitRing);
      orbitRing.updateMatrix();
      orbitRing.matrixAutoUpdate = false;
    };
    makeOrbit(1.5);
    makeOrbit(2.4);
    makeOrbit(3.5);

    // Set of concentric spinning planet bodies
    const p1 = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 16), new THREE.MeshStandardMaterial({ color: 0x06b6d4, metalness: 0.8 }));
    orreryGroup.add(p1);

    const p2 = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.8 }));
    orreryGroup.add(p2);

    const p3 = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), new THREE.MeshStandardMaterial({ color: 0xd946ef, metalness: 0.8 }));
    orreryGroup.add(p3);

    // Sub-satellite rings with particle trails
    const planet3RingGeo = new THREE.RingGeometry(0.55, 0.75, 32);
    const p3Ring = new THREE.Mesh(planet3RingGeo, new THREE.MeshBasicMaterial({ color: 0xd946ef, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
    p3Ring.rotation.x = Math.PI / 2;
    p3.add(p3Ring);


    // Screen-aligned coordinates label plane
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256;
    labelCanvas.height = 128;
    const ctx = labelCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 256, 128);
      ctx.strokeStyle = '#00f2fe';
      ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, 248, 120);
      ctx.fillStyle = '#00ffcc';
      ctx.font = 'bold 24px monospace';
      ctx.fillText('3D MUSEUM', 40, 50);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('PERSPECTIVE', 40, 90);
    }
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true });
    const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), labelMat);
    labelMesh.position.set(-4, -1, -2);
    roomGroup.add(labelMesh);
    labelMesh.updateMatrix();
    labelMesh.matrixAutoUpdate = false;

    // --- FOREGROUND FLOATING CYBER DUST LAYER ---
    // Creates an incredible, immediate stereoscopic depth contrast as they move across active models
    const fgPointsCount = 50;
    const fgPositions = new Float32Array(fgPointsCount * 3);
    const fgColors = new Float32Array(fgPointsCount * 3);
    const colorOpts = [new THREE.Color(0x00f2fe), new THREE.Color(0xec4899), new THREE.Color(0xf59e0b)];
    
    for (let i = 0; i < fgPointsCount; i++) {
      fgPositions[i * 3] = (Math.random() - 0.5) * 12; // X range
      fgPositions[i * 3 + 1] = (Math.random() - 0.5) * 8;  // Y range
      fgPositions[i * 3 + 2] = 2.0 + Math.random() * 5.0;  // Z range (Crucial: FOREGROUND!)
      
      const colRand = colorOpts[Math.floor(Math.random() * colorOpts.length)];
      fgColors[i * 3] = colRand.r;
      fgColors[i * 3 + 1] = colRand.g;
      fgColors[i * 3 + 2] = colRand.b;
    }
    
    const fgGeometry = new THREE.BufferGeometry();
    fgGeometry.setAttribute('position', new THREE.BufferAttribute(fgPositions, 3));
    fgGeometry.setAttribute('color', new THREE.BufferAttribute(fgColors, 3));
    
    const fgMaterial = new THREE.PointsMaterial({
      size: 0.18,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });
    
    const foregroundDust = new THREE.Points(fgGeometry, fgMaterial);
    parallaxGroup.add(foregroundDust);

    // Save core instances to ref
    threeRef.current = {
      scene,
      camera,
      renderer,
      controls,
      faceGroup,
      faceParticles,
      faceLines,
      leftEyeNode,
      rightEyeNode,
      leftGazeLine,
      rightGazeLine,
      parallaxGroup,
      screenPlane,
      roomGroup,
      leftPupil,
      rightPupil,
      leftIrisMesh,
      rightIrisMesh,
      focusLight,
      foregroundDust,
    };

    // --- ANIMATION LOOP ---
    let frameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      frameId = requestAnimationFrame(animate);

      const delta = clock.getDelta();
      const time = clock.getElapsedTime();

      const tracking = trackingDataRef.current;
      const data = threeRef.current;

      if (!data) return;

      const currentModel = selectedModelRef.current;
      const currentViewMode = viewModeRef.current;
      const currentShowLandmarks = showLandmarksRef.current;
      const currentShowGazeLasers = showGazeLasersRef.current;

      // Toggle active model visibilities (dynamic switching)
      reactorGroup.visible = currentModel === 'reactor';
      cityGroup.visible = currentModel === 'city';
      orreryGroup.visible = currentModel === 'orrery';

      // --- 1. MODEL ANIMATIONS ---
      
      // REACTOR: spin central components
      if (currentModel === 'reactor') {
        r1.rotation.y = time * 0.45;
        r1.rotation.x = time * 0.2;
        r2.rotation.y = -time * 0.75;
        r2.rotation.z = time * 0.35;
        r3.rotation.z = -time * 1.1;
        r3.rotation.x = time * 0.55;
        
        // Pulse plasma size
        const pScale = 1.0 + Math.sin(time * 4) * 0.12;
        plasmaCore.scale.set(pScale, pScale, pScale);
        
        // Slowly rotate sparks point clouds
        sparksPoints.rotation.y = -time * 0.15;
        
        // Gaze/Eye blink interactive reactivity: If blinking, make plasma orange!
        if (tracking && (tracking.eyeData.leftBlinkIntensity > 0.4 || tracking.eyeData.rightBlinkIntensity > 0.4)) {
          plasmaCore.material.color.setHex(0xff3300); // Solar red-orange
          sparksMat.color.setHex(0xff3300);
        } else {
          plasmaCore.material.color.setHex(0x00ffcc); // Back to cyan-mint
          sparksMat.color.setHex(0x00ffcc);
        }
      }

      // CITY: spin monument & hover cars
      if (currentModel === 'city') {
        monument.rotation.y = time * 0.6;
        monument.rotation.z = Math.sin(time) * 0.25;
        auraRing.rotation.z = time * 1.5;
        
        // Update Gaze Reticle based on current physical eye-gaze estimation
        if (tracking && tracking.eyeData && tracking.eyeData.isTracking) {
          const leftE = tracking.eyeData.leftEyeCenter;
          const rightE = tracking.eyeData.rightEyeCenter;
          const leftIris = tracking.eyeData.leftIrisCenter;
          const rightIris = tracking.eyeData.rightIrisCenter;

          const avgDefX = ((leftIris.x - leftE.x) + (rightIris.x - rightE.x)) * 0.5;
          const avgDefY = ((leftIris.y - leftE.y) + (rightIris.y - rightE.y)) * 0.5;

          // Convert into city responsive coordinates
          const rx = -avgDefX * 18.0;
          const ry = avgDefY * 18.0 + 0.5; // Offset slightly for ergonomic viewing

          cityGazeReticle.position.x += (rx - cityGazeReticle.position.x) * 0.15;
          cityGazeReticle.position.y += (ry - cityGazeReticle.position.y) * 0.15;
          cityGazeReticle.visible = true;
          cityGazeReticle.scale.setScalar(1.0 + Math.sin(time * 6.0) * 0.12);
        } else {
          // Cursor hover perspective fallback simulator coordinates
          const rx = mouseX * 2.5;
          const ry = mouseY * 2.5 + 0.5;
          cityGazeReticle.position.x += (rx - cityGazeReticle.position.x) * 0.12;
          cityGazeReticle.position.y += (ry - cityGazeReticle.position.y) * 0.12;
          cityGazeReticle.visible = true;
          cityGazeReticle.scale.setScalar(1.0 + Math.sin(time * 4.0) * 0.08);
        }

        // Animate transport vehicle linear coordinates
        hoverCars.forEach((car, idx) => {
          const speed = 0.5 + idx * 0.15;
          const thetaRange = time * speed + idx;
          const orbitRad = 1.2 + idx * 0.3;
          car.position.x = Math.sin(thetaRange) * orbitRad;
          car.position.z = Math.cos(thetaRange) * orbitRad;
          car.position.y = Math.sin(thetaRange * 2) * 0.4 + 0.3;
          
          // Align car orientation looking in its movement trajectory
          car.rotation.y = thetaRange + Math.PI / 2;
        });

        // blink reactivity: if blinking, neon outlines glow intensely
        if (tracking && (tracking.eyeData.leftBlinkIntensity > 0.45 || tracking.eyeData.rightBlinkIntensity > 0.45)) {
          towerBorderMat.color.setHex(0x38bdf8); // Sky blue flash
          monumentMat.color.setHex(0x00ffcc);
        } else {
          towerBorderMat.color.setHex(0x4f46e5); // Reset
          monumentMat.color.setHex(0xf43f5e);
        }
      }

      // ORRERY: orbit planets along concentric paths
      if (currentModel === 'orrery') {
        // Orbit speed steps
        const orbit1 = time * 1.35;
        p1.position.set(Math.sin(orbit1) * 1.5, 0, Math.cos(orbit1) * 1.5);
        p1.rotation.y += 0.02;

        const orbit2 = -time * 0.8;
        p2.position.set(Math.sin(orbit2) * 2.4, 0, Math.cos(orbit2) * 2.4);
        p2.rotation.y += 0.015;

        const orbit3 = time * 0.4;
        p3.position.set(Math.sin(orbit3) * 3.5, 0, Math.cos(orbit3) * 3.5);
        p3.rotation.y += 0.01;

        // Pulse core sun
        const sSize = 1.0 + Math.sin(time * 2) * 0.06;
        sunOrb.scale.set(sSize, sSize, sSize);

        // blink reactivity
        if (tracking && (tracking.eyeData.leftBlinkIntensity > 0.4 || tracking.eyeData.rightBlinkIntensity > 0.4)) {
          sunMaterial.color.setHex(0xd946ef); // Magenta flash
        } else {
          sunMaterial.color.setHex(0xf59e0b); // Reset solar gold
        }
      }

      // Pulse diagnostic light
      focusLight.intensity = Math.sin(time * 3) * 0.5 + 2.5;

      // Realtime frame update of tracking landmarks (ONLY update individual 3D vertices/eyeballs if they are visible in observer/default mode)
      if (tracking && tracking.landmarks && tracking.landmarks.length > 0) {
        const landmarksVisible = currentShowLandmarks && currentViewMode !== 'parallax';

        // Apply visibility overrides
        data.faceParticles.visible = landmarksVisible;
        data.faceLines.visible = landmarksVisible;
        data.leftGazeLine.visible = currentShowGazeLasers && landmarksVisible;
        data.rightGazeLine.visible = currentShowGazeLasers && landmarksVisible;
        data.leftEyeNode.visible = landmarksVisible;
        data.rightEyeNode.visible = landmarksVisible;

        if (landmarksVisible) {
          const positionsAttr = data.faceParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
          const linePosAttr = data.faceLines.geometry.getAttribute('position') as THREE.BufferAttribute;
          
          // Update 3D landmark points
          tracking.landmarks.forEach((landmark, i) => {
            if (i < 478) {
              // Transform MediaPipe normalized coordinates (0 to 1) into centered Three.js coordinates
              // Left/right invert gives perfect natural face mirror representation
              const transformX = (0.5 - landmark.x) * 11.0;
              const transformY = (0.5 - landmark.y) * 11.0;
              const transformZ = -landmark.z * 11.0; // MediaPipe Z is raw depth

              positionsAttr.setXYZ(i, transformX, transformY, transformZ);
              if (linePosAttr) {
                linePosAttr.setXYZ(i, transformX, transformY, transformZ);
              }
            }
          });

          positionsAttr.needsUpdate = true;
          if (linePosAttr) {
            linePosAttr.needsUpdate = true;
          }

          // Position 3D eyeballs exactly at left & right eye centers in 3D
          const leftE = tracking.eyeData.leftEyeCenter;
          const rightE = tracking.eyeData.rightEyeCenter;

          const leftX = (0.5 - leftE.x) * 11.0;
          const leftY = (0.5 - leftE.y) * 11.0;
          const leftZ = -leftE.z * 11.0;

          const rightX = (0.5 - rightE.x) * 11.0;
          const rightY = (0.5 - rightE.y) * 11.0;
          const rightZ = -rightE.z * 11.0;

          data.leftEyeNode.position.set(leftX, leftY, leftZ);
          data.rightEyeNode.position.set(rightX, rightY, rightZ);

          // Adjust Eyeballs for blink intensities (vertically scale down to simulate dropping eyelids / squeezing)
          const leftBlink = tracking.eyeData.leftBlinkIntensity;
          const rightBlink = tracking.eyeData.rightBlinkIntensity;

          // Blinking shrinks the eyeball structure vertically for dynamic response
          data.leftEyeNode.scale.set(1.0, Math.max(0.08, 1.0 - leftBlink * 0.95), 1.0);
          data.rightEyeNode.scale.set(1.0, Math.max(0.08, 1.0 - rightBlink * 0.95), 1.0);

          // Calculate dynamic gaze rotation based on Iris center deflection relative to eye center
          // This gives extremely real pupils that wander matching the user's focus!
          const leftIris = tracking.eyeData.leftIrisCenter;
          const rightIris = tracking.eyeData.rightIrisCenter;

          // Horizontal pupil deflection (look left/right)
          const leftDefX = (leftIris.x - leftE.x) * 20.0;
          const rightDefX = (rightIris.x - rightE.x) * 20.0;

          // Vertical pupil deflection (look up/down)
          const leftDefY = (leftIris.y - leftE.y) * -20.0;
          const rightDefY = (rightIris.y - rightE.y) * -20.0;

          // Smooth pupil limits (prevent gaze rotating outside eye physical borders)
          const maxDef = 0.5;
          const leftRotY = Math.max(-maxDef, Math.min(maxDef, leftDefX));
          const leftRotX = Math.max(-maxDef, Math.min(maxDef, leftDefY));

          const rightRotY = Math.max(-maxDef, Math.min(maxDef, rightDefX));
          const rightRotX = Math.max(-maxDef, Math.min(maxDef, rightDefY));

          // Rotate eyeballs assemblies
          data.leftEyeNode.rotation.set(leftRotX, leftRotY, 0);
          data.rightEyeNode.rotation.set(rightRotX, rightRotY, 0);

          // Laser vector targets - they project out in direction eyeball is pointing
          if (showGazeLasers) {
            const depthTargetZ = 12.0;
            const leftLaserPos = data.leftGazeLine.geometry.getAttribute('position') as THREE.BufferAttribute;
            const rightLaserPos = data.rightGazeLine.geometry.getAttribute('position') as THREE.BufferAttribute;
            
            if (leftLaserPos && rightLaserPos) {
              const outX_L = Math.sin(leftRotY) * depthTargetZ;
              const outY_L = Math.cos(leftRotY) * Math.sin(leftRotX) * depthTargetZ;
              const outZ_L = Math.cos(leftRotY) * Math.cos(leftRotX) * depthTargetZ;
              
              const outX_R = Math.sin(rightRotY) * depthTargetZ;
              const outY_R = Math.cos(rightRotY) * Math.sin(rightRotX) * depthTargetZ;
              const outZ_R = Math.cos(rightRotY) * Math.cos(rightRotX) * depthTargetZ;

              leftLaserPos.setXYZ(1, outX_L, outY_L, outZ_L);
              rightLaserPos.setXYZ(1, outX_R, outY_R, outZ_R);
              leftLaserPos.needsUpdate = true;
              rightLaserPos.needsUpdate = true;
            }
          }
        }
      }

      // --- VIEW MODES LAYOUT & PERSPECTIVE SELECTION ---
      // Slowly float and wrap foreground dust
      if (data.foregroundDust) {
        const fgPositionsAttr = data.foregroundDust.geometry.getAttribute('position') as THREE.BufferAttribute;
        if (fgPositionsAttr) {
          const pointsCount = fgPositionsAttr.count;
          for (let i = 0; i < pointsCount; i++) {
            let y = fgPositionsAttr.getY(i);
            y -= delta * 0.55; // ambient drifting downward
            if (y < -5.5) {
              y = 5.5; // wrap around to top
            }
            fgPositionsAttr.setY(i, y);
          }
          fgPositionsAttr.needsUpdate = true;
        }
      }

      if (currentViewMode === 'parallax') {
        // Active Holographic Parallax Perspective Mode!
        // Camera position is mapped DIRECTLY from the physical eye/head coordinates
        data.screenPlane.visible = true; // Show screen monitor plane to reference eye parallax
        data.faceGroup.visible = false; // Hide 3D head so we look THROUGH "screen glass" at virtual world behind it
        data.roomGroup.visible = true;
        data.controls.enabled = false; // Disable orbit dragging to keep calibration perspective clean

        if (tracking && tracking.landmarks && tracking.landmarks.length > 0) {
          // --- EYE PERSPECTIVE & GAZE ESTIMATION ---
          const rawHeadX = tracking.headTranslation.x;
          const rawHeadY = tracking.headTranslation.y;
          const rawHeadZ = tracking.headTranslation.z;

          let rawGazeX = 0;
          let rawGazeY = 0;
          if (tracking.eyeData && tracking.eyeData.isTracking) {
            const leftE = tracking.eyeData.leftEyeCenter;
            const rightE = tracking.eyeData.rightEyeCenter;
            const leftIris = tracking.eyeData.leftIrisCenter;
            const rightIris = tracking.eyeData.rightIrisCenter;

            // Measure iris position relative to eye center
            const avgDefX = ((leftIris.x - leftE.x) + (rightIris.x - rightE.x)) * 0.5;
            const avgDefY = ((leftIris.y - leftE.y) + (rightIris.y - rightE.y)) * 0.5;

            // Apply high-contrast gaze multipliers (horizontal is inverted for mirror-reflection alignment)
            rawGazeX = -avgDefX * 12.0; 
            rawGazeY = avgDefY * 12.0;
          }

          // Compute instantaneous delta and update velocity metrics
          const dt = Math.max(0.005, Math.min(0.1, delta));
          const instVelX = (rawHeadX - lastRawHeadRef.current.x) / dt;
          const instVelY = (rawHeadY - lastRawHeadRef.current.y) / dt;
          const instVelZ = (rawHeadZ - lastRawHeadRef.current.z) / dt;

          const instGazeVelX = (rawGazeX - lastRawGazeRef.current.x) / dt;
          const instGazeVelY = (rawGazeY - lastRawGazeRef.current.y) / dt;

          // Save current raw positions for velocity calculations in the next frame
          lastRawHeadRef.current.x = rawHeadX;
          lastRawHeadRef.current.y = rawHeadY;
          lastRawHeadRef.current.z = rawHeadZ;

          lastRawGazeRef.current.x = rawGazeX;
          lastRawGazeRef.current.y = rawGazeY;

          // Filter tracking velocities to eliminate micro-jitter noise
          const velEMA = 0.25;
          headVelocityRef.current.x += (instVelX - headVelocityRef.current.x) * velEMA;
          headVelocityRef.current.y += (instVelY - headVelocityRef.current.y) * velEMA;
          headVelocityRef.current.z += (instVelZ - headVelocityRef.current.z) * velEMA;

          gazeVelocityRef.current.x += (instGazeVelX - gazeVelocityRef.current.x) * velEMA;
          gazeVelocityRef.current.y += (instGazeVelY - gazeVelocityRef.current.y) * velEMA;

          // ADVANCED PREDICTIVE EXTRAPOLATION: Forecast the physical head and gaze state 
          // 85 milliseconds in the future to actively compensate for camera capture latency and hardware bottleneck lag.
          // This makes the 3D parallax shifts feel absolutely instantaneous and lag-free!
          const predictionSeconds = 0.085;
          const predictedHeadX = rawHeadX + headVelocityRef.current.x * predictionSeconds;
          const predictedHeadY = rawHeadY + headVelocityRef.current.y * predictionSeconds;
          const predictedHeadZ = rawHeadZ + headVelocityRef.current.z * predictionSeconds;

          const predictedGazeX = rawGazeX + gazeVelocityRef.current.x * predictionSeconds;
          const predictedGazeY = rawGazeY + gazeVelocityRef.current.y * predictionSeconds;

          // Smooth the predicted target tracks with robust Low-Pass Filters (EMA)
          const filterAlpha = 0.18;
          smoothedHeadRef.current.x += (predictedHeadX - smoothedHeadRef.current.x) * filterAlpha;
          smoothedHeadRef.current.y += (predictedHeadY - smoothedHeadRef.current.y) * filterAlpha;
          smoothedHeadRef.current.z += (predictedHeadZ - smoothedHeadRef.current.z) * filterAlpha;

          smoothedGazeRef.current.x += (predictedGazeX - smoothedGazeRef.current.x) * filterAlpha;
          smoothedGazeRef.current.y += (predictedGazeY - smoothedGazeRef.current.y) * filterAlpha;

          // Translate head coordinates directly to the virtual camera position in 3D
          const targetCamX = smoothedHeadRef.current.x * 1.4;
          const targetCamY = smoothedHeadRef.current.y * 1.3 + 1.25; // Elevated to match standard screen positioning relative to webcam
          const targetCamZ = Math.max(7.5, Math.min(24.0, smoothedHeadRef.current.z * 1.4));

          // Interpolate camera viewport coordinates smoothly
          data.camera.position.x += (targetCamX - data.camera.position.x) * 0.18;
          data.camera.position.y += (targetCamY - data.camera.position.y) * 0.18;
          data.camera.position.z += (targetCamZ - data.camera.position.z) * 0.18;
          
          // --- DYNAMIC PERSPECTIVE CONTRAST (FOV Dolly-Zoom & Scenes Tilt) ---
          const currentZ = data.camera.position.z;
          const targetFov = Math.max(28, Math.min(75, 45 + (15 - currentZ) * 3.8));
          data.camera.fov += (targetFov - data.camera.fov) * 0.12;
          data.camera.updateProjectionMatrix();

          // Smoothly tilt the room itself to exaggerate parallax depths!
          data.roomGroup.rotation.y = -data.camera.position.x * 0.025;
          data.roomGroup.rotation.x = (data.camera.position.y - 1.2) * 0.025;

          // --- GEOMETRIC LOOK-THROUGH-GLASS PROJECTIVE ESTIMATION ---
          // Assume the virtual monitor screen sits at Z=0.
          // The 3D model is located deep within the screen, centered around Z = -1.5.
          // Let's compute the intersection of the viewer's eye ray with the model's focal plane (Z = -1.5).
          // This allows users to "look directly at" components as if they are looking through glass!
          const zModel = -1.5; 
          const tProjection = 1.0 - (zModel / targetCamZ);

          const lookAtTargetX = (tProjection * smoothedGazeRef.current.x) - (targetCamX * 0.25);
          const lookAtTargetY = 0.5 + (tProjection * smoothedGazeRef.current.y) - (targetCamY - 1.25) * 0.4;
          const lookAtTargetZ = zModel;
          
          data.camera.lookAt(lookAtTargetX, lookAtTargetY, lookAtTargetZ);
        } else {
          // --- FALLBACK PERSPECTIVE (MOUSE HOVER EYE PERSPECTIVE SIMULATOR) ---
          // Multipliers exaggerated for strong depth ("超立体的") when dragging or hovering
          const targetCamX = mouseX * 1.8;
          const targetCamY = mouseY * 1.8 + 1.2;
          const targetCamZ = 16.0; // Steady distance

          data.camera.position.x += (targetCamX - data.camera.position.x) * 0.08;
          data.camera.position.y += (targetCamY - data.camera.position.y) * 0.08;
          data.camera.position.z += (targetCamZ - data.camera.position.z) * 0.08;

          // Dynamic FOV for cursor tracking relative to center offset
          const centerOffset = Math.sqrt(mouseX * mouseX + mouseY * mouseY);
          const targetFov = Math.max(35, Math.min(65, 45 + centerOffset * 3.5));
          data.camera.fov += (targetFov - data.camera.fov) * 0.1;
          data.camera.updateProjectionMatrix();

          // Tilt fallback
          data.roomGroup.rotation.y = -data.camera.position.x * 0.03;
          data.roomGroup.rotation.x = (data.camera.position.y - 1.2) * 0.03;

          // Exaggerated POINT-OF-VIEW target modulation for fallback cursor hover
          const lookAtTargetX = -(data.camera.position.x) * 0.22;
          const lookAtTargetY = 0.5 - (data.camera.position.y - 1.2) * 0.45;
          const lookAtTargetZ = -1.0;

          data.camera.lookAt(lookAtTargetX, lookAtTargetY, lookAtTargetZ);
        }

        // --- SPECULAR LIGHTING PERSPECTIVE SWEEP (Tactile Depth Realism) ---
        // Dynamically move the focusLight to match the camera's X-Y, producing beautiful shimmering specular highlights!
        if (data.focusLight) {
          data.focusLight.position.x = data.camera.position.x * 0.75;
          data.focusLight.position.y = data.camera.position.y * 0.75;
        }

      } else {
        // Observer Mode or Default Calibration View
        // Camera is interactive and revolves around 3D skull mapping and shows models
        data.screenPlane.visible = true;
        data.faceGroup.visible = currentShowLandmarks;
        data.roomGroup.visible = true; // Always keep beautiful models visible in observer mode too!
        data.controls.enabled = true;

        // Reset room rotation to standard in observer mode
        data.roomGroup.rotation.set(0, 0, 0);

        // Standard steady FOV and light tracking in observer mode
        data.camera.fov = 45;
        data.camera.updateProjectionMatrix();
        if (data.focusLight) {
          data.focusLight.position.set(0, 0, 5);
        }

        data.controls.update();
      }

      // Render scene
      data.renderer.render(data.scene, data.camera);
    };

    animate();

    // --- RESIZE HANLDER (ResizeObserver) ---
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0 && threeRef.current) {
          const { camera: cam, renderer: r } = threeRef.current;
          cam.aspect = w / h;
          cam.updateProjectionMatrix();
          r.setSize(w, h);
        }
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // --- CLEANUP ---
    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      if (containerRef.current) {
        containerRef.current.removeEventListener('pointermove', handlePointerMove);
      }
      controls.dispose();

      // Deeply dispose of all materials & geometries recursively to prevent memory or GPU video RAM leaks
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || (THREE.LineSegments && object instanceof THREE.LineSegments)) {
          if (object.geometry) {
            object.geometry.dispose();
          }
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach((mat) => mat.dispose());
            } else {
              object.material.dispose();
            }
          }
        }
      });

      renderer.dispose();
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden rounded-2xl bg-[#0a0f1d] border border-slate-800 shadow-2xl">
      <canvas ref={canvasRef} className="w-full h-full block" id="3d-viewport-canvas" />
      
      {/* 3D Scene watermark labeling */}
      <div className="absolute top-4 left-4 font-mono text-[10px] text-slate-500 bg-slate-950/80 backdrop-blur-md px-2 py-1 rounded border border-slate-800/50 flex items-center gap-1.5 select-none pointer-events-none">
        <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse"></span>
        3D ENGINE : WEBGL_ACTIVE
      </div>
      
      {viewMode === 'parallax' && (
        <div className="absolute bottom-4 right-4 pointer-events-none font-sans text-xs bg-indigo-950/80 backdrop-blur-md text-indigo-200 px-3 py-1.5 rounded-lg border border-indigo-700/50 flex flex-col items-end gap-1 font-semibold">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></span>
            ACTIVE PARALLAX HOLOGRAPHY
          </div>
          <div className="text-[10px] text-indigo-400 font-mono font-normal">Head coordinates drive the 3D Camera</div>
        </div>
      )}

      {viewMode === 'observer' && (
        <div className="absolute bottom-4 right-4 pointer-events-none font-sans text-xs bg-slate-950/80 backdrop-blur-md text-slate-300 px-3 py-1.5 rounded-lg border border-slate-800 flex flex-col items-end gap-1">
          <div className="flex items-center gap-1 text-[11px] font-medium font-mono text-cyan-400">
            DRAG MOUSE & WHEEL TO ORBIT & ZOOM IN 3D
          </div>
        </div>
      )}
    </div>
  );
}
