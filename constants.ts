import { ScienceArtifact } from './types';

export const INITIAL_ARTIFACT: ScienceArtifact = {
  id: 'solar-system-demo-3d',
  createdAt: Date.now(),
  title: "3D 太阳系运行模拟 (Solar System)",
  description: "交互式三维引力模型。拖动以旋转，滚轮缩放，悬停行星查看名称。",
  code: `
// --- Sub-components defined OUTSIDE the main component to avoid remounting/hook errors ---

const Planet = ({ p, speedMultiplier = 1, onSelect }) => {
  const meshRef = React.useRef();
  const [hovered, setHover] = React.useState(false);
  const angleRef = React.useRef(Math.random() * Math.PI * 2);

  R3F.useFrame((_, delta) => {
    if (!meshRef.current) return;
    const s = speedMultiplier ?? 1;
    if (s <= 0) return;
    angleRef.current += delta * p.v * 0.5 * s;
    const angle = angleRef.current;
    meshRef.current.position.x = Math.sin(angle) * p.dist;
    meshRef.current.position.z = Math.cos(angle) * p.dist;
    meshRef.current.rotation.y += 0.5 * delta * s;
  });

  return (
    <group>
      {/* Orbit Path Visual */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[p.dist - 0.2, p.dist + 0.2, 128]} />
        <meshBasicMaterial color="#475569" opacity={0.15} transparent side={THREE.DoubleSide} />
      </mesh>
      
      {/* Planet Mesh */}
      <mesh 
        ref={meshRef}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
        onPointerOut={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          if (onSelect) {
            onSelect(p);
          }
        }}
      >
        <sphereGeometry args={[p.r, 32, 32]} />
        <meshStandardMaterial 
          color={p.color} 
          emissive={p.color}
          emissiveIntensity={hovered ? 0.5 : 0.1}
          roughness={0.7} 
        />
        
        {/* Label UI attached to 3D object */}
        {hovered && (
          <Drei.Html distanceFactor={26} position={[0, p.r + 2.2, 0]}>
            <div className="bg-slate-950/90 text-white text-sm font-bold px-3.5 py-2 rounded-xl border border-brand-400 whitespace-nowrap shadow-[0_0_18px_rgba(129,140,248,0.7)] backdrop-blur-md pointer-events-none transform -translate-x-1/2 -translate-y-full">
              {p.name}
            </div>
          </Drei.Html>
        )}
      </mesh>
    </group>
  );
};

const Sun = () => {
  const groupRef = React.useRef();
  R3F.useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.002;
    }
  });
  return (
    <group ref={groupRef}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[6, 64, 64]} />
        <meshStandardMaterial color="#fde68a" emissive="#fbbf24" emissiveIntensity={2} />
      </mesh>
      <mesh scale={[1.2, 1.2, 1.2]}>
        <sphereGeometry args={[6, 64, 64]} />
        <meshBasicMaterial color="#facc15" transparent opacity={0.3} side={THREE.BackSide} />
      </mesh>
      <pointLight intensity={3} distance={200} decay={0} color="#fffbeb" />
    </group>
  );
};

const SolarSystem = () => {
  const [speedMultiplier, setSpeedMultiplier] = React.useState(1);
  const [isPaused, setIsPaused] = React.useState(false);
  const [selectedPlanet, setSelectedPlanet] = React.useState(null);

  const planets = React.useMemo(() => [
    { name: '水星 Mercury', dist: 12, r: 0.8, v: 4, color: '#94a3b8', description: '距离太阳最近的行星，公转周期约 88 天，表面温差极大。' },
    { name: '金星 Venus', dist: 18, r: 1.5, v: 3, color: '#eab308', description: '与地球大小相近，但拥有厚重大气和极端温室效应。' },
    { name: '地球 Earth', dist: 26, r: 1.6, v: 2.5, color: '#3b82f6', description: '目前已知唯一存在生命的行星，拥有液态水与适宜大气。' },
    { name: '火星 Mars', dist: 34, r: 1.2, v: 2, color: '#ef4444', description: '被称为红色星球，拥有稀薄大气和巨大的奥林帕斯山。' },
    { name: '木星 Jupiter', dist: 50, r: 4.5, v: 1, color: '#d97706', description: '太阳系最大行星，气态巨行星，具有著名的大红斑。' },
    { name: '土星 Saturn', dist: 68, r: 3.8, v: 0.8, color: '#fcd34d', description: '以壮观的光环著称的气态巨行星，密度非常低。' },
    { name: '天王星 Uranus', dist: 84, r: 2.8, v: 0.5, color: '#22d3ee', description: '自转轴几乎“躺倒”，侧着在轨道上滚动的冰巨行星。' },
    { name: '海王星 Neptune', dist: 100, r: 2.7, v: 0.4, color: '#38bdf8', description: '最远的冰巨行星，拥有强烈风暴和高速喷流。' },
  ], []);

  const handlePlanetSelect = (planet) => {
    setSelectedPlanet(planet);
  };

  const effectiveSpeed = isPaused ? 0 : speedMultiplier;

  return (
    <div className="w-full h-full relative bg-slate-950 rounded-xl overflow-hidden shadow-2xl">
      <R3F.Canvas camera={{ position: [0, 60, 90], fov: 45 }} shadows>
        <color attach="background" args={['#020617']} />
        <ambientLight intensity={0.1} />
        <Sun />
        {planets.map((p) => (
          <Planet
            key={p.name}
            p={p}
            speedMultiplier={effectiveSpeed}
            onSelect={handlePlanetSelect}
          />
        ))}
        <Drei.Stars radius={300} depth={60} count={8000} factor={6} saturation={0} fade speed={0.2} />
        <Drei.OrbitControls 
          makeDefault 
          enablePan={true} 
          enableZoom={true} 
          enableRotate={true}
          minDistance={20} 
          maxDistance={300}
          autoRotate={!isPaused}
          autoRotateSpeed={0.2 * speedMultiplier + 0.1}
        />
      </R3F.Canvas>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-slate-900/90 border border-slate-700/70 px-5 py-3 rounded-2xl flex items-center gap-4 backdrop-blur">
        <span className="text-xs text-slate-400">轨道速度</span>
        <input
          type="range"
          min={0.2}
          max={3}
          step={0.1}
          value={speedMultiplier}
          onChange={(e) => setSpeedMultiplier(parseFloat(e.target.value))}
          className="w-40 accent-brand-500 cursor-pointer"
        />
        <button
          onClick={() => setIsPaused((prev) => !prev)}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-800/80 text-slate-100 hover:border-brand-500 hover:text-white transition-colors"
        >
          {isPaused ? '继续旋转' : '暂停旋转'}
        </button>
      </div>

      {selectedPlanet && (
        <div className="absolute bottom-6 left-6 z-10 bg-slate-900/90 border border-slate-700/70 rounded-2xl px-4 py-3 max-w-xs backdrop-blur">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">行星信息</span>
            <button
              onClick={() => setSelectedPlanet(null)}
              className="text-slate-500 hover:text-slate-200 text-xs"
            >
              关闭
            </button>
          </div>
          <div className="text-sm font-semibold text-slate-100">{selectedPlanet.name}</div>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            {selectedPlanet.description}
          </p>
        </div>
      )}
    </div>
  );
};
return SolarSystem;
`
};

