import React, { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// Create a circle texture for the particles to make them look round
const getParticleTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Outer glow
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    
    ctx.beginPath();
    ctx.arc(16, 16, 16, 0, 2 * Math.PI);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
};

// Comet component
const Comets = () => {
  const count = 5; // Number of active comets
  const cometsRef = useRef<{ position: THREE.Vector3, velocity: THREE.Vector3, life: number }[]>([]);
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  
  // Initialize comets
  useMemo(() => {
    cometsRef.current = Array.from({ length: count }).map(() => ({
      position: new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 10
      ),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.05,
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.05
      ),
      life: Math.random() // 0 to 1
    }));
  }, []);

  useFrame((state, delta) => {
    if (!geometryRef.current) return;

    const positions = geometryRef.current.attributes.position.array as Float32Array;
    const opacities = geometryRef.current.attributes.opacity.array as Float32Array;

    cometsRef.current.forEach((comet, i) => {
      // Move comet
      comet.position.add(comet.velocity);
      comet.life -= delta * 0.3;

      // Reset if dead
      if (comet.life <= 0) {
        comet.position.set(
          (Math.random() - 0.5) * 15,
          (Math.random() - 0.5) * 5,
          (Math.random() - 0.5) * 15
        );
        // Ensure velocity is generally towards center or random
        comet.velocity.set(
           (Math.random() - 0.5) * 0.1,
           (Math.random() - 0.5) * 0.05,
           (Math.random() - 0.5) * 0.1
        );
        comet.life = 1;
      }

      positions[i * 3] = comet.position.x;
      positions[i * 3 + 1] = comet.position.y;
      positions[i * 3 + 2] = comet.position.z;
      
      // Fade in and out
      // Sine wave based on life: 0 -> 1 -> 0
      opacities[i] = Math.sin(comet.life * Math.PI) * 0.8;
    });

    geometryRef.current.attributes.position.needsUpdate = true;
    geometryRef.current.attributes.opacity.needsUpdate = true;
  });

  const texture = useMemo(() => getParticleTexture(), []);

  return (
    <points>
      <bufferGeometry ref={geometryRef}>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={new Float32Array(count * 3)}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-opacity"
          count={count}
          array={new Float32Array(count)}
          itemSize={1}
        />
      </bufferGeometry>
      {/* Custom shader material for per-particle opacity */}
      <shaderMaterial
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={{
          uTexture: { value: texture },
          uSize: { value: 150.0 }, // Larger size for comets
          uColor: { value: new THREE.Color('#a0c0ff') }
        }}
        vertexShader={`
          attribute float opacity;
          varying float vOpacity;
          uniform float uSize;
          void main() {
            vOpacity = opacity;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = uSize * (1.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          uniform sampler2D uTexture;
          uniform vec3 uColor;
          varying float vOpacity;
          void main() {
            vec4 texColor = texture2D(uTexture, gl_PointCoord);
            gl_FragColor = vec4(uColor, vOpacity * texColor.a);
          }
        `}
      />
    </points>
  );
};


const GALAXY_PARAMETERS = {
  count: 8000,
  baseSize: 0.015,
  sizeVariation: 0.03, // Added variation
  radius: 6,
  branches: 3,
  spin: 1,
  randomness: 0.2,
  randomnessPower: 3,
  insideColor: '#ff6030',
  outsideColor: '#1b3984',
};

