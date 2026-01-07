import React from 'react';
import * as R3F from '@react-three/fiber';
import * as Drei from '@react-three/drei';

export type SceneDslLight =
  | { type: 'ambient'; intensity?: number; color?: string }
  | { type: 'point'; position?: [number, number, number]; intensity?: number; color?: string }
  | { type: 'environment'; preset?: string };

export type SceneDslObject =
  | {
      kind: 'planet';
      id?: string;
      name?: string;
      mass?: number;
      radius?: number;
      position?: [number, number, number];
      color?: string;
    }
  | {
      kind: 'force_arrow';
      from?: string;
      to?: string;
      color?: string;
    }
  | {
      kind: 'orbit_path';
      radius?: number;
      color?: string;
      opacity?: number;
    }
  | {
      kind: 'label';
      text: string;
      position?: [number, number, number];
      color?: string;
      size?: number;
    };

export interface SceneDsl {
  type: 'r3f_scene';
  camera?: {
    position?: [number, number, number];
    fov?: number;
  };
  lights?: SceneDslLight[];
  objects?: SceneDslObject[];
}

interface SceneFromDslProps {
  dsl: SceneDsl;
}

const findPlanetPosition = (dsl: SceneDsl, planetId?: string | null) => {
  if (!planetId) return null;
  const planet = (dsl.objects || []).find(
    o => o.kind === 'planet' && (o.id === planetId || (o as any).name === planetId)
  ) as SceneDslObject | undefined;
  if (!planet || planet.kind !== 'planet') return null;
  return planet.position || [0, 0, 0];
};

const PlanetMesh: React.FC<{ planet: Extract<SceneDslObject, { kind: 'planet' }> }> = ({ planet }) => {
  const radius = planet.radius ?? 1;
  const color = planet.color || '#38bdf8';
  const position = planet.position || [0, 0, 0];
  const groupRef = React.useRef<THREE.Group | null>(null);

  R3F.useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.2;
    }
  });

  return (
    <group ref={groupRef} position={position as [number, number, number]}>
      <mesh>
        <sphereGeometry args={[radius, 48, 48]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} roughness={0.35} metalness={0.4} />
      </mesh>
    </group>
  );
};

const ForceArrow: React.FC<{ dsl: SceneDsl; config: Extract<SceneDslObject, { kind: 'force_arrow' }> }> = ({
  dsl,
  config
}) => {
  const from = findPlanetPosition(dsl, config.from || null);
  const to = findPlanetPosition(dsl, config.to || null);
  if (!from || !to) return null;
  const color = config.color || '#f97316';

  return (
    <Drei.Line
      points={[from, to]}
      color={color}
      lineWidth={2}
      dashed={false}
    />
  );
};

const OrbitPath: React.FC<{ config: Extract<SceneDslObject, { kind: 'orbit_path' }> }> = ({ config }) => {
  const radius = config.radius ?? 4;
  const color = config.color || '#475569';
  const opacity = config.opacity ?? 0.2;

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[Math.max(radius - 0.15, 0.1), radius + 0.15, 128]} />
      <meshBasicMaterial color={color} opacity={opacity} transparent />
    </mesh>
  );
};

const SceneLabel: React.FC<{ config: Extract<SceneDslObject, { kind: 'label' }> }> = ({ config }) => {
  const position = config.position || [0, 0, 0];
  const color = config.color || '#e5e7eb';
  const size = config.size ?? 0.5;

  return (
    <Drei.Text position={position as [number, number, number]} color={color} fontSize={size}>
      {config.text}
    </Drei.Text>
  );
};

export const SceneFromDsl: React.FC<SceneFromDslProps> = ({ dsl }) => {
  const lights = dsl.lights || [];
  const objects = dsl.objects || [];

  return (
    <>
      {lights.map((light, index) => {
        if (light.type === 'ambient') {
          return <ambientLight key={index} intensity={light.intensity ?? 0.4} color={light.color || '#ffffff'} />;
        }
        if (light.type === 'point') {
          return (
            <pointLight
              key={index}
              position={(light.position || [10, 10, 10]) as [number, number, number]}
              intensity={light.intensity ?? 1.2}
              color={light.color || '#ffffff'}
            />
          );
        }
        if (light.type === 'environment') {
          return <Drei.Environment key={index} preset={light.preset || 'city'} />;
        }
        return null;
      })}

      <Drei.ContactShadows position={[0, -3, 0]} opacity={0.4} scale={40} blur={2.5} far={40} />
      <Drei.Grid infiniteGrid sectionColor="#1e293b" cellColor="#020617" fadeDistance={60} />

      {objects.map((obj, index) => {
        if (obj.kind === 'planet') {
          return <PlanetMesh key={obj.id || obj.name || index} planet={obj} />;
        }
        if (obj.kind === 'force_arrow') {
          return <ForceArrow key={index} dsl={dsl} config={obj} />;
        }
        if (obj.kind === 'orbit_path') {
          return <OrbitPath key={index} config={obj} />;
        }
        if (obj.kind === 'label') {
          return <SceneLabel key={index} config={obj} />;
        }
        return null;
      })}
    </>
  );
};

export const Sci3D = {
  SceneFromDsl
};
