"use no memo";
"use client";

import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { getThreeBands } from "@/lib/audioAnalysis";

const PARTICLE_COUNT = 12000;
const RADIUS = 1.8;

/**
 * Flower - Audio reactive particle system
 * This component should be used inside a VisualizerViewport
 */
export default function Flower({ audioData }: { audioData: Uint8Array | null }) {
  const { pointer } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const currentHighs = useRef(0);
  const currentMids = useRef(0);
  const currentBass = useRef(0);
  const audioRotAccumulator = useRef(0);

  const { positions, aGerm, aFlower, aRandom } = useMemo(() => {
    let seed = 888;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const germ = new Float32Array(PARTICLE_COUNT * 3);
    const flower = new Float32Array(PARTICLE_COUNT * 3);
    const rand = new Float32Array(PARTICLE_COUNT);

    /**
     * Generates hexagonal grid centers for circle packing
     * stage 0: 1 circle (Center)
     * stage 1: 7 circles (Seed/Germ)
     * stage 2: 19 circles (Flower)
     */
    const getCenters = (stages: number) => {
      const centers: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)];
      for (let s = 1; s <= stages; s++) {
        for (let i = 0; i < 6; i++) {
          const angle = (i * Math.PI) / 3;
          const rootX = Math.cos(angle) * RADIUS * s;
          const rootY = Math.sin(angle) * RADIUS * s;
          centers.push(new THREE.Vector3(rootX, rootY, 0));

          if (s > 1) {
            for (let j = 1; j < s; j++) {
              const nextAngle = ((i + 1) * Math.PI) / 3;
              const nextX = Math.cos(nextAngle) * RADIUS * s;
              const nextY = Math.sin(nextAngle) * RADIUS * s;
              centers.push(new THREE.Vector3(
                rootX + (nextX - rootX) * (j / s),
                rootY + (nextY - rootY) * (j / s),
                0
              ));
            }
          }
        }
      }
      return centers;
    };

    const centersSeed = getCenters(1);
    const centersFlower = getCenters(2);

    for (let p = 0; p < PARTICLE_COUNT; p++) {
      const rVal = rnd();
      rand[p] = rVal;
      const angle = rnd() * Math.PI * 2;

      // Seed Logic: 7 Circles
      const cS = centersSeed[Math.floor(rnd() * centersSeed.length)];
      pos[p * 3] = cS.x + Math.cos(angle) * RADIUS;
      pos[p * 3 + 1] = cS.y + Math.sin(angle) * RADIUS;
      pos[p * 3 + 2] = (rnd() - 0.5) * 0.05;

      // Germ Logic: Uses the same centers as Seed but visual density shifts
      const cG = centersSeed[Math.floor(rnd() * centersSeed.length)];
      germ[p * 3] = cG.x + Math.cos(angle) * RADIUS;
      germ[p * 3 + 1] = cG.y + Math.sin(angle) * RADIUS;
      germ[p * 3 + 2] = (rnd() - 0.5) * 0.1;

      // Flower Logic: 19 Circles
      const cF = centersFlower[Math.floor(rnd() * centersFlower.length)];
      flower[p * 3] = cF.x + Math.cos(angle) * RADIUS;
      flower[p * 3 + 1] = cF.y + Math.sin(angle) * RADIUS;
      flower[p * 3 + 2] = (rnd() - 0.5) * 0.15;
    }

    return { positions: pos, aGerm: germ, aFlower: flower, aRandom: rand };
  }, []);

  const shaderArgs = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
      uAudioActive: { value: 0 },
      uBass: { value: 0 },
      uMids: { value: 0 },
      uHighs: { value: 0 },
      uBreath: { value: 1.0 },
      uColor1: { value: new THREE.Color("#00ffcc") },
      uColor2: { value: new THREE.Color("#0066ff") },
      uColor3: { value: new THREE.Color("#aa00ff") },
      uColor4: { value: new THREE.Color("#ff0066") },
      uColor5: { value: new THREE.Color("#ffcc00") },
    },
    vertexShader: `
      attribute vec3 aGerm;
      attribute vec3 aFlower;
      attribute float aRandom;
      varying vec3 vPos;
      varying float vRandom;
      uniform float uTime;
      uniform float uAudioActive;
      uniform float uBass;
      uniform float uBreath;

      void main() {
        vRandom = aRandom;
        float morph1 = smoothstep(5.0, 8.0, uTime);
        float morph2 = smoothstep(11.0, 25.0, uTime);

        vec3 pos = mix(position, aGerm, morph1);
        pos = mix(pos, aFlower, morph2);

        // Smooth activation over 3s — keeps the original wave character while
        // preventing the hard if(>25) snap from the initial sequence.
        float waveActive = smoothstep(24.0, 27.0, uTime);
        float wave = sin(length(pos.xy) * 0.8 + uTime) * 1.5;
        pos.z += wave * waveActive * uAudioActive * (1.0 + uBass) * uBreath;

        if (uAudioActive > 0.0 && uBass > 0.45) {
           float trigger = step(0.96, fract(aRandom * 100.0 + uTime * 2.0));
           pos += (vec3(fract(aRandom * 7.0), fract(aRandom * 13.0), fract(aRandom * 19.0)) - 0.5) * trigger * uBass * 12.0;
        }

        vPos = pos;
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = (12.0 / -mvPosition.z) * (1.1 + uBass * 1.5);
      }
    `,
    fragmentShader: `
      varying vec3 vPos;
      varying float vRandom;
      uniform float uTime;
      uniform float uAudioActive;
      uniform float uMids;
      uniform float uHighs;
      uniform vec3 uColor1, uColor2, uColor3, uColor4, uColor5;

      void main() {
        if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
        float dist = length(vPos.xy) * 0.15;
        float swirl = fract(dist - uTime * 0.15 + (uMids * uAudioActive * 2.0));
        vec3 col = mix(uColor1, uColor2, smoothstep(0.0, 0.2, swirl));
        col = mix(col, uColor3, smoothstep(0.2, 0.4, swirl));
        col = mix(col, uColor4, smoothstep(0.4, 0.6, swirl));
        col = mix(col, uColor5, smoothstep(0.6, 0.8, swirl));
        col = mix(col, uColor1, smoothstep(0.8, 1.0, swirl));
        col += uHighs * uAudioActive * 0.8;
        gl_FragColor = vec4(col, 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }), []);

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    const { bass, mids, highs } = getThreeBands(audioData);

    currentBass.current = THREE.MathUtils.lerp(currentBass.current, bass, delta * 10);
    currentMids.current = THREE.MathUtils.lerp(currentMids.current, mids, delta * 10);
    currentHighs.current = THREE.MathUtils.lerp(currentHighs.current, highs, delta * 10);

    const audioActive = THREE.MathUtils.smoothstep(time, 15.5, 16.5);

    // Create the "Breath" (0 = flat, 1 = deep)
    const breath = Math.abs(Math.sin(time * 0.15)) * 0.9 + 0.1;

    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = time;
      materialRef.current.uniforms.uAudioActive.value = audioActive;
      materialRef.current.uniforms.uBass.value = currentBass.current;
      materialRef.current.uniforms.uMids.value = currentMids.current;
      materialRef.current.uniforms.uHighs.value = currentHighs.current;
      materialRef.current.uniforms.uBreath.value = breath;
    }

    if (groupRef.current) {
      const axisSwitch = Math.sin(time * 0.2);

      // 1. Friction stays to keep it snappy
      audioRotAccumulator.current *= 0.90;
      audioRotAccumulator.current += currentHighs.current * audioActive * delta * 1.5;

      // 2. THE LIMITER:
      const baseTiltY = Math.sin(time * 0.2) * 0.4;
      const musicTiltY = audioRotAccumulator.current * axisSwitch;

      // Apply Y Rotation (Limited range)
      groupRef.current.rotation.y = baseTiltY + musicTiltY;

      // Apply X Rotation (Limited range + Pointer)
      const baseTiltX = Math.cos(time * 0.15) * 0.4;
      const xTarget = (pointer.y * 0.4) + baseTiltX + (audioRotAccumulator.current * (0.6 - Math.abs(axisSwitch)));

      groupRef.current.rotation.x = THREE.MathUtils.lerp(
        groupRef.current.rotation.x,
        xTarget,
        0.05
      );

      // 3. Keep Z subtle so it doesn't flip the design over
      groupRef.current.rotation.z = Math.sin(time * 0.1) * 0.2 + (currentMids.current * audioActive * 0.1);
    }
  });

  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-aGerm" args={[aGerm, 3]} />
          <bufferAttribute attach="attributes-aFlower" args={[aFlower, 3]} />
          <bufferAttribute attach="attributes-aRandom" args={[aRandom, 1]} />
        </bufferGeometry>
        <shaderMaterial ref={materialRef} args={[shaderArgs]} />
      </points>
      <OrbitControls enablePan={false} />
    </group>
  );
}