const Galaxy = () => {
  const pointsRef = useRef<THREE.Points>(null);
  const { camera, raycaster, pointer } = useThree();
  
  // Store ripples: { position: Vector3, time: number, maxRadius: number }
  const ripplesRef = useRef<{ position: THREE.Vector3; time: number }[]>([]);
  
  // Store initial positions to calculate offsets from
  const initialData = useMemo(() => {
    const positions = new Float32Array(GALAXY_PARAMETERS.count * 3);
    const colors = new Float32Array(GALAXY_PARAMETERS.count * 3);
    const sizes = new Float32Array(GALAXY_PARAMETERS.count); // Per-particle size
    
    const colorInside = new THREE.Color(GALAXY_PARAMETERS.insideColor);
    const colorOutside = new THREE.Color(GALAXY_PARAMETERS.outsideColor);

    for (let i = 0; i < GALAXY_PARAMETERS.count; i++) {
      const i3 = i * 3;
      const radius = Math.random() * GALAXY_PARAMETERS.radius;
      const spinAngle = radius * GALAXY_PARAMETERS.spin;
      const branchAngle = ((i % GALAXY_PARAMETERS.branches) / GALAXY_PARAMETERS.branches) * Math.PI * 2;
      
      const randomX = Math.pow(Math.random(), GALAXY_PARAMETERS.randomnessPower) * (Math.random() < 0.5 ? 1 : -1) * GALAXY_PARAMETERS.randomness * radius;
      const randomY = Math.pow(Math.random(), GALAXY_PARAMETERS.randomnessPower) * (Math.random() < 0.5 ? 1 : -1) * GALAXY_PARAMETERS.randomness * radius;
      const randomZ = Math.pow(Math.random(), GALAXY_PARAMETERS.randomnessPower) * (Math.random() < 0.5 ? 1 : -1) * GALAXY_PARAMETERS.randomness * radius;

      positions[i3] = Math.cos(branchAngle + spinAngle) * radius + randomX;
      positions[i3 + 1] = randomY; // Flattened galaxy
      positions[i3 + 2] = Math.sin(branchAngle + spinAngle) * radius + randomZ;

      // Color
      const mixedColor = colorInside.clone();
      mixedColor.lerp(colorOutside, radius / GALAXY_PARAMETERS.radius);
      
      colors[i3] = mixedColor.r;
      colors[i3 + 1] = mixedColor.g;
      colors[i3 + 2] = mixedColor.b;

      // Random size: base + random * variation
      // Center particles tend to be slightly larger maybe? or just random
      sizes[i] = Math.random() * GALAXY_PARAMETERS.sizeVariation; 
    }
    
    return { positions, colors, sizes };
  }, []);

  const particleTexture = useMemo(() => getParticleTexture(), []);

  // Use state to hold the geometry arrays so we can update them
  const [geometryData] = useState(() => ({
    positions: new Float32Array(initialData.positions),
    colors: new Float32Array(initialData.colors),
    sizes: new Float32Array(initialData.sizes)
  }));

  useFrame((state, delta) => {
    if (!pointsRef.current) return;

    // Slowly rotate the whole galaxy
    pointsRef.current.rotation.y += delta * 0.05;

    // Update ripples
    const activeRipples = ripplesRef.current.filter(r => r.time < 5.0); // Ripple lasts 5 seconds
    ripplesRef.current = activeRipples;

    activeRipples.forEach(r => {
      r.time += delta * 2.0; // Speed of expansion
    });

    // Update particles based on ripples
    const positions = pointsRef.current.geometry.attributes.position.array as Float32Array;
    
    if (activeRipples.length > 0) {
      for (let i = 0; i < GALAXY_PARAMETERS.count; i++) {
        const i3 = i * 3;
        
        // Original position (local space)
        const ox = initialData.positions[i3];
        const oy = initialData.positions[i3 + 1];
        const oz = initialData.positions[i3 + 2];
        
        let dx = 0, dy = 0, dz = 0;

        const worldRot = pointsRef.current.rotation.y;
        
        for (const ripple of activeRipples) {
          const cosR = Math.cos(-worldRot);
          const sinR = Math.sin(-worldRot);
          
          const rx = ripple.position.x * cosR - ripple.position.z * sinR;
          const rz = ripple.position.x * sinR + ripple.position.z * cosR;
          const ry = ripple.position.y; 

          const dist = Math.sqrt(
            Math.pow(ox - rx, 2) + 
            Math.pow(oy - ry, 2) + 
            Math.pow(oz - rz, 2)
          );

          const waveRadius = ripple.time;
          const waveWidth = 1.0;
          const distFromWave = Math.abs(dist - waveRadius);
          
          if (distFromWave < waveWidth) {
            const intensity = Math.cos((distFromWave / waveWidth) * Math.PI / 2);
            const displacement = intensity * 0.5 * (1.0 - ripple.time / 5.0);
            dy += Math.sin(dist * 10 - ripple.time * 10) * displacement; 
          }
        }

        positions[i3] = ox + dx;
        positions[i3 + 1] = oy + dy;
        positions[i3 + 2] = oz + dz;
      }
      pointsRef.current.geometry.attributes.position.needsUpdate = true;
    } else {
         for (let i = 0; i < GALAXY_PARAMETERS.count; i++) {
            const i3 = i * 3;
            positions[i3] = initialData.positions[i3];
            positions[i3 + 1] = initialData.positions[i3 + 1];
            positions[i3 + 2] = initialData.positions[i3 + 2];
         }
         pointsRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={geometryData.positions.length / 3}
            array={geometryData.positions}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-color"
            count={geometryData.colors.length / 3}
            array={geometryData.colors}
            itemSize={3}
          />
          {/* Custom attribute for size variation if we were using a shader, 
              but for PointsMaterial we can only set global size. 
              To support variable size, we MUST use ShaderMaterial or standard material won't cut it 
              unless we just accept uniform size. 
              
              However, PointsMaterial *does* support size attenuation, but not per-particle size attribute 
              unless we modify the shader.
              
              Let's switch to ShaderMaterial to support per-particle size properly.
          */}
           <bufferAttribute
            attach="attributes-size"
            count={geometryData.sizes.length}
            array={geometryData.sizes}
            itemSize={1}
          />
        </bufferGeometry>
        {/* Using ShaderMaterial for per-particle sizing */}
        <shaderMaterial
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={{
            uTexture: { value: particleTexture },
            uBaseSize: { value: 20.0 }, // Base scale factor
          }}
          vertexShader={`
            attribute float size;
            attribute vec3 color;
            varying vec3 vColor;
            uniform float uBaseSize;
            void main() {
              vColor = color;
              vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
              // Size attenuation: size / distance
              gl_PointSize = (uBaseSize + size * 400.0) * (1.0 / -mvPosition.z);
              gl_Position = projectionMatrix * mvPosition;
            }
          `}
          fragmentShader={`
            uniform sampler2D uTexture;
            varying vec3 vColor;
            void main() {
              vec4 texColor = texture2D(uTexture, gl_PointCoord);
              if (texColor.a < 0.1) discard;
              gl_FragColor = vec4(vColor, texColor.a);
            }
          `}
        />
      </points>
      {/* Invisible plane to catch clicks */}
      <mesh 
        visible={false} 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[0, 0, 0]}
        onClick={(e) => {
            ripplesRef.current.push({
                position: e.point.clone(),
                time: 0
            });
        }}
      >
        <planeGeometry args={[50, 50]} />
      </mesh>
    </>
  );
};

export const ParticleBackground = () => {
  return (
    <div className="absolute inset-0 -z-10 bg-[#020617]">
      <Canvas 
        camera={{ position: [0, 3, 4], fov: 65 }}
        gl={{ preserveDrawingBuffer: true }}
      >
        <fog attach="fog" args={['#020617', 3, 15]} /> 
        <ambientLight intensity={0.5} />
        <Galaxy />
        <Comets />
      </Canvas>
    </div>
  );
};
