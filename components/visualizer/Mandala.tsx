'use no memo';
'use client';
import React, { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { getThreeBands } from "@/lib/audioAnalysis";

// ──────────────────────────────────────────────────────────────
// IMPROVED LUMINOUS HAZE SHADERS (unchanged)
// ──────────────────────────────────────────────────────────────
const hazeVertexShader = `
  varying float vAlpha;
  uniform float uTime;
  uniform float uAudioBass;
  void main() {
    vec3 pos = position;

    float t = uTime * 0.15;
    float bassDrift = uAudioBass * 4.0;
    pos.x += sin(t + position.z * 0.05) * 3.5 + cos(t * 1.3 + position.y * 0.04) * 2.0;
    pos.y += cos(t * 0.8 + position.x * 0.06) * 3.0 + sin(t * 1.7 + position.z * 0.03) * 1.8;
    pos.z += sin(t * 0.6 + position.y * 0.07) * 2.2;
    pos.x += sin(t * 8.0 + position.z) * bassDrift * 0.8;
    pos.y += cos(t * 7.0 + position.x) * bassDrift * 0.6;
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float dist = abs(mvPosition.z);
    vAlpha = clamp(1.0 - (dist / 35.0), 0.0, 1.0);
    vAlpha *= (0.7 + uAudioBass * 0.8);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = (55.0 + uAudioBass * 25.0) * (28.0 / dist);
  }
`;
const hazeFragmentShader = `
  varying float vAlpha;
  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float r = length(center);
    float strength = pow(1.0 - smoothstep(0.0, 0.85, r), 3.5);
    strength = smoothstep(0.0, 1.0, strength);
    vec3 color = vec3(0.12, 0.08, 0.28);
    gl_FragColor = vec4(color, strength * vAlpha * 0.28);
  }
`;
function LuminousHaze({ audioData }: { audioData: Uint8Array | null }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const count = 18000;
  const positions = useMemo(() => {
    const p = new Float32Array(count * 3);
    let seed = 123.45;
    const stableRandom = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };
    for (let i = 0; i < count; i++) {
      p[i * 3] = (stableRandom() - 0.5) * 90;
      p[i * 3 + 1] = (stableRandom() - 0.5) * 85;
      p[i * 3 + 2] = (stableRandom() - 0.5) * 70;
    }
    return p;
  }, []);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uAudioBass: { value: 0 },
  }), []);
  useFrame((state) => {
    if (matRef.current) {
      const { bass } = getThreeBands(audioData);
      matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      matRef.current.uniforms.uAudioBass.value = bass;
    }
  });
  return (
    <points renderOrder={-1}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        vertexShader={hazeVertexShader}
        fragmentShader={hazeFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ──────────────────────────────────────────────────────────────
// BackgroundParticles (unchanged)
// ──────────────────────────────────────────────────────────────
const bgVertexShader = `
uniform float uTime;
varying vec3 vColor;
void main() {
  vec3 pos = position;
  pos.z += mod(uTime * 2.0, 50.0);
  if (pos.z > 25.0) pos.z -= 50.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = 2.0 * (25.0 / -gl_Position.z);
  vColor = mix(vec3(0.05, 0.1, 0.2), vec3(0.3, 0.1, 0.4), sin(uTime * 0.5 + pos.x) * 0.5 + 0.5);
}
`;
const bgFragmentShader = `
varying vec3 vColor;
void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;
  gl_FragColor = vec4(vColor, 0.6);
}
`;
function BackgroundParticles() {
  const bgMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const { positions } = useMemo(() => {
    const count = 3000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.sin(i * 3) * 10000 % 1 - 0.5) * 60;
      pos[i * 3 + 1] = (Math.sin(i * 3 + 1) * 10000 % 1 - 0.5) * 60;
      pos[i * 3 + 2] = (Math.sin(i * 3 + 2) * 10000 % 1 - 0.5) * 50;
    }
    return { positions: pos };
  }, []);
  useFrame((state) => {
    if (bgMaterialRef.current) bgMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <shaderMaterial
        ref={bgMaterialRef}
        vertexShader={bgVertexShader}
        fragmentShader={bgFragmentShader}
        uniforms={{ uTime: { value: 0 } }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ──────────────────────────────────────────────────────────────
// INSTANCED MANDALA SHADERS (Volumetric Dust)
// ──────────────────────────────────────────────────────────────
const mandalaVertexShader = `
  attribute float aType;
  attribute float aDist;
  varying float vType;
  varying float vDist;
  uniform float uTime;
  uniform float uAudioBass;
  uniform float uAudioMids;
  uniform float uAudioHighs;
  uniform float uActive;
  uniform vec2 uOriginOffset;
  void main() {
    vType = aType;
    vDist = aDist;
    vec4 localPosition = instanceMatrix * vec4(position, 1.0);
    vec3 pos = localPosition.xyz;
    if (pos.z < -1.0) {
        float depthFactor = abs(pos.z) / 10.0;
        pos.xy += uOriginOffset * depthFactor;
    }
    vec3 dir = length(pos) > 0.0 ? normalize(pos) : vec3(0.0);
    float breath = sin(uTime * 1.5 + vDist * 5.0) * (0.05 + uAudioMids * 0.5 * uActive);
    pos += dir * breath;
    float shiver = sin(uTime * 20.0 + vDist * 15.0) * (uAudioBass * 0.2 * uActive);
    pos += dir * shiver;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;
const mandalaFragmentShader = `
  varying float vType;
  varying float vDist;
  uniform float uTime;
  uniform float uAudioBass;
  uniform float uAudioMids;
  uniform float uAudioHighs;
  uniform float uActive;
  void main() {
    vec3 finalColor = vec3(1.0, 1.0, 1.0);
    float pWave = smoothstep(0.7, 1.0, fract(vDist * 2.5 - uTime * 2.0));
    vec3 purple = vec3(0.6, 0.1, 1.0);
    float rWave = smoothstep(0.7, 1.0, fract(vDist * 2.5 + uTime * 2.5));
    vec3 red = vec3(1.0, 0.1, 0.1);
    vec3 waveColor = mix(finalColor, purple, pWave * clamp(uAudioBass * 4.0, 0.0, 1.0));
    waveColor = mix(waveColor, red, rWave * clamp(uAudioHighs * 4.0, 0.0, 1.0));
    finalColor = mix(finalColor, waveColor, uActive);
    gl_FragColor = vec4(finalColor, 0.7);
  }
`;

function CameraRig() {
  // --- CONTROLS ---
  const homePos = new THREE.Vector3(-1, 1.7, 20);
  const radius = 11.5;
  const driftSpeed = 1.0;
  const startDelay = 17;
  const moveDuration = 7.5;
  const totalCycle = 30;

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // Pre-delay: gently drift camera toward homePos so there's no jerk
    // when the orbit rig takes over at t=startDelay
    if (t < startDelay) {
      state.camera.position.lerp(homePos, delta * 1.5);
      state.camera.lookAt(0, 0, 0);
      return;
    }

    const cycleTime = (t - startDelay) % totalCycle;

    let alpha = 0;
    if (cycleTime < moveDuration) {
      // Squared sine — forces derivative to zero at start AND end,
      // so the camera eases out of rest with zero initial velocity (no jerk)
      const s = Math.sin((cycleTime / moveDuration) * Math.PI);
      alpha = s * s;
    }

    const angle = t * driftSpeed;
    const offX = Math.cos(angle) * radius * alpha;
    const offY = Math.sin(angle) * radius * alpha;

    state.camera.position.x = homePos.x + offX;
    state.camera.position.y = homePos.y + offY;
    state.camera.position.z = homePos.z;

    state.camera.lookAt(0, 0, 0);
  });

  return null;
}

function SacredMandala({ audioData }: { audioData: Uint8Array | null }) {
  const groupRef = useRef<THREE.Group>(null);
  const mainMatRef = useRef<THREE.ShaderMaterial>(null);
  const centerGroupRef = useRef<THREE.Group>(null);
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  // Smoothed activation — prevents the hard 0→1 jump from causing a one-frame amplitude spike
  const activeSmooth = useRef(0);

  const borderMaterial = useMemo(() => new THREE.MeshBasicMaterial({ transparent: false, blending: THREE.AdditiveBlending }), []);
  const internalMaterial = useMemo(() => new THREE.MeshBasicMaterial({ transparent: false, blending: THREE.AdditiveBlending }), []);

  const outlineMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: false,
    blending: THREE.NormalBlending,
    side: THREE.BackSide,
    depthWrite: true,
    depthTest: true,
  }), []);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uAudioBass: { value: 0 },
    uAudioMids: { value: 0 },
    uAudioHighs: { value: 0 },
    uActive: { value: 0 },
    uOriginOffset: { value: new THREE.Vector2(0, 0) }
  }), []);

  const { matrices, types, dists, borderSegments, internalSegments, particleCount } = useMemo(() => {
    const tempMatrices: THREE.Matrix4[] = [];
    const tempTypes: number[] = [];
    const tempDists: number[] = [];
    const borderSegments: THREE.Vector3[][] = [];
    const internalSegments: THREE.Vector3[][] = [];

    const dummy = new THREE.Object3D();
    let seed = 123.456;
    const stableRandom = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };
    const addParticle = (pos: THREE.Vector3, type: number) => {
      dummy.position.copy(pos);
      const scale = 0.3 + stableRandom() * 0.7;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();

      tempMatrices.push(dummy.matrix.clone());
      tempTypes.push(type);
      tempDists.push(pos.length() / 15.0);
    };

    const spokes = 12;
    const maxR = 15;
    for (let s = 0; s < spokes; s++) {
      const angle = (s / spokes) * Math.PI * 2;
      for (let r = 0; r <= 80; r++) {
        const radius = (r / 80) * maxR;
        const z = -8 + (Math.pow(radius / maxR, 1.2) * 14);
        const scatter = () => (stableRandom() - 0.5) * 0.3;
        addParticle(new THREE.Vector3(
          Math.cos(angle) * radius + scatter(),
          Math.sin(angle) * radius + scatter(),
          z + scatter()
        ), 1.0);
      }
    }

    const layers = [4.0, 7.5, 11.0, 14.5];
    layers.forEach((baseR) => {
      const pts = 180;
      for (let i = 0; i < pts; i++) {
        const t = (i / pts) * Math.PI * 2;
        const petal = Math.abs(Math.sin(12 * t)) * 1.5;
        const r = baseR + petal;
        const x = Math.cos(t) * r;
        const y = Math.sin(t) * r;
        const zEnd = (r / 16) * 8;

        for (let step = 0; step < 8; step++) {
          const lerp = step / 7;
          const pX = x * lerp;
          const pY = y * lerp;
          const pZ = -10 + (zEnd - (-10)) * lerp;

          const scatter = () => (stableRandom() - 0.5) * 0.2;
          addParticle(new THREE.Vector3(pX + scatter(), pY + scatter(), pZ + scatter()), 1.0);
        }
      }
    });

    const triPoints = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1.8, 0, 0),
      new THREE.Vector3(0.9, 1.55, 0),
      new THREE.Vector3(-0.9, 1.55, 0),
      new THREE.Vector3(-1.8, 0, 0),
      new THREE.Vector3(-0.9, -1.55, 0),
      new THREE.Vector3(0.9, -1.55, 0)
    ];
    const hexPoints = triPoints.slice(1);
    for (let i = 0; i < hexPoints.length; i++) {
      borderSegments.push([hexPoints[i].clone(), hexPoints[(i + 1) % hexPoints.length].clone()]);
      internalSegments.push([triPoints[0].clone(), hexPoints[i].clone()]);
      for (let j = i + 1; j < hexPoints.length; j++) {
        internalSegments.push([hexPoints[i].clone(), hexPoints[j].clone()]);
      }
    }

    return {
      particleCount: tempMatrices.length,
      matrices: tempMatrices,
      types: new Float32Array(tempTypes),
      dists: new Float32Array(tempDists),
      borderSegments,
      internalSegments,
    };
  }, []);

  useEffect(() => {
    if (instancedMeshRef.current) {
      matrices.forEach((mat, i) => instancedMeshRef.current!.setMatrixAt(i, mat));
      instancedMeshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [matrices]);

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    const { bass, mids, highs } = getThreeBands(audioData);

    const introProgress = Math.min(time / 11.0, 1.0);
    const ease = introProgress * introProgress * (3.0 - 2.0 * introProgress);
    const currentScale = 0.01 + ease * 0.99;

    // Lerp toward 1 after intro — prevents the hard binary flip from
    // causing an 11× amplitude jump in a single frame.
    // delta * 0.5 gives a ~2s fade-in for a more gradual breathing onset.
    activeSmooth.current = THREE.MathUtils.lerp(
      activeSmooth.current,
      time > 11.0 ? 1.0 : 0.0,
      delta * 0.5
    );

    if (groupRef.current) {
      groupRef.current.scale.set(currentScale, currentScale, currentScale);
      groupRef.current.rotation.z = time * 0.05;
    }

    if (mainMatRef.current) {
      mainMatRef.current.uniforms.uTime.value = time;
      mainMatRef.current.uniforms.uAudioBass.value = bass;
      mainMatRef.current.uniforms.uAudioMids.value = mids;
      mainMatRef.current.uniforms.uAudioHighs.value = highs;
      mainMatRef.current.uniforms.uActive.value = activeSmooth.current;
      const moveRadius = 0.2;
      const moveSpeed = 0.6;
      const audioInfluence = 1.0 + (bass * 0.5 * activeSmooth.current);

      mainMatRef.current.uniforms.uOriginOffset.value.set(
        Math.cos(time * moveSpeed) * moveRadius * audioInfluence,
        Math.sin(time * moveSpeed) * moveRadius * audioInfluence
      );
    }

    if (centerGroupRef.current) {
      const pulse = 1 + bass * 0.35 * activeSmooth.current;
      centerGroupRef.current.scale.setScalar(pulse);
    }

    const midIntensity = mids * activeSmooth.current;

    const blueHue = 0.58 + Math.sin(time * 1.4) * 0.04;
    const blueLightness = 0.38 + Math.sin(time * 2.4) * 0.09 + midIntensity * 0.09;
    borderMaterial.color.setHSL(blueHue, 0.94, Math.min(0.52, blueLightness));

    internalMaterial.color.setHSL(0.62, 0.9, 0.1 + midIntensity * 0.3);
  });

  return (
    <group ref={groupRef}>
      <instancedMesh ref={instancedMeshRef} args={[undefined, undefined, particleCount]}>
        <sphereGeometry args={[0.08, 8, 8]}>
          <instancedBufferAttribute attach="attributes-aType" args={[types, 1]} />
          <instancedBufferAttribute attach="attributes-aDist" args={[dists, 1]} />
        </sphereGeometry>
        <shaderMaterial
          ref={mainMatRef}
          vertexShader={mandalaVertexShader}
          fragmentShader={mandalaFragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>

      <group ref={centerGroupRef}>
        {borderSegments.map((points, i) => (
          <group key={`border-${i}`}>
            <mesh>
              <tubeGeometry
                args={[
                  new THREE.CatmullRomCurve3(points),
                  16,
                  0.08,
                  8,
                  false
                ]}
              />
              <primitive object={outlineMaterial} attach="material" />
            </mesh>

            <mesh>
              <tubeGeometry
                args={[
                  new THREE.CatmullRomCurve3(points),
                  16,
                  0.035,
                  8,
                  false
                ]}
              />
              <primitive object={borderMaterial} attach="material" />
            </mesh>
          </group>
        ))}

        {internalSegments.map((points, i) => (
          <group key={`internal-${i}`}>
            <mesh>
              <tubeGeometry
                args={[new THREE.CatmullRomCurve3(points), 16, 0.055, 8, false]}
              />
              <primitive object={outlineMaterial} attach="material" />
            </mesh>
            <mesh>
              <tubeGeometry
                args={[new THREE.CatmullRomCurve3(points), 16, 0.03, 8, false]}
              />
              <primitive object={internalMaterial} attach="material" />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/**
 * Mandala - Complex sacred geometry visualizer
 * This component should be used inside a VisualizerViewport
 */
export default function Mandala({ audioData }: { audioData: Uint8Array | null }) {
  return (
    <>
      <CameraRig />

      <LuminousHaze audioData={audioData} />
      <BackgroundParticles />
      <SacredMandala audioData={audioData} />

      <OrbitControls enablePan={false} maxDistance={50} minDistance={10} />
    </>
  );
}
