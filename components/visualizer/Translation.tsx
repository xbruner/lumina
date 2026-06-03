"use no memo";
"use client";

import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { getThreeBands } from "@/lib/audioAnalysis";

/**
 * MASTER SCENE CONFIGURATION
 */
const SCENE_CONFIG = {
  camera: {
    // 0.1 on Z prevents a math glitch called "gimbal lock" when looking straight down
    startPos: [0, 99, 0.1] as [number, number, number], 
    target: [0, 0, 0] as [number, number, number],   
  },
  expansion: {
    core: 0.7,    
    terrain: 0.8, 
    vapor: 1.0,   
  }
};

/**
 * SHARED SHADER CHUNK: HSL to RGB
 * This allows all layers to "roll" through the rainbow using a single 'hue' value.
 */
const colorChunk = `
  vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
    return c.z + c.y * (rgb-0.5)*(1.0-abs(2.0*c.z-1.0));
  }
`;

// ── Layer 1: Core Pulse (The Pristine Focal Object) ─────────────────────────
function CorePulse({
  smoothBass,
  smoothMids,
  smoothHighs,
  smoothBurst,
  uColorTime,
}: {
  smoothBass: React.MutableRefObject<number>;
  smoothMids: React.MutableRefObject<number>;
  smoothHighs: React.MutableRefObject<number>;
  smoothBurst: React.MutableRefObject<number>;
  uColorTime: React.MutableRefObject<number>;
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null!);
  const groupRef = useRef<THREE.Group>(null!);

  const { positions, randoms } = useMemo(() => {
    let seed = 111222;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const count = 3000;
    const pos = new Float32Array(count * 3);
    const rands = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const theta = rnd() * Math.PI * 2;
      const phi = Math.acos(rnd() * 2 - 1);
      const r = 2.0 + (rnd() * 0.5);

      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      rands[i] = rnd();
    }
    return { positions: pos, randoms: rands };
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uHighs: { value: 0 },
      uBurst: { value: 0 },
      uColorTime: { value: 0 },
      uExpLimit: { value: SCENE_CONFIG.expansion.core }
    }),
    [],
  );

  const vertexShader = `
    uniform float uTime;
    uniform float uBass;
    uniform float uHighs;
    uniform float uBurst;
    uniform float uExpLimit;
    attribute float aRandom;
    varying float vAlpha;
    varying vec3 vPos;

    void main() {
      vec3 p = position;
      vec3 dir = normalize(p);
      
      float noise = sin(dir.x * 6.0 + uTime * 2.0) * cos(dir.y * 6.0 - uTime) * sin(dir.z * 6.0 + uTime * 1.5);
      
      // Expansion driven by highs — large baseline always separates sphere; highs push it way out
      float expansion = (2.0 + (uHighs * 14.0) + (noise * uHighs * 6.0)) * uExpLimit;
      float burstExpand = (uBurst * (10.0 + aRandom * 15.0)) * uExpLimit;
      float jitter = (aRandom - 0.5) * uHighs * 2.0;

      p += dir * (expansion + burstExpand + jitter);
      vPos = p;

      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      
      gl_PointSize = (4.0 + uHighs * 8.0 + uBurst * 5.0) * (40.0 / -mv.z);
      gl_Position = projectionMatrix * mv;

      vAlpha = mix(0.5, 1.0, uHighs) + uBurst;
    }
  `;

  const fragmentShader = `
    varying float vAlpha;
    varying vec3 vPos;
    uniform float uColorTime;
    ${colorChunk}

    void main() {
      float d = distance(gl_PointCoord, vec2(0.5));
      if (d > 0.5) discard;
      float a = 1.0 - smoothstep(0.1, 0.5, d);
      
      // Rainbow based on time + vertical height
      float hue = mod(uColorTime + vPos.y * 0.05, 1.0);
      vec3 color = hsl2rgb(vec3(hue, 0.8, 0.82));

      gl_FragColor = vec4(color, a * vAlpha);
    }
  `;

  useFrame((state, delta) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      materialRef.current.uniforms.uBass.value = smoothBass.current;
      materialRef.current.uniforms.uHighs.value = smoothHighs.current;
      materialRef.current.uniforms.uBurst.value = smoothBurst.current;
      materialRef.current.uniforms.uColorTime.value = uColorTime.current;
    }
    if (groupRef.current) {
      groupRef.current.rotation.y -= delta * (0.2 + smoothMids.current * 0.5);
      groupRef.current.rotation.z += delta * (0.1 + smoothBass.current * 0.2);
    }
  });

  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
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
    </group>
  );
}

