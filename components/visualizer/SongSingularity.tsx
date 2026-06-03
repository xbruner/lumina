"use client";

import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// Suppress THREE.Clock deprecation warning (R3F internal, harmless)
const originalWarn = console.warn;
console.warn = (...args) => {
  if (args[0]?.includes?.("THREE.Clock")) return;
  originalWarn.apply(console, args);
};

// ── FREQUENCY MAP (fftSize=512, 256 bins, ~43Hz/bin at 44100Hz) ─────────
// Bass / kick       (0–275Hz)   → bins 0–6
// Mids / vocals     (320–3.5kHz)→ bins 7–81
// Highs / cymbals   (3.5k–20kHz)→ bins 81–116

function binPeak(data: Uint8Array | null, lo: number, hi: number): number {
  if (!data) return 0;
  let peak = 0;
  const end = Math.min(hi, data.length - 1);
  for (let i = lo; i <= end; i++) if (data[i] > peak) peak = data[i];
  return peak / 255;
}

function binAvg(data: Uint8Array | null, lo: number, hi: number): number {
  if (!data) return 0;
  const end = Math.min(hi, data.length - 1);
  let sum = 0;
  for (let i = lo; i <= end; i++) sum += data[i];
  return sum / (end - lo + 1) / 255;
}

// Weighted bin average with crossover rolloff and noise gating
function weightedBandEnergy(data: Uint8Array | null, ranges: [number, number, number][], noiseFloor: number): number {
  if (!data) return 0;

  let totalEnergy = 0;
  let totalWeight = 0;

  for (const [start, end, weight] of ranges) {
    const actualEnd = Math.min(end, data.length - 1);
    for (let i = start; i <= actualEnd; i++) {
      totalEnergy += (data[i] / 255) * weight;
      totalWeight += weight;
    }
  }

  const avgEnergy = totalEnergy / totalWeight;
  return avgEnergy > noiseFloor ? avgEnergy : 0;
}