export const BLANK_ARTIFACT: ScienceArtifact = {
  id: '', 
  createdAt: 0,
  title: "新建作品",
  description: "呈现你的想象",
  code: `
const EmptyProject = () => {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center text-slate-500 p-8 text-center bg-slate-950">
      <div className="w-20 h-20 bg-slate-900 rounded-full flex items-center justify-center mb-6 animate-pulse">
        <Lucide.PenTool size={32} className="text-slate-700" />
      </div>
      <h3 className="text-xl text-slate-200 font-semibold mb-2">准备开始创作</h3>
      <p className="max-w-md text-slate-400 mb-8">
        描述你想要构建的科学概念、仿真场景或数据可视化。
      </p>
      
      <div className="grid grid-cols-2 gap-4 max-w-lg w-full">
         <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 text-left">
            <div className="text-brand-500 mb-2"><Lucide.Activity size={20} /></div>
            <div className="text-sm font-medium text-slate-300">物理实验</div>
            <div className="text-xs text-slate-500">模拟与力学系统</div>
         </div>
         <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 text-left">
            <div className="text-emerald-500 mb-2"><Lucide.BarChart3 size={20} /></div>
            <div className="text-sm font-medium text-slate-300">数据可视化</div>
            <div className="text-xs text-slate-500">交互式图表与分析</div>
         </div>
      </div>
    </div>
  );
};
return EmptyProject;
`
};