// ── Layer 2: Terrain Field (Resting Waves) ──────────────────────────────────
function TerrainField({
  smoothBass,
  smoothMids,
  smoothHighs,
  smoothBurst,
  uColorTime,
  shimmerPhase,
}: {
  smoothBass: React.MutableRefObject<number>;
  smoothMids: React.MutableRefObject<number>;
  smoothHighs: React.MutableRefObject<number>;
  smoothBurst: React.MutableRefObject<number>;
  uColorTime: React.MutableRefObject<number>;
  shimmerPhase: React.MutableRefObject<number>;
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null!);
  const groupRef = useRef<THREE.Group>(null!);

  const { positions, randoms } = useMemo(() => {
    let seed = 333444;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const count = 8000;
    const pos = new Float32Array(count * 3);
    const rands = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const r = Math.pow(rnd(), 0.8) * 60; 
      const theta = rnd() * Math.PI * 2;
      
      pos[i * 3] = Math.cos(theta) * r;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = Math.sin(theta) * r;
      rands[i] = rnd();
    }
    return { positions: pos, randoms: rands };
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMids: { value: 0 },
      uHighs: { value: 0 },
      uBurst: { value: 0 },
      uColorTime: { value: 0 },
      uShimmerPhase: { value: 0 },
      uExpLimit: { value: SCENE_CONFIG.expansion.terrain }
    }),
    [],
  );

  const vertexShader = `
    uniform float uTime;
    uniform float uBass;
    uniform float uHighs;
    uniform float uBurst;
    uniform float uExpLimit;
    attribute float aRandom;
    varying float vAlpha;
    varying vec3 vPos;

    void main() {
      vec3 p = position;
      float r = length(p.xz);
      float theta = atan(p.z, p.x);

      float wave1 = sin(r * 0.4 - uTime * 1.5);
      float wave2 = cos(theta * 12.0 + uTime * 0.5); 
      float wave3 = sin(r * 0.15 + theta * 6.0 - uTime);

      float displacement = wave1 * wave2 * (1.0 + wave3);
      
      p.y += displacement * (2.0 + uBass * 15.0 + uBurst * 10.0) * uExpLimit;

      float jitter = (aRandom - 0.5) * uHighs * 4.0;
      p.y += jitter;
      vPos = p;

      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      
      gl_PointSize = (1.5 + uBass * 2.5 + uHighs * 1.5) * (50.0 / -mv.z);
      gl_Position = projectionMatrix * mv;

      float edgeFade = 1.0 - smoothstep(20.0, 60.0, r);
      vAlpha = (0.4 + uBass * 0.8 + uBurst * 0.5 + uHighs * 0.3) * edgeFade;
    }
  `;

  const fragmentShader = `
    varying float vAlpha;
    varying vec3 vPos;
    uniform float uColorTime;
    ${colorChunk}

    uniform float uMids;
    uniform float uShimmerPhase;

    void main() {
      float d = distance(gl_PointCoord, vec2(0.5));
      if (d > 0.5) discard;
      float a = 1.0 - smoothstep(0.2, 0.5, d);

      // Rainbow based on distance from center
      float r = length(vPos.xz);
      float hue = mod(uColorTime + r * 0.015, 1.0);
      vec3 color = hsl2rgb(vec3(hue, 0.90, 0.78));

      // Mids-driven shimmer: a sharp radial ring of brightness sweeping outward
      float shimmerRing = sin(r * 0.25 - uShimmerPhase) * 0.5 + 0.5;
      shimmerRing = pow(shimmerRing, 4.0);
      float finalAlpha = vAlpha + shimmerRing * uMids * 1.8;

      gl_FragColor = vec4(color, a * finalAlpha);
    }
  `;

  useFrame((state, delta) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      materialRef.current.uniforms.uBass.value = smoothBass.current;
      materialRef.current.uniforms.uMids.value = smoothMids.current;
      materialRef.current.uniforms.uHighs.value = smoothHighs.current;
      materialRef.current.uniforms.uBurst.value = smoothBurst.current;
      materialRef.current.uniforms.uColorTime.value = uColorTime.current;
      materialRef.current.uniforms.uShimmerPhase.value = shimmerPhase.current;
    }
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * (0.05 + smoothMids.current * 0.2);
    }
  });

  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
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
    </group>
  );
}