// ── CORE ─────────────────────────────────────────────────────────────────────
function Core({ audioData }: { audioData: Uint8Array | null }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const scale = useRef(1.0);

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    meshRef.current.rotation.y += 0.008;
    meshRef.current.rotation.x += 0.004;

    if (audioData) {
      // Bass reaction: bins 0–6 (~0–275Hz) with crossover rolloff and noise gate
      // Full weight 0-3, reduced weight 4-6 (rolloff from mids), noise floor 0.88
      const bassEnergy = weightedBandEnergy(audioData, [
        [0, 3, 1.0],   // Full bass range
        [4, 6, 0.2],   // Rolloff zone
      ], 0.88);
      const targetScale = 1.0 + bassEnergy * 0.4;
      // Fast delta-based attack catches 16th notes; slow release holds the hit and prevents flicker
      const lerpSpeed = targetScale > scale.current ? delta * 20 : delta * 3;
      scale.current = THREE.MathUtils.lerp(scale.current, targetScale, lerpSpeed);
    } else {
      // Gentle breathing when no audio
      const idle = 1 + Math.sin(state.clock.elapsedTime * 1.5) * 0.04;
      scale.current = THREE.MathUtils.lerp(scale.current, idle, 0.04);
    }

    meshRef.current.scale.setScalar(scale.current);
  });

  const shader = useMemo(() => ({
    uniforms: {
      color1: { value: new THREE.Color("#a855f7") }, // purple
      color2: { value: new THREE.Color("#06b6d4") }, // cyan
    },
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color1;
      uniform vec3 color2;
      varying vec3 vNormal;
      void main() {
        float fresnel = dot(vNormal, vec3(0.0, 0.0, 1.0));
        float intensity = pow(1.0 - fresnel, 3.0);
        float grad = vNormal.x * 0.5 + 0.5;
        float mask = smoothstep(0.0, 0.5, grad);
        vec3 rim = mix(color1, color2, grad) * mask;
        gl_FragColor = vec4(rim * intensity * 1.5, 1.0);
      }
    `,
  }), []);

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1.5, 64, 64]} />
      <shaderMaterial args={[shader]} />
    </mesh>
  );
}

// ── RINGS ─────────────────────────────────────────────────────────────────────
function Rings({ audioData }: { audioData: Uint8Array | null }) {
  const groupRef = useRef<THREE.Group>(null);
  const opacities = useRef<number[]>(new Array(14).fill(0.5));

  const rings = useMemo(() => {
    const c1 = new THREE.Color("#a855f7");   // purple
    const c2 = new THREE.Color("#06b6d4");   // cyan
    const c3 = new THREE.Color("#f59e0b");   // amber
    const c4 = new THREE.Color("#10b981");   // emerald
    const palette = [c1, c1, c1, c1, c2, c2, c2, c2, c3, c3, c3, c3, c4, c4];

    // Use seeded random for consistent results
    let seed = 12345;
    const seededRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const arr = [];
    for (let i = 0; i < 14; i++) {
      // Spread across mid range (bins 7–81, ~320Hz–3.5kHz)
      const bin = 7 + Math.floor((i / 14) * 74);
      arr.push({
        radius: 2.2 + seededRandom() * 7,
        tube: 0.012 + seededRandom() * 0.018,
        color: palette[i],
        speedX: (seededRandom() - 0.5) * 0.03,
        speedY: (seededRandom() - 0.5) * 0.025,
        speed: (seededRandom() - 0.5) * 0.04,
        rot: new THREE.Euler(
          seededRandom() * Math.PI,
          seededRandom() * Math.PI,
          seededRandom() * Math.PI
        ),
        bin,
      });
    }
    return arr;
  }, []);

  useFrame((state) => {
    if (!groupRef.current) return;

    groupRef.current.rotation.y = state.clock.elapsedTime * 0.07;
    groupRef.current.rotation.x = state.clock.elapsedTime * 0.025;

    groupRef.current.children.forEach((child, i) => {
      child.rotation.x += rings[i].speedX;
      child.rotation.y += rings[i].speedY;
      child.rotation.z += rings[i].speed;
      child.scale.setScalar(1.0);

      if (!audioData) {
        const idle = 0.05 + Math.sin(state.clock.elapsedTime * 1.8 + i * 0.4) * 0.03;
        opacities.current[i] = THREE.MathUtils.lerp(opacities.current[i], idle, 0.04);
      } else {
        // Mids reaction: bins 7–81 (~320Hz–3.5kHz) with crossover rolloff and noise gate
        // Reduced weight 7-10 (rolloff from bass), full weight 11-75, reduced weight 76-81 (rolloff to highs), noise floor 0.10
        const midsEnergy = weightedBandEnergy(audioData, [
          [7, 10, 0.3],   // Rolloff from bass
          [11, 75, 1.0],  // Full mids range
          [76, 81, 0.3],  // Rolloff to highs
        ], 0.10);
        const target = 0.05 + midsEnergy * 0.95; // Near-invisible to full bright
        // Fast attack (0.8) and fast release (0.3) for snappy response
        const lerpSpeed = target > opacities.current[i] ? 0.8 : 0.3;
        opacities.current[i] = THREE.MathUtils.lerp(opacities.current[i], target, lerpSpeed);
      }

      if ((child as THREE.Mesh).material instanceof THREE.Material) {
        ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = opacities.current[i];
      }
    });
  });

  return (
    <group ref={groupRef}>
      {rings.map((r, i) => (
        <mesh key={i} rotation={r.rot}>
          <torusGeometry args={[r.radius, r.tube, 16, 100]} />
          <meshBasicMaterial
            color={r.color}
            transparent
            opacity={0.3}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ── PARTICLES ─────────────────────────────────────────────────────────────────
function Particles({ count = 2000, audioData }: { count: number; audioData: Uint8Array | null }) {
  const pointsRef = useRef<THREE.Points>(null);
  const rotSpeed = useRef(0.015);

  const [positions, colors, sizes] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const sz = new Float32Array(count);
    const c1 = new THREE.Color("#a855f7");
    const c2 = new THREE.Color("#06b6d4");

    // Use seeded random for consistent results
    let seed = 54321;
    const seededRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    for (let i = 0; i < count; i++) {
      const r = Math.pow(seededRandom(), 2) * 15 + 1.6;
      const theta = seededRandom() * 2 * Math.PI;
      const phi = Math.acos(seededRandom() * 2 - 1);
      pos.set([
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      ], i * 3);
      const mc = c1.clone().lerp(c2, seededRandom());
      col.set([mc.r, mc.g, mc.b], i * 3);
      sz[i] = seededRandom() * 3.0 + 1.0;
    }
    return [pos, col, sz];
  }, [count]);

  const shaderArgs = useMemo(() => ({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute vec3 color;
      attribute float size;
      varying vec3 vColor;
      varying float vDepth;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * (40.0 / -mv.z);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vDepth;
      void main() {
        float d = distance(gl_PointCoord, vec2(0.5));
        float a = 1.0 - smoothstep(0.4, 0.5, d);
        if (a < 0.01) discard;
        float df = smoothstep(8.0, 16.0, vDepth);
        gl_FragColor = vec4(mix(vec3(1.0), vColor, df), a * 0.8);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  useFrame((state, delta) => {
    if (!pointsRef.current) return;

    if (audioData) {
      // Highs reaction: bins 81–116 (~3.5kHz–20kHz) with crossover rolloff and noise gate
      // Reduced weight 81-84 (rolloff from mids), full weight 85-116, noise floor 0.12
      const highsEnergy = weightedBandEnergy(audioData, [
        [81, 84, 0.3],  // Rolloff from mids
        [85, 116, 1.0], // Full highs range
      ], 0.12);
      const target = 0.015 + highsEnergy * 1.2; // From slow to very fast rotation
      // Fast transitions for snappy response to cymbals
      rotSpeed.current = THREE.MathUtils.lerp(rotSpeed.current, target, 0.4);
    } else {
      rotSpeed.current = THREE.MathUtils.lerp(rotSpeed.current, 0.015, 0.05);
    }

    pointsRef.current.rotation.y += rotSpeed.current * delta;
    pointsRef.current.rotation.z += 0.008 * delta;

    // Subtle mouse follow
    pointsRef.current.position.x = THREE.MathUtils.lerp(pointsRef.current.position.x, state.pointer.x * 2, 0.04);
    pointsRef.current.position.y = THREE.MathUtils.lerp(pointsRef.current.position.y, state.pointer.y * 2, 0.04);
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
          args={[positions, 3]}
        />
        <bufferAttribute
          attach="attributes-color"
          count={colors.length / 3}
          array={colors}
          itemSize={3}
          args={[colors, 3]}
        />
        <bufferAttribute
          attach="attributes-size"
          count={sizes.length}
          array={sizes}
          itemSize={1}
          args={[sizes, 1]}
        />
      </bufferGeometry>
      <shaderMaterial args={[shaderArgs]} />
    </points>
  );
}

// ── SCENE ─────────────────────────────────────────────────────────────────────
function Scene({ audioData }: { audioData: Uint8Array | null }) {
  const { size } = useThree();
  const isMobile = size.width < 768;
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isLowPower = isMobile && (prefersReducedMotion || size.width < 480);

  // Reduce particle count on mobile/low-power devices; never zero so particles always render
  const particleCount = isLowPower ? 150 : isMobile ? 500 : 2000;

  const pos: [number, number, number] = isMobile ? [0, 0, -4.0] : [0, 0, 0];

  return (
    <group position={pos}>
      <Core audioData={audioData} />
      <Rings audioData={audioData} />
      {particleCount > 0 && <Particles count={particleCount} audioData={audioData} />}
    </group>
  );
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
export default function SongSingularity({ audioData }: { audioData: Uint8Array | null }) {
  return (
    <>
      <fog attach="fog" args={["#0a0a0a", 5, 25]} />
      <Scene audioData={audioData} />
    </>
  );
}
