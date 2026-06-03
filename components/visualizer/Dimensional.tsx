"use no memo";
"use client";

import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { getThreeBands } from "@/lib/audioAnalysis";

// ── Layer 1: Starry space background (10k particles) ───────────────────────
function Stars({
  audioData,
  smoothHighs,
}: {
  audioData: Uint8Array | null;
  smoothHighs: React.MutableRefObject<number>;
}) {
  const pointsRef = useRef<THREE.Points>(null!);
  const materialRef = useRef<THREE.ShaderMaterial>(null!);

  const { positions } = useMemo(() => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const COUNT = 10000;
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const radius = 220 + rnd() * 140;
      const theta = rnd() * Math.PI * 2;
      const phi = Math.acos(rnd() * 2 - 1);
      pos[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = radius * Math.cos(phi);
    }
    return { positions: pos };
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uHighs: { value: 0 },
    }),
    [],
  );

  const vertexShader = `
    uniform float uTime;
    uniform float uHighs;
    varying float vTwinkle;

    void main() {
      vTwinkle = sin(uTime * 12.0 + position.x * 0.015) * 0.5 + 0.5;
      vTwinkle = mix(0.7, 1.4, vTwinkle * uHighs);

      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = (2.4 + uHighs * 3.2) * (280.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fragmentShader = `
    varying float vTwinkle;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      gl_FragColor = vec4(vec3(0.92, 0.96, 1.0) * vTwinkle, (1.0 - d * 1.8) * 0.95);
    }
  `;

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      materialRef.current.uniforms.uHighs.value = smoothHighs.current;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

// ── Layer 2: Hex terrain (perfectly centered ripple origin at 0,0) ─────────
function HexTerrain({
  audioData,
  smoothBass,
  smoothMids,
}: {
  audioData: Uint8Array | null;
  smoothBass: React.MutableRefObject<number>;
  smoothMids: React.MutableRefObject<number>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  // Scratchpad tools for color
  const tempColor = useMemo(() => new THREE.Color(), []);
  const baseRed = useMemo(() => new THREE.Color(0xff2200), []);
  const peakGlow = useMemo(() => new THREE.Color(0xffffff), []); // Bright white/orange glow

  const { hexPositions, count } = useMemo(() => {
    const positions: number[] = [];
    const spacingX = 7.2;
    const spacingZ = 6.23;
    const rows = 62;
    const cols = 62;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = (col - cols * 0.5) * spacingX + (row % 2 === 1 ? spacingX * 0.5 : 0);
        const z = (row - rows * 0.5) * spacingZ;
        if (Math.hypot(x, z) < 180) {
          positions.push(x, 0, z);
        }
      }
    }
    return { hexPositions: new Float32Array(positions), count: positions.length / 3 };
  }, []);

  const hexGeometry = useMemo(() => new THREE.CylinderGeometry(2.85, 2.85, 2.6, 6, 1, false), []);

  // Set base color to white so instance colors aren't tinted incorrectly
  const material = useMemo(() => new THREE.MeshPhongMaterial({
    color: 0xffffff, 
    emissive: 0x220000,
    shininess: 8,
    flatShading: true,
    side: THREE.DoubleSide,
  }), []);

  useFrame((state) => {
    if (!meshRef.current) return;

    const time = state.clock.elapsedTime;
    const bass = smoothBass.current;
    const mids = smoothMids.current;
    const rippleSpeed = 13.5;
    const rippleFrequency = 0.098;

    for (let i = 0; i < count; i++) {
      const x = hexPositions[i * 3];
      const z = hexPositions[i * 3 + 2];
      const distanceFromCenter = Math.hypot(x, z);

      const wave = Math.sin(distanceFromCenter * rippleFrequency - time * rippleSpeed) * 0.5 + 0.5;
      const height = wave * (bass * 6.0 + mids * 2.8);
      const microVariation = Math.sin(x * 1.1 + z * 0.9 + time * 2) * 0.3;

      dummy.position.set(x, height + microVariation, z);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      // --- DYNAMIC MUSIC GLOW ---
      // We only want the glow to happen at the peak of the wave (wave > 0.8)
      // and we scale that brightness by the current bass/mids.
      const musicFactor = (bass + mids) * 0.5;
      const intensity = Math.pow(wave, 4.0) * musicFactor; 
      
      tempColor.copy(baseRed).lerp(peakGlow, THREE.MathUtils.clamp(intensity, 0, 1));
      meshRef.current.setColorAt(i, tempColor);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[hexGeometry, material, count]}
      rotation={[0, Math.PI / 6, 0]}
      position={[0, -65, 0]}
    />
  );
}

// ── Layer 3: Cyan orb — EXACTLY above the ripple center (dead center) ──────
function CyanOrb({
  audioData,
  smoothBass,
  smoothMids,
}: {
  audioData: Uint8Array | null;
  smoothBass: React.MutableRefObject<number>;
  smoothMids: React.MutableRefObject<number>;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const coreRef = useRef<THREE.Mesh>(null!);
  const coreMaterialRef = useRef<THREE.ShaderMaterial>(null!);

  const coreGeometry = useMemo(() => new THREE.IcosahedronGeometry(18, 6), []);
  const glowGeometry = useMemo(() => new THREE.SphereGeometry(20, 64, 64), []);

  const coreUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMids: { value: 0 },
    }),
    [],
  );

  const coreVertexShader = `
    uniform float uTime;
    uniform float uBass;
    uniform float uMids;
    varying vec3 vNormal;

    void main() {
      vec3 pos = position;
      float distortion = sin(uTime * 4.8 + position.x * 7.0) * uBass * 1.25 +
                         sin(uTime * 8.5 + position.y * 9.0) * uMids * 0.85;
      pos += normal * distortion * 0.45;

      vNormal = normal;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  const coreFragmentShader = `
    varying vec3 vNormal;
    void main() {
      vec3 cyan = vec3(0.0, 0.96, 1.0);
      float rim = 1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0));
      rim = pow(rim, 2.8);
      gl_FragColor = vec4(cyan + rim * 0.4, 1.0);
    }
  `;

  useFrame((state) => {
    if (coreMaterialRef.current) {
      coreMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      coreMaterialRef.current.uniforms.uBass.value = smoothBass.current;
      coreMaterialRef.current.uniforms.uMids.value = smoothMids.current;
    }

    if (groupRef.current) {
      const bounceHeight = 8.0; 
      const bounceSpeed = 10.5;
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * bounceSpeed) * (bounceHeight * smoothMids.current);
      groupRef.current.rotation.y += 0.009 + smoothBass.current * 0.022;
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.7) * 0.09 * smoothMids.current;
      const pulseScale = 1.0 + smoothBass.current * 0.58;
      groupRef.current.scale.setScalar(pulseScale);
    }
  });

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      <mesh ref={coreRef} geometry={coreGeometry}>
        <shaderMaterial
          ref={coreMaterialRef}
          vertexShader={coreVertexShader}
          fragmentShader={coreFragmentShader}
          uniforms={coreUniforms}
          wireframe={false}
        />
      </mesh>

      <mesh geometry={glowGeometry}>
        <meshBasicMaterial
          color="#00ffff"
          transparent
          opacity={0.32}
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ── Root scene component ────────────────────────────────────────────────────
export default function HexTerrainCyanOrbScene({
  audioData,
}: {
  audioData: Uint8Array | null;
}) {
  const smoothBass = useRef(0);
  const smoothMids = useRef(0);
  const smoothHighs = useRef(0);

  // Initialize as a Vector3 to resolve TS2322 and TS2556
  const sceneCenter = useMemo(() => new THREE.Vector3(0, -100, 0), []);

  useFrame((state, delta) => {
    const { bass, mids, highs } = getThreeBands(audioData);

    smoothBass.current = THREE.MathUtils.lerp(
      smoothBass.current,
      bass,
      delta * 9,
    );
    smoothMids.current = THREE.MathUtils.lerp(
      smoothMids.current,
      mids,
      delta * 8,
    );
    smoothHighs.current = THREE.MathUtils.lerp(
      smoothHighs.current,
      highs,
      delta * 12,
    );
  });

  return (
    <>
      <color attach="background" args={["#03010c"]} />

      <PerspectiveCamera
        makeDefault
        position={[0, 40, 300]}
        fov={70}
        // Passing the Vector3 directly satisfies the lookAt signature
        onUpdate={(self) => self.lookAt(sceneCenter)}
      />

      <ambientLight intensity={0.18} />

      <Stars audioData={audioData} smoothHighs={smoothHighs} />
      <HexTerrain
        audioData={audioData}
        smoothBass={smoothBass}
        smoothMids={smoothMids}
      />
      <CyanOrb
        audioData={audioData}
        smoothBass={smoothBass}
        smoothMids={smoothMids}
      />

      <OrbitControls
        makeDefault={false}
        // Using the Vector3 object directly solves the "target" error
        target={sceneCenter}
        autoRotate={true}
        autoRotateSpeed={0.15}
        enablePan={false}
        minDistance={70}
        maxDistance={420}
        maxPolarAngle={Math.PI * 0.86}
      />
    </>
  );
}