// ── Layer 3: Vapor Trails (Organic Stippled Mist) ───────────────────────────
function VaporTrails({
  smoothBass,
  smoothMids,
  smoothHighs,
  smoothBurst,
  uColorTime,
  shimmerPhase,
}: {
  smoothBass: React.MutableRefObject<number>;
  smoothMids: React.MutableRefObject<number>;
  smoothHighs: React.MutableRefObject<number>;
  smoothBurst: React.MutableRefObject<number>;
  uColorTime: React.MutableRefObject<number>;
  shimmerPhase: React.MutableRefObject<number>;
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null!);
  const groupRef = useRef<THREE.Group>(null!);

  const { positions, randoms } = useMemo(() => {
    let seed = 555666;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const count = 12000;
    const pos = new Float32Array(count * 3); 
    const rands = new Float32Array(count * 3); 

    for (let i = 0; i < count; i++) {
      const r = 5.0 + Math.pow(rnd(), 0.9) * 45; 
      const t = rnd() * Math.PI * 2;
      
      pos[i * 3] = Math.cos(t) * r;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = Math.sin(t) * r;

      rands[i * 3] = rnd();     
      rands[i * 3 + 1] = rnd(); 
      rands[i * 3 + 2] = rnd(); 
    }
    return { positions: pos, randoms: rands };
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMids: { value: 0 },
      uHighs: { value: 0 },
      uBurst: { value: 0 },
      uColorTime: { value: 0 },
      uShimmerPhase: { value: 0 },
      uExpLimit: { value: SCENE_CONFIG.expansion.vapor }
    }),
    [],
  );

  const vertexShader = `
    uniform float uTime;
    uniform float uBass;
    uniform float uHighs;
    uniform float uBurst;
    uniform float uExpLimit;
    attribute vec3 aRandom;
    varying float vAlpha;
    varying vec3 vPos;

    void main() {
      vec3 p = position;
      float r = length(p.xz);
      float theta = atan(p.z, p.x);

      float wave1 = sin(r * 0.4 - uTime * 1.5);
      float wave2 = cos(theta * 12.0 + uTime * 0.5);
      float wave3 = sin(r * 0.15 + theta * 6.0 - uTime);
      float baseTerrain = wave1 * wave2 * (1.0 + wave3);
      
      float driftTime = uTime * (0.2 + aRandom.x * 0.3);
      p.x += sin(driftTime * 2.0 + aRandom.y * 10.0) * 1.5;
      p.z += cos(driftTime * 1.8 + aRandom.x * 10.0) * 1.5;

      p.y += (baseTerrain * (2.0 + uBass * 15.0 + uBurst * 10.0) * uExpLimit);
      p.y += (aRandom.z * 3.0) + (uBass * 2.0); 

      vPos = p;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      
      float stippleSize = (0.5 + aRandom.y * 2.5);
      gl_PointSize = (stippleSize + uHighs * 2.0 + uBass * 1.5) * (45.0 / -mv.z);
      gl_Position = projectionMatrix * mv;

      float coreProtect = smoothstep(6.0, 12.0, r);
      float edgeFade = 1.0 - smoothstep(20.0, 45.0, r);
      
      vAlpha = (0.35 + uHighs * 0.5 + uBurst * 0.4 + uBass * 0.3) * edgeFade * coreProtect;
    }
  `;

  const fragmentShader = `
    varying float vAlpha;
    varying vec3 vPos;
    uniform float uColorTime;
    ${colorChunk}

    uniform float uMids;
    uniform float uShimmerPhase;

    void main() {
      float d = distance(gl_PointCoord, vec2(0.5));
      float blur = exp(-d * 6.0);
      
      // Rainbow based on angle (theta) around scene + time
      float r = length(vPos.xz);
      float hue = mod(uColorTime + r * 0.01, 1.0);
      vec3 color = hsl2rgb(vec3(hue, 0.95, 0.78));

      // Mids-driven shimmer: a sharp radial ring of brightness sweeping outward
      float shimmerRing = sin(r * 0.25 - uShimmerPhase) * 0.5 + 0.5;
      shimmerRing = pow(shimmerRing, 4.0);
      float finalAlpha = vAlpha + shimmerRing * uMids * 1.3;

      gl_FragColor = vec4(color, blur * finalAlpha);
    }
  `;

  useFrame((state, delta) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      materialRef.current.uniforms.uBass.value = smoothBass.current;
      materialRef.current.uniforms.uMids.value = smoothMids.current;
      materialRef.current.uniforms.uHighs.value = smoothHighs.current;
      materialRef.current.uniforms.uBurst.value = smoothBurst.current;
      materialRef.current.uniforms.uColorTime.value = uColorTime.current;
      materialRef.current.uniforms.uShimmerPhase.value = shimmerPhase.current;
    }
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * (0.08 + smoothMids.current * 0.25);
    }
  });

  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-aRandom" args={[randoms, 3]} />
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
    </group>
  );
}