export const ADDITIONAL_WORKS: ScienceArtifact[] = [
  {
    id: 'law-of-universal-gravitation',
    createdAt: Date.now(),
    title: "万有引力原理 (Law of Universal Gravitation)",
    description: "可视化两体之间的引力交互。调整质量和距离，观察引力大小的变化。",
    code: `
// --- Helper Components ---
const PlanetBody = ({ position, radius, color, emissive, label, mass, force, isLeft, onRender }) => {
  const meshRef = React.useRef();
  const arrowRef = React.useRef();
  const glowRef = React.useRef();

  R3F.useFrame((state) => {
    const time = state.clock.getElapsedTime();
    if (meshRef.current) {
      meshRef.current.rotation.y = time * 0.5;
    }
    if (glowRef.current) {
        glowRef.current.scale.setScalar(1.2 + Math.sin(time * 2) * 0.05);
    }
    if (arrowRef.current) {
        // Pulse arrow scale based on force
        const pulse = 1 + Math.sin(time * 5) * 0.05;
        arrowRef.current.scale.set(pulse, 1, pulse);
    }
  });

  return (
    <group position={position}>
       <mesh ref={meshRef}>
          <sphereGeometry args={[radius, 64, 64]} />
          <meshStandardMaterial 
            color={color} 
            emissive={emissive} 
            emissiveIntensity={0.8} 
            roughness={0.2}
            metalness={0.8}
          />
       </mesh>
       {/* Glow */}
       <mesh ref={glowRef} scale={[1.2, 1.2, 1.2]}>
          <sphereGeometry args={[radius, 32, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.15} side={THREE.BackSide} />
       </mesh>
       <Drei.Html position={[0, radius + 0.5, 0]} center>
          <div className="flex flex-col items-center">
            <span className={\`font-bold text-xs bg-slate-900/80 px-2 py-0.5 rounded border \${isLeft ? 'text-blue-200 border-blue-500/30' : 'text-red-200 border-red-500/30'}\`}>{label}</span>
            <span className={\`text-[10px] \${isLeft ? 'text-blue-300/80' : 'text-red-300/80'}\`}>{mass}kg</span>
          </div>
       </Drei.Html>
       {/* Force Arrow */}
       <group rotation={[0, 0, isLeft ? -Math.PI/2 : Math.PI/2]} ref={arrowRef}>
          <mesh position={[0, radius + 0.5 + force/20, 0]}>
             <cylinderGeometry args={[0.05, 0.05, 1 + force/10, 8]} />
             <meshBasicMaterial color="#fbbf24" />
          </mesh>
          <mesh position={[0, radius + 0.5 + force/10 + 0.5 + 0.2, 0]}>
             <coneGeometry args={[0.15, 0.4, 16]} />
             <meshBasicMaterial color="#fbbf24" />
          </mesh>
       </group>
    </group>
  );
};

const GravityDemo = () => {
  const [m1, setM1] = React.useState(10);
  const [m2, setM2] = React.useState(5);
  const [dist, setDist] = React.useState(6);
  
  // F = G * m1 * m2 / r^2
  // We use a scaled G for visual purposes
  const G = 10; 
  const force = (G * m1 * m2) / (dist * dist);
  
  // Calculate radii based on mass
  const r1 = Math.pow(m1, 1/3) * 0.6;
  const r2 = Math.pow(m2, 1/3) * 0.6;

  return (
    <div className="w-full h-full relative bg-slate-950 overflow-hidden">
      <R3F.Canvas camera={{ position: [0, 5, 12], fov: 40 }}>
        <color attach="background" args={['#0f172a']} />
        <Drei.OrbitControls enablePan={false} />
        <Drei.Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
        
        <Drei.Environment preset="city" />
        <ambientLight intensity={0.25} />
        <pointLight position={[10, 10, 10]} intensity={1.2} />
        <pointLight position={[-10, -10, -10]} intensity={0.7} color="#4f46e5" />

        <group position={[0, 0, 0]}>
          <PlanetBody 
            position={[-dist/2, 0, 0]} 
            radius={r1} 
            color="#3b82f6" 
            emissive="#1d4ed8" 
            label="M1" 
            mass={m1} 
            force={force} 
            isLeft={true} 
          />

          <PlanetBody 
            position={[dist/2, 0, 0]} 
            radius={r2} 
            color="#ef4444" 
            emissive="#b91c1c" 
            label="M2" 
            mass={m2} 
            force={force} 
            isLeft={false} 
          />

          {/* Distance Indicator */}
          <Drei.Line 
            points={[[-dist/2, 0, 0], [dist/2, 0, 0]]} 
            color="#64748b" 
            lineWidth={1} 
            dashed 
            dashScale={2} 
            dashSize={0.5} 
            gapSize={0.5} 
          />
          <Drei.Html position={[0, 0, 0]} center>
             <div className="px-3 py-1.5 bg-slate-900/90 rounded-full border border-slate-700 text-slate-200 text-xs font-mono shadow-xl backdrop-blur-md">
                d = {dist}m
             </div>
          </Drei.Html>
          
          {/* Formula Display in 3D Space */}
          <Drei.Html position={[0, -2.5, 0]} center>
             <div className="flex flex-col items-center gap-1 animate-in fade-in zoom-in duration-500">
               <div className="text-amber-400 font-bold text-xl drop-shadow-[0_2px_10px_rgba(251,191,36,0.5)]">
                 F = {force.toFixed(2)} N
               </div>
               <div className="text-slate-500 text-[10px] font-mono">
                 G·m1·m2 / r²
               </div>
             </div>
          </Drei.Html>
        </group>

        <Drei.ContactShadows
          position={[0, -3, 0]}
          opacity={0.4}
          scale={20}
          blur={2.5}
          far={20}
        />
        <Drei.Grid infiniteGrid sectionColor="#1e293b" cellColor="#0f172a" fadeDistance={30} />
      </R3F.Canvas>

      {/* Control Panel */}
      <div className="absolute bottom-6 left-6 w-80 p-5 bg-slate-950/80 border border-slate-800/50 rounded-2xl backdrop-blur-xl shadow-2xl">
        <div className="flex items-center gap-2 mb-4 text-slate-100 font-semibold border-b border-slate-800 pb-3">
          <Lucide.Settings2 size={18} className="text-brand-500" />
          <span>实验参数</span>
        </div>
        
        <div className="space-y-5">
           <div className="space-y-2">
             <div className="flex justify-between text-xs">
               <span className="text-blue-400 font-medium">物体 1 质量 (M1)</span>
               <span className="text-slate-300 font-mono">{m1} kg</span>
             </div>
             <input 
               type="range" min="1" max="50" step="1" 
               value={m1} onChange={e => setM1(Number(e.target.value))} 
               className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" 
             />
           </div>

           <div className="space-y-2">
             <div className="flex justify-between text-xs">
               <span className="text-red-400 font-medium">物体 2 质量 (M2)</span>
               <span className="text-slate-300 font-mono">{m2} kg</span>
             </div>
             <input 
               type="range" min="1" max="50" step="1" 
               value={m2} onChange={e => setM2(Number(e.target.value))} 
               className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-red-500" 
             />
           </div>

           <div className="space-y-2">
             <div className="flex justify-between text-xs">
               <span className="text-slate-400 font-medium">距离 (r)</span>
               <span className="text-slate-300 font-mono">{dist} m</span>
             </div>
             <input 
               type="range" min="3" max="15" step="0.5" 
               value={dist} onChange={e => setDist(Number(e.target.value))} 
               className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-slate-500" 
             />
           </div>
        </div>
      </div>
    </div>
  );
};
return GravityDemo;
`
  },
  {
    id: 'decision-tree-viz',
    createdAt: Date.now(),
    title: "决策树算法可视化 (Decision Tree)",
    description: "交互式决策路径演示。选择不同的天气条件，观察决策树的推理过程。",
    code: `
const DecisionTree = () => {
  const [conditions, setConditions] = React.useState({
    outlook: null, // 'sunny', 'overcast', 'rainy'
    humidity: null, // 'high', 'normal'
    wind: null     // 'strong', 'weak'
  });
  
  const [activePath, setActivePath] = React.useState([]);

  // Tree Definition
  const tree = {
    id: 'root',
    label: '天气 (Outlook)?',
    options: [
      { 
        val: 'sunny', 
        label: '晴朗', 
        next: {
           id: 'humidity',
           label: '湿度 (Humidity)?',
           options: [
             { val: 'high', label: '高 (>75)', next: { id: 'no-1', label: '不玩 (No)', isLeaf: true, result: false } },
             { val: 'normal', label: '正常', next: { id: 'yes-1', label: '玩 (Yes)', isLeaf: true, result: true } }
           ]
        }
      },
      { 
        val: 'overcast', 
        label: '阴天', 
        next: { id: 'yes-2', label: '玩 (Yes)', isLeaf: true, result: true }
      },
      { 
        val: 'rainy', 
        label: '下雨', 
        next: {
           id: 'wind',
           label: '风力 (Wind)?',
           options: [
             { val: 'strong', label: '强风', next: { id: 'no-2', label: '不玩 (No)', isLeaf: true, result: false } },
             { val: 'weak', label: '微风', next: { id: 'yes-3', label: '玩 (Yes)', isLeaf: true, result: true } }
           ]
        }
      }
    ]
  };

  const checkPath = (node, currentConditions) => {
    let pathIds = [node.id];
    if (node.id === 'root' && currentConditions.outlook) {
       const opt = node.options.find(o => o.val === currentConditions.outlook);
       if (opt) {
         pathIds.push(currentConditions.outlook);
         if (opt.next) pathIds = [...pathIds, ...checkPath(opt.next, currentConditions)];
       }
    } else if (node.id === 'humidity' && currentConditions.humidity) {
       const opt = node.options.find(o => o.val === currentConditions.humidity);
       if (opt) {
         pathIds.push(currentConditions.humidity);
         if (opt.next) pathIds = [...pathIds, ...checkPath(opt.next, currentConditions)];
       }
    } else if (node.id === 'wind' && currentConditions.wind) {
       const opt = node.options.find(o => o.val === currentConditions.wind);
       if (opt) {
         pathIds.push(currentConditions.wind);
         if (opt.next) pathIds = [...pathIds, ...checkPath(opt.next, currentConditions)];
       }
    } else if (node.isLeaf) {
       pathIds.push(node.id);
    }
    return pathIds;
  };

  React.useEffect(() => {
    setActivePath(checkPath(tree, conditions));
  }, [conditions]);

  const reset = () => setConditions({ outlook: null, humidity: null, wind: null });

  const Node = ({ data, x, y, level }) => {
    const isActive = activePath.includes(data.id);
    const isLeaf = data.isLeaf;
    return (
      <Motion.motion.div 
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: level * 0.2 }}
        className={\`absolute flex flex-col items-center justify-center w-32 h-16 rounded-xl border-2 shadow-lg transition-all duration-500 \${
          isActive 
            ? isLeaf 
              ? data.result ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-emerald-500/20' : 'bg-red-500/20 border-red-500 text-red-300 shadow-red-500/20'
              : 'bg-blue-500/20 border-blue-500 text-blue-200 shadow-blue-500/20'
            : 'bg-slate-800 border-slate-700 text-slate-400'
        }\`}
        style={{ left: x, top: y, marginLeft: -64 }}
      >
         <span className="text-xs font-bold">{data.label}</span>
         {isLeaf && (
            <div className="mt-1">
               {data.result ? <Lucide.CheckCircle size={16} /> : <Lucide.XCircle size={16} />}
            </div>
         )}
      </Motion.motion.div>
    );
  };

  const Edge = ({ x1, y1, x2, y2, label, active }) => {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    return (
      <React.Fragment>
        <svg className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-visible">
           <Motion.motion.path
             d={\`M \${x1} \${y1 + 32} C \${x1} \${y1 + 80}, \${x2} \${y2 - 50}, \${x2} \${y2}\`}
             fill="none"
             stroke={active ? '#60a5fa' : '#334155'}
             strokeWidth={active ? 3 : 1}
             strokeDasharray={active ? "0" : "4 4"}
             initial={{ pathLength: 0 }}
             animate={{ pathLength: 1 }}
             transition={{ duration: 0.5 }}
           />
        </svg>
        <div 
          className={\`absolute text-[10px] px-2 py-0.5 rounded-full border \${
             active ? 'bg-blue-900 border-blue-500 text-blue-300' : 'bg-slate-900 border-slate-700 text-slate-500'
          }\`}
          style={{ left: midX - 20, top: midY - 10 }}
        >
          {label}
        </div>
      </React.Fragment>
    );
  };

  return (
    <div className="w-full h-full bg-slate-950 flex flex-col items-center relative overflow-hidden font-sans">
      <div className="w-full p-6 border-b border-slate-800 flex justify-between items-center z-10 bg-slate-950/80 backdrop-blur">
         <div>
           <h2 className="text-xl font-bold text-white flex items-center gap-2">
             <Lucide.GitFork size={20} className="text-brand-500"/>
             是否去打网球?
           </h2>
           <p className="text-slate-400 text-sm mt-1">经典机器学习决策树示例 (ID3算法)</p>
         </div>
         <button 
           onClick={reset}
           className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition-colors border border-slate-700 flex items-center gap-2"
         >
           <Lucide.RotateCcw size={14} /> 重置条件
         </button>
      </div>
      <div className="flex-1 w-full relative overflow-auto">
         <div className="w-[800px] h-[600px] mx-auto relative mt-10">
            <Node data={tree} x={400} y={20} level={0} />
            <Edge x1={400} y1={20} x2={200} y2={180} label="晴朗" active={activePath.includes('sunny')} />
            <Edge x1={400} y1={20} x2={400} y2={180} label="阴天" active={activePath.includes('overcast')} />
            <Edge x1={400} y1={20} x2={600} y2={180} label="下雨" active={activePath.includes('rainy')} />
            <div className={conditions.outlook === 'sunny' || !conditions.outlook ? 'opacity-100' : 'opacity-30 blur-sm transition-all'}>
               <Node data={tree.options[0].next} x={200} y={180} level={1} />
               <Edge x1={200} y1={180} x2={100} y2={340} label="高" active={activePath.includes('high')} />
               <Edge x1={200} y1={180} x2={300} y2={340} label="正常" active={activePath.includes('normal')} />
            </div>
            <div className={conditions.outlook === 'overcast' || !conditions.outlook ? 'opacity-100' : 'opacity-30 blur-sm transition-all'}>
               <Node data={tree.options[1].next} x={400} y={180} level={1} />
            </div>
            <div className={conditions.outlook === 'rainy' || !conditions.outlook ? 'opacity-100' : 'opacity-30 blur-sm transition-all'}>
               <Node data={tree.options[2].next} x={600} y={180} level={1} />
               <Edge x1={600} y1={20} x2={500} y2={340} label="强风" active={activePath.includes('strong')} />
               <Edge x1={600} y1={20} x2={700} y2={340} label="微风" active={activePath.includes('weak')} />
            </div>
            <div className={conditions.humidity ? 'opacity-100' : 'opacity-30 blur-sm'}>
               <Node data={tree.options[0].next.options[0].next} x={100} y={340} level={2} />
               <Node data={tree.options[0].next.options[1].next} x={300} y={340} level={2} />
            </div>
            <div className={conditions.wind ? 'opacity-100' : 'opacity-30 blur-sm'}>
               <Node data={tree.options[2].next.options[0].next} x={500} y={340} level={2} />
               <Node data={tree.options[2].next.options[1].next} x={700} y={340} level={2} />
            </div>
         </div>
      </div>
      <div className="absolute bottom-0 w-full p-6 bg-slate-900/90 border-t border-slate-800 flex justify-center gap-8 backdrop-blur-lg">
         <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">天气 (Outlook)</label>
            <div className="flex gap-2">
               {['sunny', 'overcast', 'rainy'].map(val => (
                 <button
                   key={val}
                   onClick={() => setConditions({ ...conditions, outlook: val, humidity: null, wind: null })}
                   className={\`px-3 py-1.5 rounded text-sm transition-all border \${
                     conditions.outlook === val 
                       ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)]' 
                       : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                   }\`}
                 >
                   {val === 'sunny' ? '☀️ 晴朗' : val === 'overcast' ? '☁️ 阴天' : '🌧️ 下雨'}
                 </button>
               ))}
            </div>
         </div>
         {conditions.outlook === 'sunny' && (
           <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2">
              <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">湿度 (Humidity)</label>
              <div className="flex gap-2">
                 {['high', 'normal'].map(val => (
                   <button
                     key={val}
                     onClick={() => setConditions(prev => ({ ...prev, humidity: val }))}
                     className={\`px-3 py-1.5 rounded text-sm transition-all border \${
                       conditions.humidity === val 
                         ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)]' 
                         : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                     }\`}
                   >
                     {val === 'high' ? '💧 高' : '✨ 正常'}
                   </button>
                 ))}
              </div>
           </div>
         )}
         {conditions.outlook === 'rainy' && (
           <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2">
              <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">风力 (Wind)</label>
              <div className="flex gap-2">
                 {['strong', 'weak'].map(val => (
                   <button
                     key={val}
                     onClick={() => setConditions(prev => ({ ...prev, wind: val }))}
                     className={\`px-3 py-1.5 rounded text-sm transition-all border \${
                       conditions.wind === val 
                         ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)]' 
                         : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                     }\`}
                   >
                     {val === 'strong' ? '💨 强风' : '🍃 微风'}
                   </button>
                 ))}
              </div>
           </div>
         )}
      </div>
    </div>
  );
};
return DecisionTree;
`
  },
  {
    id: 'double-slit-experiment',
    createdAt: Date.now(),
    title: "双缝干涉实验可视化 (Double Slit)",
    description: "模拟光波通过双缝时的干涉图样。探索波的叠加原理。",
    code: `
// --- Helper Components ---
// Shader definition moved outside
const WaveShaderMaterial = {
  uniforms: {
    time: { value: 0 },
    slitDist: { value: 2.0 },
    wavelength: { value: 0.8 },
    color1: { value: new THREE.Color("#0ea5e9") }, // Sky 500
    color2: { value: new THREE.Color("#0f172a") }  // Slate 900
  },
  vertexShader: \`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  \`,
  fragmentShader: \`
    uniform float time;
    uniform float slitDist;
    uniform float wavelength;
    uniform vec3 color1;
    uniform vec3 color2;
    varying vec2 vUv;

    void main() {
      // Map uv to physical coords (-10 to 10)
      vec2 p = vUv * 20.0 - 10.0;
      
      // Slit positions (at y=0, x +/- slitDist/2)
      vec2 s1 = vec2(-5.0, slitDist/2.0);
      vec2 s2 = vec2(-5.0, -slitDist/2.0);
      
      float d1 = length(p - s1);
      float d2 = length(p - s2);
      
      // Wave function: A * sin(k*r - w*t)
      // k = 2pi/lambda
      float k = 6.28 / wavelength;
      
      // Mask for behind the slits (x < -5)
      float mask = smoothstep(-5.1, -5.0, p.x);
      
      float w1 = sin(k * d1 - time * 5.0);
      float w2 = sin(k * d2 - time * 5.0);
      
      // Superposition
      float amp = (w1 + w2) * 0.5;
      
      // Intensity
      float intensity = (amp + 1.0) * 0.5; 
      
      // Visualize the waves propagating
      vec3 finalColor = mix(color2, color1, intensity * mask);
      
      // Add source markers
      float source1 = 1.0 - smoothstep(0.0, 0.2, length(p - s1));
      float source2 = 1.0 - smoothstep(0.0, 0.2, length(p - s2));
      finalColor += vec3(1.0) * (source1 + source2);
      
      // Draw the wall
      float wall = 1.0 - smoothstep(0.05, 0.06, abs(p.x + 5.0));
      // Cut holes
      float holes = (1.0 - smoothstep(0.0, 0.4, abs(p.y - slitDist/2.0))) + (1.0 - smoothstep(0.0, 0.4, abs(p.y + slitDist/2.0)));
      wall *= (1.0 - holes);
      
      finalColor += vec3(0.5) * wall;

      gl_FragColor = vec4(finalColor, 1.0);
    }
  \`
};

const WavePlane = ({ slitDist, wavelength, speed }) => {
  const meshRef = React.useRef();
  
  R3F.useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.material.uniforms.time.value = state.clock.getElapsedTime() * speed;
      meshRef.current.material.uniforms.slitDist.value = slitDist;
      meshRef.current.material.uniforms.wavelength.value = wavelength;
    }
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[20, 20, 128, 128]} />
      <shaderMaterial 
        args={[WaveShaderMaterial]} 
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

const DoubleSlit = () => {
  const [slitDist, setSlitDist] = React.useState(2.0);
  const [wavelength, setWavelength] = React.useState(0.8);
  const [speed, setSpeed] = React.useState(2.0);

  return (
    <div className="w-full h-full relative bg-slate-950">
      <R3F.Canvas camera={{ position: [0, 10, 0], fov: 45 }}>
        <color attach="background" args={['#020617']} />
        <WavePlane slitDist={slitDist} wavelength={wavelength} speed={speed} />
        <Drei.OrbitControls enableRotate={false} enableZoom={true} />
      </R3F.Canvas>

      <div className="absolute top-4 left-4 right-4 flex justify-between items-start pointer-events-none">
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700 backdrop-blur pointer-events-auto">
          <h3 className="text-white font-bold mb-2 flex items-center gap-2">
            <Lucide.Waves size={18} className="text-sky-400"/> 参数设置
          </h3>
          <div className="space-y-4 w-64">
            <div className="space-y-1">
               <div className="flex justify-between text-xs text-slate-400">
                 <span>双缝间距 (d)</span>
                 <span>{slitDist.toFixed(1)}</span>
               </div>
               <input type="range" min="1" max="6" step="0.1" value={slitDist} onChange={e => setSlitDist(Number(e.target.value))} className="w-full accent-sky-500"/>
            </div>
            <div className="space-y-1">
               <div className="flex justify-between text-xs text-slate-400">
                 <span>波长 (λ)</span>
                 <span>{wavelength.toFixed(1)}</span>
               </div>
               <input type="range" min="0.5" max="2" step="0.1" value={wavelength} onChange={e => setWavelength(Number(e.target.value))} className="w-full accent-indigo-500"/>
            </div>
             <div className="space-y-1">
               <div className="flex justify-between text-xs text-slate-400">
                 <span>波速</span>
                 <span>{speed.toFixed(1)}x</span>
               </div>
               <input type="range" min="0" max="5" step="0.5" value={speed} onChange={e => setSpeed(Number(e.target.value))} className="w-full accent-slate-500"/>
            </div>
          </div>
        </div>
        
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700 backdrop-blur pointer-events-auto max-w-xs">
          <h4 className="text-sky-400 font-bold text-sm mb-1">原理说明</h4>
          <p className="text-xs text-slate-300 leading-relaxed">
            当波源穿过两个狭缝时，会产生两个子波源。这两个子波源发出的波在空间中叠加。
            <br/><br/>
            <span className="text-white font-bold">相长干涉 (亮纹):</span> 波峰遇波峰。
            <br/>
            <span className="text-slate-500 font-bold">相消干涉 (暗纹):</span> 波峰遇波谷。
          </p>
        </div>
      </div>
    </div>
  );
};
return DoubleSlit;
`
  },
  {
    id: 'firewall-principle',
    createdAt: Date.now(),
    title: "防火墙原理 (Firewall Principle)",
    description: "可视化网络数据包过滤机制。设置规则以允许或拒绝不同类型的数据包通过。",
    code: `
const Firewall = () => {
  const [packets, setPackets] = React.useState([]);
  const [rules, setRules] = React.useState({
    blockRed: false,
    blockUDP: false,
    blockMalware: true
  });
  const [stats, setStats] = React.useState({ allowed: 0, blocked: 0 });

  // Packet Generator
  React.useEffect(() => {
    const interval = setInterval(() => {
      const id = Math.random().toString(36).substr(2, 9);
      const types = ['TCP', 'UDP', 'ICMP'];
      const colors = ['blue', 'red', 'green'];
      const isMalware = Math.random() > 0.8;
      
      const packet = {
        id,
        type: types[Math.floor(Math.random() * types.length)],
        color: colors[Math.floor(Math.random() * colors.length)],
        isMalware,
        x: -50 // Start off-screen
      };
      
      setPackets(prev => [...prev, packet]);
    }, 1500); // New packet every 1.5s
    
    return () => clearInterval(interval);
  }, []);

  // Packet Movement & Logic
  React.useEffect(() => {
    const timer = setInterval(() => {
      setPackets(prev => {
        const nextPackets = [];
        let newAllowed = 0;
        let newBlocked = 0;

        prev.forEach(p => {
          // Move packet
          const newX = p.x + 5; // speed
          
          // Firewall Check at x = 300
          if (p.x < 300 && newX >= 300) {
             let blocked = false;
             if (rules.blockRed && p.color === 'red') blocked = true;
             if (rules.blockUDP && p.type === 'UDP') blocked = true;
             if (rules.blockMalware && p.isMalware) blocked = true;
             
             if (blocked) {
               newBlocked++;
               // Don't add to nextPackets (it disappears/burns)
             } else {
               newAllowed++;
               nextPackets.push({ ...p, x: newX, status: 'allowed' });
             }
          } else if (newX > 800) {
             // Remove when off screen
          } else {
             nextPackets.push({ ...p, x: newX });
          }
        });
        
        if (newAllowed > 0 || newBlocked > 0) {
           setStats(s => ({ allowed: s.allowed + newAllowed, blocked: s.blocked + newBlocked }));
        }

        return nextPackets;
      });
    }, 50);
    
    return () => clearInterval(timer);
  }, [rules]);

  const toggleRule = (key) => {
    setRules(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="w-full h-full bg-slate-950 flex flex-col relative overflow-hidden font-sans">
       {/* Background Grid */}
       <div className="absolute inset-0 grid grid-cols-[repeat(20,1fr)] grid-rows-[repeat(10,1fr)] opacity-10 pointer-events-none">
          {Array.from({ length: 200 }).map((_, i) => (
             <div key={i} className="border-[0.5px] border-slate-700" />
          ))}
       </div>

       {/* Top Bar */}
       <div className="z-10 p-6 border-b border-slate-800 bg-slate-950/80 backdrop-blur flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Lucide.ShieldCheck size={24} className="text-emerald-500" />
              防火墙流量监控
            </h2>
            <p className="text-xs text-slate-400 mt-1">根据预设规则过滤进站网络流量</p>
          </div>
          
          <div className="flex gap-4">
             <div className="flex flex-col items-center px-4 py-2 bg-emerald-900/20 border border-emerald-500/30 rounded-lg">
                <span className="text-xs text-emerald-400 uppercase font-bold">Allowed</span>
                <span className="text-xl font-mono text-emerald-300">{stats.allowed}</span>
             </div>
             <div className="flex flex-col items-center px-4 py-2 bg-red-900/20 border border-red-500/30 rounded-lg">
                <span className="text-xs text-red-400 uppercase font-bold">Blocked</span>
                <span className="text-xl font-mono text-red-300">{stats.blocked}</span>
             </div>
          </div>
       </div>

       {/* Visualization Stage */}
       <div className="flex-1 relative flex items-center">
          
          {/* Zones */}
          <div className="absolute inset-y-0 left-0 w-[300px] bg-slate-900/30 border-r border-dashed border-slate-700 flex items-start justify-center pt-10">
             <span className="text-slate-500 font-bold tracking-widest uppercase text-sm">Internet (Untrusted)</span>
          </div>
          <div className="absolute inset-y-0 right-0 left-[300px] bg-slate-800/10 flex items-start justify-center pt-10">
             <span className="text-slate-500 font-bold tracking-widest uppercase text-sm">Intranet (Trusted)</span>
          </div>
          
          {/* The Firewall */}
          <div className="absolute left-[300px] top-20 bottom-20 w-4 -ml-2 bg-gradient-to-b from-orange-500 via-red-500 to-orange-500 shadow-[0_0_30px_rgba(239,68,68,0.5)] z-20 rounded-full flex flex-col items-center justify-center gap-2">
             <div className="w-1 h-full bg-white/20 animate-pulse" />
          </div>

          {/* Packets */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <React.Fragment>
              {packets.map(p => (
                <div 
                  key={p.id}
                  className="absolute top-1/2 flex flex-col items-center justify-center transition-transform"
                  style={{ 
                    left: p.x, 
                    marginTop: (parseInt(p.id, 36) % 200) - 100, // Random Y offset
                    transform: \`scale(\${p.isMalware ? 1.2 : 1})\`
                  }}
                >
                   <div className={\`w-10 h-10 rounded-lg flex items-center justify-center shadow-lg border-2 \${
                     p.color === 'red' ? 'bg-red-900/80 border-red-500 text-red-200' :
                     p.color === 'blue' ? 'bg-blue-900/80 border-blue-500 text-blue-200' :
                     'bg-emerald-900/80 border-emerald-500 text-emerald-200'
                   }\`}>
                     {p.isMalware ? <Lucide.Skull size={20} /> : <Lucide.Box size={20} />}
                   </div>
                   <span className="text-[10px] font-mono mt-1 text-slate-400 bg-slate-950 px-1 rounded opacity-80">{p.type}</span>
                </div>
              ))}
            </React.Fragment>
          </div>

       </div>

       {/* Controls */}
       <div className="p-6 bg-slate-900 border-t border-slate-800 z-30">
          <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
             <Lucide.Sliders size={16} /> 安全规则配置
          </h3>
          <div className="flex gap-6">
             <label className="flex items-center gap-3 cursor-pointer group">
                <div className={\`w-10 h-6 rounded-full p-1 transition-colors \${rules.blockRed ? 'bg-red-500' : 'bg-slate-700'}\`}>
                   <div className={\`w-4 h-4 rounded-full bg-white shadow-sm transition-transform \${rules.blockRed ? 'translate-x-4' : ''}\`} />
                </div>
                <input type="checkbox" checked={rules.blockRed} onChange={() => toggleRule('blockRed')} className="hidden" />
                <span className="text-sm text-slate-400 group-hover:text-slate-200 transition-colors">拦截红色数据包</span>
             </label>

             <label className="flex items-center gap-3 cursor-pointer group">
                <div className={\`w-10 h-6 rounded-full p-1 transition-colors \${rules.blockUDP ? 'bg-blue-500' : 'bg-slate-700'}\`}>
                   <div className={\`w-4 h-4 rounded-full bg-white shadow-sm transition-transform \${rules.blockUDP ? 'translate-x-4' : ''}\`} />
                </div>
                <input type="checkbox" checked={rules.blockUDP} onChange={() => toggleRule('blockUDP')} className="hidden" />
                <span className="text-sm text-slate-400 group-hover:text-slate-200 transition-colors">拦截 UDP 协议</span>
             </label>

             <label className="flex items-center gap-3 cursor-pointer group">
                <div className={\`w-10 h-6 rounded-full p-1 transition-colors \${rules.blockMalware ? 'bg-purple-500' : 'bg-slate-700'}\`}>
                   <div className={\`w-4 h-4 rounded-full bg-white shadow-sm transition-transform \${rules.blockMalware ? 'translate-x-4' : ''}\`} />
                </div>
                <input type="checkbox" checked={rules.blockMalware} onChange={() => toggleRule('blockMalware')} className="hidden" />
                <span className="text-sm text-slate-400 group-hover:text-slate-200 transition-colors">拦截恶意软件 (Malware)</span>
             </label>
          </div>
       </div>
    </div>
  );
};
return Firewall;
`
  },
  {
    id: 'logistic-growth-visualization',
    createdAt: Date.now(),
    title: "逻辑斯蒂增长曲线 (Logistic Growth)",
    description: "经典 S 型人口增长模型。通过滑块调节参数，观察曲线如何变化。",
    code: `
const ParameterSlider = ({ label, value, min, max, step, onChange, unit }) => {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span className="font-mono text-slate-200">
          {value.toFixed(2)}{unit ? ' ' + unit : ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-brand-500 cursor-pointer"
      />
    </div>
  );
};

const LogisticGrowthChart = () => {
  const [r, setR] = React.useState(0.8);
  const [k, setK] = React.useState(100);
  const [p0, setP0] = React.useState(5);
  const [tMax, setTMax] = React.useState(30);

  const data = React.useMemo(() => {
    const points = [];
    for (let t = 0; t <= tMax; t += 0.5) {
      const exponent = -r * t;
      const factor = (k - p0) / p0;
      const denom = 1 + factor * Math.exp(exponent);
      const p = k / denom;
      points.push({ t, p });
    }
    return points;
  }, [r, k, p0, tMax]);

  return (
    <div className="w-full h-full flex flex-col bg-slate-950">
      <div className="px-6 pt-5 pb-3 border-b border-slate-800 flex justify-between items-center">
        <div>
          <div className="text-sm font-semibold text-slate-100">
            逻辑斯蒂人口增长模型
          </div>
          <div className="text-xs text-slate-400 mt-1">
            调整增长率、环境容量和初始人口，观察曲线变化。
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col md:flex-row">
        <div className="flex-1 min-h-[260px] p-4">
          <Recharts.ResponsiveContainer width="100%" height="100%">
            <Recharts.LineChart data={data}>
              <Recharts.CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <Recharts.XAxis
                dataKey="t"
                stroke="#94a3b8"
                tick={{ fontSize: 12 }}
                label={{ value: "时间 t", position: "insideBottomRight", offset: -5, fill: "#94a3b8", fontSize: 10 }}
              />
              <Recharts.YAxis
                stroke="#94a3b8"
                tick={{ fontSize: 12 }}
                label={{ value: "人口规模 P", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }}
              />
              <Recharts.Tooltip
                contentStyle={{ backgroundColor: "#020617", borderColor: "#334155", color: "#e5e7eb" }}
                itemStyle={{ color: "#a5b4fc" }}
                formatter={(value, name) => [
                  typeof value === "number" ? value.toFixed(2) : value,
                  name === "p" ? "P(t)" : name
                ]}
                labelFormatter={(label) =>
                  typeof label === "number" ? "t = " + label.toFixed(1) : label
                }
              />
              <Recharts.Line
                type="monotone"
                dataKey="p"
                stroke="#a3e635"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, fill: "#e5e7eb" }}
              />
            </Recharts.LineChart>
          </Recharts.ResponsiveContainer>
        </div>
        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-800 p-4 flex flex-col gap-4 bg-slate-950/80">
          <div className="text-xs font-mono text-slate-500">
            P(t) = K / [1 + ((K - P₀) / P₀) · e^(−rt)]
          </div>
          <ParameterSlider
            label="增长率 r"
            value={r}
            min={0.1}
            max={1.5}
            step={0.05}
            onChange={setR}
            unit="1/时间"
          />
          <ParameterSlider
            label="环境容量 K"
            value={k}
            min={20}
            max={200}
            step={5}
            onChange={setK}
          />
          <ParameterSlider
            label="初始人口 P₀"
            value={p0}
            min={1}
            max={50}
            step={1}
            onChange={setP0}
          />
          <ParameterSlider
            label="观察时间范围 t_max"
            value={tMax}
            min={10}
            max={80}
            step={2}
            onChange={setTMax}
          />
        </div>
      </div>
    </div>
  );
};
return LogisticGrowthChart;
`
  }
];