// ── Root Export: Monochrome Symmetry ─────────────────────────────────────────
export default function MonochromeSymmetry({
  audioData,
}: {
  audioData: Uint8Array | null;
}) {
  const smoothBass = useRef(0);
  const smoothMids = useRef(0);
  const smoothHighs = useRef(0);
  const smoothBurst = useRef(0);
  
  // Controls the rolling rainbow spectrum
  const uColorTime = useRef(0);

  // Advances with mids energy — drives the shimmer ring in TerrainField and VaporTrails
  const shimmerPhase = useRef(0);

  const lastBurstTime = useRef(0);
  const burstActive = useRef(false);

  useFrame((state, delta) => {
    const { bass, mids, highs } = getThreeBands(audioData);

    // DEFLATE LOGIC: 
    // Attack is fast (12.0). Deflate/decay is slow (1.5).
    const targetBass = bass;
    const lerpSpeed = targetBass > smoothBass.current ? 12.0 : 1.5;
    
    smoothBass.current = THREE.MathUtils.lerp(smoothBass.current, targetBass, delta * lerpSpeed);
    smoothMids.current = THREE.MathUtils.lerp(smoothMids.current, mids, delta * 10);
    smoothHighs.current = THREE.MathUtils.lerp(smoothHighs.current, highs, delta * 16); 

    // Move the rainbow wheel forward
    uColorTime.current += delta * 0.15;

    // Advance shimmer phase — faster when mids are active, slow background drift otherwise
    shimmerPhase.current += delta * (0.8 + smoothMids.current * 3.0);

    const elapsed = state.clock.elapsedTime;
    const cycleLength = 35;
    const cyclePos = elapsed % cycleLength;

    if (cyclePos < delta * 2 && elapsed - lastBurstTime.current > cycleLength * 0.5) {
      lastBurstTime.current = elapsed;
      burstActive.current = true;
    }

    let targetBurst = 0;
    if (burstActive.current) {
      const burstAge = elapsed - lastBurstTime.current;
      targetBurst = Math.max(0, 1.0 - (burstAge / 5.0)); 
      if (burstAge > 5) burstActive.current = false;
    }

    smoothBurst.current = THREE.MathUtils.lerp(smoothBurst.current, targetBurst, delta * 8);
  });

  return (
    <>
      <color attach="background" args={["#000000"]} />
      
      <PerspectiveCamera 
        makeDefault 
        position={SCENE_CONFIG.camera.startPos} 
        fov={45}
      />
      
      <CorePulse 
        smoothBass={smoothBass} 
        smoothMids={smoothMids} 
        smoothHighs={smoothHighs} 
        smoothBurst={smoothBurst} 
        uColorTime={uColorTime}
      />
      
      <TerrainField 
        smoothBass={smoothBass} 
        smoothMids={smoothMids} 
        smoothHighs={smoothHighs} 
        smoothBurst={smoothBurst} 
        uColorTime={uColorTime}
        shimmerPhase={shimmerPhase}
      />
      
      <VaporTrails 
        smoothBass={smoothBass} 
        smoothMids={smoothMids} 
        smoothHighs={smoothHighs} 
        smoothBurst={smoothBurst} 
        uColorTime={uColorTime}
        shimmerPhase={shimmerPhase}
      />

      <OrbitControls
        makeDefault
        target={SCENE_CONFIG.camera.target}
        autoRotate={true}
        autoRotateSpeed={0.5}
        enablePan={false}
        minDistance={15}
        maxDistance={80}
      />
    </>
  );
}