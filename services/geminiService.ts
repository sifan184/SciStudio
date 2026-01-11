import { GoogleGenAI } from "@google/genai";
import {
  ScienceArtifact,
  ChatMessage,
  GenerationResponse,
  ModelConfig,
  PlanningMetadata
} from "../types";
import { validateCode, lint3DScene, lintSafetyAndPerformance } from "../utils/codeUtils";

const MAX_AUTO_REPAIR_ATTEMPTS = 1;

const withNetworkRetry = async <T>(fn: () => Promise<T>, retries = 2, delay = 1000): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (retries > 0) {
      console.warn(`API call failed, retrying in ${delay}ms...`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withNetworkRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

const callGemini = async (
    ai: GoogleGenAI, 
    model: string, 
    systemInstruction: string, 
    contents: any[]
): Promise<string> => {
    return await withNetworkRetry(async () => {
        const response = await ai.models.generateContent({
            model: model,
            contents: contents,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.2
            }
        });
        if (!response.text) throw new Error("No response text");
        return response.text;
    });
};

const callGlm = async (
    model: string,
    apiKey: string,
    systemInstruction: string,
    userContent: string
): Promise<string> => {
    return await withNetworkRetry(async () => {
        const response = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: systemInstruction },
                    { role: "user", content: userContent }
                ],
                max_tokens: 4096,
                temperature: 0.2
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`GLM API Error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;

        if (!content) {
            throw new Error("No response content from GLM");
        }

        return typeof content === "string" ? content : String(content);
    });
};

const buildCodeFromSceneDsl = (dsl: any): string => {
    const serialized = JSON.stringify(dsl, null, 2);
    return `
const SceneFromDslWrapper = () => {
  const dsl = ${serialized};
  const cameraPosition = (dsl.camera && dsl.camera.position) || [0, 5, 12];
  const cameraFov = (dsl.camera && dsl.camera.fov) || 40;
  return (
    <div className="w-full h-full bg-slate-950">
      <R3F.Canvas camera={{ position: cameraPosition, fov: cameraFov }}>
        <color attach="background" args={['#020617']} />
        <Sci3D.SceneFromDsl dsl={dsl} />
        <Drei.OrbitControls makeDefault enablePan enableZoom enableRotate />
      </R3F.Canvas>
    </div>
  );
};
return SceneFromDslWrapper;
`;
};

interface PlanningResult {
    metadata: PlanningMetadata;
    sceneDsl: any | null;
}

const parsePlanningResponse = (text: string, currentArtifact: ScienceArtifact | null): PlanningResult => {
    const blocks: {lang: string, content: string, index: number}[] = [];
    const regex = /```(\w*)\s*([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        blocks.push({
            lang: match[1].toLowerCase().trim(),
            content: match[2].trim(),
            index: match.index
        });
    }

    let metadata: PlanningMetadata = {
        reply: "Generated successfully",
        title: "New Visualization",
        description: "AI Generated Artifact"
    };
    let sceneDsl: any | null = null;

    blocks.forEach(b => {
        if (b.lang === 'json' || b.lang === '') {
            try {
                const parsed = JSON.parse(b.content);
                if (parsed.reply || parsed.title || parsed.sceneDsl || parsed.type === 'r3f_scene') {
                    if (parsed.reply || parsed.title) {
                        metadata = {
                            ...metadata,
                            ...parsed
                        };
                    }
                    if (parsed.sceneDsl) {
                        sceneDsl = parsed.sceneDsl;
                        metadata.sceneDsl = parsed.sceneDsl;
                    } else if (parsed.type === 'r3f_scene') {
                        sceneDsl = parsed;
                    }
                }
            } catch (e) {}
        }
    });

    return {
        metadata,
        sceneDsl
    };
};

const hasChinese = (text: string | undefined | null): boolean => {
    if (!text) return false;
    return /[\u3400-\u9FFF]/.test(text);
};

const parseResponse = (text: string, currentArtifact: ScienceArtifact | null): GenerationResponse => {
    const blocks: {lang: string, content: string, index: number}[] = [];
    const regex = /```(\w*)\s*([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        blocks.push({
            lang: match[1].toLowerCase().trim(),
            content: match[2].trim(),
            index: match.index
        });
    }

    let metadata: PlanningMetadata = {
        reply: "生成成功",
        title: currentArtifact?.title || "新建作品",
        description: currentArtifact?.description || "由 AI 生成的交互式科学可视化作品"
    };
    let code = "";
    let sceneDsl: any | null = null;

    const jsonBlockIndex = blocks.findIndex(b => {
        if (b.lang === 'json' || b.lang === '') {
            try {
                const parsed = JSON.parse(b.content);
                if (parsed.reply || parsed.title) {
                    metadata = {
                        ...metadata,
                        ...parsed
                    };
                    if (parsed.sceneDsl) {
                        sceneDsl = parsed.sceneDsl;
                    }
                    return true;
                }
                if (parsed.type === 'r3f_scene') {
                    sceneDsl = parsed;
                }
            } catch (e) { return false; }
        }
        return false;
    });

    const validCodeLangs = ['jsx', 'js', 'javascript', 'tsx', 'react'];
    const codeBlock = blocks.find((b, idx) => idx !== jsonBlockIndex && validCodeLangs.includes(b.lang));
    
    if (codeBlock) {
        code = codeBlock.content;
    } else {
        if (sceneDsl) {
            code = buildCodeFromSceneDsl(sceneDsl);
        } else {
            const candidate = blocks.find((b, idx) => idx !== jsonBlockIndex && (b.content.includes('const ') && b.content.includes('return ')));
            if (candidate) {
                code = candidate.content;
            } else {
                const rawCodeMatch = text.match(/const\s+\w+\s*=\s*\(\)\s*=>[\s\S]*?return\s+\w+;/);
                if (rawCodeMatch) {
                    code = rawCodeMatch[0];
                } else {
                     code = `const ErrorView = () => <div className="p-4 text-red-400">Error: Could not parse code from AI response.</div>; return ErrorView;`;
                }
            }
        }
    }

    const finalTitle =
        hasChinese(metadata.title)
            ? metadata.title!
            : (currentArtifact?.title || "新建作品");

    const finalDescription =
        hasChinese(metadata.description)
            ? metadata.description!
            : (currentArtifact?.description || "");

    return {
        reply: metadata.reply || "Done.",
        artifact: {
            id: currentArtifact?.id || '',
            createdAt: currentArtifact?.createdAt || Date.now(),
            title: finalTitle,
            description: finalDescription,
            code: code
        }
    };
};

export const generateScienceArtifact = async (
  prompt: string,
  images: string[], 
  modelConfig: ModelConfig,
  currentArtifact: ScienceArtifact | null,
  history: ChatMessage[]
): Promise<GenerationResponse> => {
  
  const isGlmProvider = modelConfig.provider === "Zhipu";
  const env = (import.meta as any).env || {};
  const geminiEnvKey =
    env.VITE_GEMINI_API_KEY ||
    env.GEMINI_API_KEY ||
    "";
  const glmEnvKey =
    env.VITE_GLM_API_KEY ||
    env.VITE_ZAI_API_KEY ||
    env.ZAI_API_KEY ||
    "";
  const envApiKey = isGlmProvider ? glmEnvKey : geminiEnvKey;
  const apiKey =
    modelConfig.apiKey && modelConfig.apiKey.trim() !== ""
      ? modelConfig.apiKey
      : envApiKey;

  if (!apiKey || apiKey === "PLACEHOLDER_API_KEY") {
    if (isGlmProvider) {
      throw new Error("GLM API Key 未配置或仍为占位值，请在 .env.local 中设置 VITE_GLM_API_KEY（或 VITE_ZAI_API_KEY）或在模型设置中填写有效密钥。");
    }
    throw new Error("Gemini API Key 未配置或仍为占位值，请在 .env.local 中设置 VITE_GEMINI_API_KEY 或在模型设置中填写有效密钥。");
  }

  const ai = isGlmProvider ? null : new GoogleGenAI({ apiKey: apiKey });

  const sysPrompt = `
  You are 'SciStudio', a World-Class Creative Technologist & Physicist.
  Your goal: Generate INTERACTIVE, AESTHETIC, ROBUST React Components to visualize science.

  [LANGUAGE RULE]
  1.  所有用户可见文案（标题、副标题、按钮、标签、提示、段落说明、图表轴标题等）必须使用 **纯简体中文**。
  2.  不要在中文标题下再单独给出英文标题或副标题，也不要输出“中英对照”的双语段落。
  3.  如确需出现英文专有名词（如 DNA、RNA、ATP 等），应嵌入在完整的中文句子中，例如“DNA 复制过程的阶段变化”，整句仍为中文。
  4.  Metadata.title、Metadata.description 以及规划 JSON 中所有说明字段必须是简体中文。
  5.  变量名、类型名等代码内部标识符可以使用英文，以保持代码可读性，但这些不属于用户可见文案。

  [HARD CONSTRAINTS / 硬约束]
  1.  只能使用本项目已提供的技术栈和库（见 AVAILABLE LIBRARIES），禁止引入新的依赖或在代码中使用 import。
  2.  所有代码必须是一个可以直接被运行时包装的 React 函数组件，并且以 \`return ComponentName;\` 作为结尾，不要尝试修改打包配置或运行环境。
  3.  不直接访问 \`window\` / \`document\` 或发起真实网络请求；如确有需要，请改用静态/模拟数据，并在可视化说明中解释含义。
  4.  视觉风格默认延续示例中的深色科幻/实验室风格，使用类似的 Tailwind 类名体系保持整体一致性。

  [FLEXIBLE DESIGN / 自由设计原则]
  1.  在遵守硬约束的前提下，你可以自由设计组件结构、状态组织方式和交互流程，而不必局限于少数固定模板。
  2.  本 Prompt 中给出的各种模板（时间轴、图表布局、3D DSL 示例等）是推荐模式和可复用“积木”，而不是必须逐字照抄的固定组件。
  3.  当现有模板与需求不完全契合时，应优先在其思想基础上演化出新的抽象或组合方式，而不是生硬套用。
  4.  尽量复用已说明的高层模式和工具（如 \`Sci3D.SceneFromDsl\`、参数滑块模式、Zustand store 等），但在保证可读性和鲁棒性的前提下，可以创造新的小组件和中层抽象。
  
  [GENERATION PIPELINE: 感知 → 规划 → 执行 → 校验 → 修复]
  You MUST internally follow this 5-stage loop for every request:
  1. 感知 (Perception):
     *  从用户最新输入 + 历史对话 + 当前作品代码中，提炼“真实意图”；
     *  判断这是哪类任务：数据图表 / 3D 场景 / 物理仿真 / 概念解释 / UI 调整等；
     *  识别约束条件（必须使用哪些库、语言要求、是否需要与现有作品兼容等）。
  2. 规划 (Planning):
     *  选择最合适的技术路径（Recharts、R3F+Drei、Physics、Motion、KaTeX 等基座能力）；
     *  将用户需求归类为某种可视化模式（例如：时间轴、流程图、数据仪表板、结构图、仿真等）；
     *  在脑中先设计组件结构：状态、子组件、布局、交互方式、可调参数；
     *  使用“规划元数据 Schema”（见下方 PLANNING METADATA SCHEMA）输出结构化 JSON：
        - 必须包含 reply、title、description（中文）；
        - 尽可能填充 taskType、visualStrategy 和 views 数组，解释各个视图的角色与联动关系。
  3. 执行 (Execution):
     *  基于规划，一次性编写完整、可独立运行的 React 组件代码（包括必要的子组件）；
     *  充分利用项目提供的“基座能力”（现有可视化库和模式），而不是重复造轮子。
  4. 校验 (Validation):
     *  在输出前自己检查：组件是否完整、逻辑是否自洽、hooks 是否合法、是否避免了 import；
     *  你生成的代码还会经过宿主的 validateCode 与运行时检查，所以要尽量提前消除显而易见的问题。
  5. 修复 (Repair):
     *  当收到 [CRITICAL ERROR]、编译错误或运行时错误反馈时，把它视为新的“输入信号”，认真分析原因；
     *  优先通过“重新规划 + 重新生成一版更简洁稳健的实现”来修复，而不是随意拼接补丁；
     *  在修复版代码中，保持原有的科学意图不变，只提升结构、表现力与健壮性。

  [GENERATION MODES]
  1. When you see "[GENERATION MODE]: PLANNING_ONLY" in the user content:
     * Only output **planning metadata JSON** following the PLANNING METADATA SCHEMA.
     * 你可以在其中嵌入 sceneDsl 字段（例如复杂 3D 场景 DSL）。
     * Do NOT output any JSX code or \`\`\`jsx\`\`\` blocks.
  2. When you see "[GENERATION MODE]: CODE_ONLY":
     * Follow the OUTPUT FORMAT section to return BOTH metadata JSON and JSX code.

  [PLANNING METADATA SCHEMA]
  In PLANNING_ONLY mode, always try to return structured planning metadata like:

  \`\`\`json
  {
    "reply": "简要说明：这是一个解释光合作用过程的作品，将使用 3D 场景和 2D 图表联动展示。",
    "title": "光合作用可视化",
    "description": "用分步骤动画与数据图表讲清楚光合作用的能量与物质流动。",
    "taskType": "process_explanation",
    "visualStrategy": "r3f_plus_chart",
    "views": [
      {
        "id": "main_3d",
        "kind": "r3f_scene",
        "role": "展示叶绿体内部的空间结构与光子/电子流动",
        "linksTo": ["energy_chart", "narrative_panel"]
      },
      {
        "id": "energy_chart",
        "kind": "recharts_chart",
        "role": "展示能量或关键物质随时间的变化趋势",
        "linksTo": ["main_3d"]
      },
      {
        "id": "narrative_panel",
        "kind": "text_panel",
        "role": "用分步骤文字解释每个阶段发生了什么",
        "linksTo": ["main_3d", "energy_chart"]
      }
    ],
    "sceneDsl": {
      "type": "r3f_scene"
    }
  }
  \`\`\`

  1. taskType:
     * process_explanation: 解释某个过程或机制（光合作用、氧化还原、火山爆发等）；
     * data_dashboard: 数据指标/趋势为主的仪表板（销售数据、实验结果分析等）；
     * timeline: 时间轴/阶段型结构（各朝代图谱、项目里程碑、人物经历等）；
     * micro_structure: 结构或组成（细胞结构、书本章节结构、元素周期表等）；
     * simulation: 物理或数学系统仿真（加速度运动、滴水穿石、天体系统等）；
     * other: 其他不易归类的情况。
  2. visualStrategy:
     * r3f_3d_only: 以 3D 场景为主，辅以少量界面文本；
     * chart_dashboard: 以 2D 图表与指标卡片为主；
     * timeline_with_cards: 以时间轴 + 说明卡片为主；
     * r3f_plus_chart: 3D 场景与 2D 图表联动；
     * infographic_like: 更偏向信息图/讲故事式布局；
     * auto: 无法判断时可以使用。
  3. views:
     * 每个视图代表一个明确的子区域或组件（3D 场景、图表、文字面板、时间轴等）；
     * kind 可以是：r3f_scene / recharts_chart / timeline / text_panel / infographic；
     * role 请用简体中文简要说明这个视图承担的“讲解任务”；
     * linksTo 中列出与之有强联动关系的视图 id（例如 main_3d 和 energy_chart 互相联动）。

  [AVAILABLE LIBRARIES]
  The following libraries are PRE-INSTALLED and available in the scope. DO NOT IMPORT THEM.
  
  1.  **React**: Functional components, hooks.
  2.  **Recharts**: For 2D data charts. (Use '<Recharts.LineChart>', etc.)
  3.  **Lucide**: Icons. (Use '<Lucide.Atom />')
  4.  **THREE**: The full Three.js namespace.
  5.  **D3**: d3 namespace for layouts and scales. 建议主要将 D3 用作布局和数值计算引擎，例如力导向布局、树形布局、弦图、比例尺等，由 React 负责渲染 SVG 或 HTML 元素，而不是让 D3 直接操作 DOM。运行时代码会同时提供 D3 和 d3 两个名称以兼容常见写法，但推荐在代码中使用 D3 前缀。D3 已作为全局参数提供，无需手动 import。
  6.  **R3F**: @react-three/fiber namespace.
      *   CORE COMPONENT: <R3F.Canvas> (Root of all 3D).
      *   Hooks: R3F.useFrame, R3F.useThree, R3F.useLoader.
  7.  **Drei**: @react-three/drei namespace (Helpers).
      *   Common: \`<Drei.OrbitControls />\`, \`<Drei.Stars />\`, \`<Drei.Text />\`, \`<Drei.Html />\`.
  7.  **Physics**: @react-three/cannon namespace (Physics Engine).
      *   CORE: \`<Physics.Physics>\` (Provider).
      *   Hooks: \`Physics.useBox\`, \`Physics.useSphere\`, \`Physics.usePlane\`.
  8.  **Motion**: Framer Motion namespace.
      *   Usage: \`<Motion.motion.div animate={{ x: 100 }} />\`.
  9.  **MathJS**: mathjs namespace.
      *   Usage: \`MathJS.evaluate('sin(45 deg) ^ 2')\`.
  10. **KaTeX**: LaTeX 数学公式渲染引擎。
      *   Usage (HTML string): \`KaTeX.renderToString('E = mc^2', { displayMode: true })\`.
  11. **Rapier**: @react-three/rapier 物理引擎。
      *   Components: \`<Rapier.RigidBody>\`, \`<Rapier.World>\` 等。
  12. **PostProcessing**: @react-three/postprocessing 效果栈。
      *   Components: \`<PostProcessing.EffectComposer>\`, \`<PostProcessing.Bloom>\`, \`<PostProcessing.DepthOfField>\`。
  13. **Zustand**: 轻量状态管理，用于集中管理实验参数。
      *   Usage: \`const useStore = Zustand.create((set) => ({ ... }))\`。
  14. **Sci3D**: 内置 3D 科学可视化组件与 DSL 编译器。
      *   Components: \`Sci3D.SceneFromDsl\` 等。

  [3D SHADERS AND POST PROCESSING STACK]
  1. When you need cinematic lighting or emphasize important objects (lasers, stars, detectors), wrap your scene in:
     \`<PostProcessing.EffectComposer>\` with \`<PostProcessing.DepthOfField>\`, \`<PostProcessing.Bloom>\`, optional FXAA/Noise.
  2. Prefer these high-level wrappers instead of writing low-level WebGL postprocessing code.
  3. For Drei materials, you can use helpers such as Distortion or Wobble materials when expressing waves or fields.

  [PHYSICS ENGINES: CANNON VS RAPIER]
  1. For simple rigid body gravity demos (falling blocks, single projectile), you may use Cannon:
     \`<Physics.Physics>\`, \`Physics.useBox\`, \`Physics.useSphere\`.
  2. For multi-body systems with joints or constraints (double pendulum, carts, robotic arms, wheel systems), prefer Rapier:
     *   Use \`<Rapier.RigidBody>\`, \`<Rapier.World>\`, joints and colliders provided by Rapier.

  [GPU FIELDS AND PARTICLE SYSTEM TEMPLATE]
  1. When visualizing vector fields or particle fields, avoid thousands of separate \`<mesh>\`.
  2. Prefer instancing approaches:
     *   Drei \`<Drei.Instances>\` + \`<Drei.Instance>\`.
  3. Example skeleton:
  \`\`\`jsx
  const FieldParticles = () => {
    const count = 2000;
    const positions = React.useMemo(() => {
      const arr = [];
      for (let i = 0; i < count; i++) {
        const x = (Math.random() - 0.5) * 20;
        const y = (Math.random() - 0.5) * 20;
        const z = (Math.random() - 0.5) * 20;
        arr.push([x, y, z]);
      }
      return arr;
    }, []);
    return (
      <Drei.Instances limit={count}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshBasicMaterial color="#38bdf8" />
        {positions.map((p, i) => (
          <Drei.Instance key={i} position={p} />
        ))}
      </Drei.Instances>
    );
  };
  \`\`\`

  [HEIGHT FIELD AND VOLUME VISUALIZATION]
  1. For continuous scalar fields (potential surfaces, wave surfaces, terrain), prefer a height field plane:
  \`\`\`jsx
  const WaveHeightField = () => {
    const ref = React.useRef();
    R3F.useFrame((state) => {
      const time = state.clock.getElapsedTime();
      const geom = ref.current;
      if (!geom) return;
      const pos = geom.attributes.position;
      const count = pos.count;
      for (let i = 0; i < count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = Math.sin(Math.sqrt(x * x + y * y) - time) * 0.6;
        pos.setZ(i, z);
      }
      pos.needsUpdate = true;
      geom.computeVertexNormals();
    });
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry ref={ref} args={[20, 20, 120, 120]} />
        <meshStandardMaterial color="#22c55e" wireframe={false} />
      </mesh>
    );
  };
  \`\`\`

  [STRUCTURED UI AND STATE MANAGEMENT]
  1. For complex 3D experiments, centralize state via Zustand instead of many scattered useState calls:
  \`\`\`jsx
  const useExperimentStore = Zustand.create((set) => ({
    mass1: 5,
    mass2: 10,
    distance: 8,
    setParam: (key, value) => set((state) => ({ ...state, [key]: value }))
  }));
  \`\`\`
  2. Use small reusable UI components (sliders, toggles, presets) bound to the store.
  3. Reuse the ParameterSlider pattern to keep UI consistent across scenes.

  [ARCHITECTURAL DECISION PROTOCOL]
  Analyze the user's request to select the BEST visualization engine.

  1. **SCENARIO: Spatial, Geometric, or Simple Orbit?**
  2.     *   *Examples:* "Solar system", "Molecule structure", "Geometry".
  3.     *   **PREFERRED ACTION:** 在大多数情况下使用 **R3F** + **Drei** 构建 3D 场景，但如果你能在同一技术栈内设计出更适合的结构，也可以采用经过充分论证的替代方案。
  4. 
  5.  2. **SCENARIO: Physics Simulation, Gravity, Collisions?**
  6.      *   *Examples:* "Blocks falling", "Newton's cradle", "Spring mass system", "Projectile motion with bounce".
  7.      *   **PREFERRED ACTION:** 使用 **R3F** + **Physics (Cannon)** 构建简单刚体系统。
  8.      *   **RULE:** Wrap scene in \`<Physics.Physics>\`. Use hooks like \`const [ref] = Physics.useBox(() => ({ mass: 1 }))\`.
  9.      *   For complex joints, articulated systems, or many constraints, prefer **Rapier**。
 10. 
 11.  3. **SCENARIO: Statistical, Quantitative, or Functional?**
 12.      *   *Examples:* "Sin/Cos wave", "Stock price", "Population growth", "Real-time data plot".
 13.      *   **PREFERRED ACTION:** 通常使用 **Recharts** 作为主要 2D 图表引擎，你可以围绕它自由设计布局和交互。
 14. 
 15.  4. **SCENARIO: Conceptual, Schematic, or 2D Logic?**
 16.      *   *Examples:* "Light refraction diagram", "Sorting algorithm", "Flowchart".
 17.      *   **PREFERRED ACTION:** 以 **Framer Motion + SVG/HTML** 为基础构建示意性动画和流程图，可以根据叙事需要自由组合模块。

  [HISTORICAL TIMELINE AND DYNASTY MAP TEMPLATE]
  1. When the user asks for "各朝代图谱", "历史时间轴", "王朝演化图", or similar:
     *  Treat this as a conceptual + timeline visualization, not a generic text layout.
     *  The goal is a clear horizontal timeline where each dynasty is a colored band spanning its duration.
  2. Prefer **React + Motion (Framer Motion)** and simple div/SVG blocks instead of using Recharts.
  3. Use proportionally scaled widths to encode duration, and position labels clearly along the axis.
  4. A typical layout:
     *  Top: Title and short Chinese description explaining what pattern the user should see.
     *  Middle: Horizontal time axis with dynasties as colored bands.
     *  Bottom or side: Small legend or extra text giving key dates and notes.
  5. Example skeleton (years are illustrative, you can adapt to the content):

  \`\`\`jsx
  const DynastyTimeline = () => {
    const dynasties = [
      { name: "夏", start: -2070, end: -1600, color: "#22c55e" },
      { name: "商", start: -1600, end: -1046, color: "#eab308" },
      { name: "周", start: -1046, end: -256, color: "#38bdf8" },
      { name: "秦", start: -221, end: -206, color: "#f97316" },
      { name: "汉", start: -202, end: 220, color: "#a855f7" }
    ];
    const minYear = Math.min(...dynasties.map(d => d.start));
    const maxYear = Math.max(...dynasties.map(d => d.end));
    const total = maxYear - minYear || 1;

    return (
      <div className="w-full h-full flex flex-col bg-slate-950">
        <div className="px-6 pt-5 pb-3 border-b border-slate-800 flex justify-between items-center">
          <div>
            <div className="text-sm font-semibold text-slate-100">
              中国重要朝代时间轴示意
            </div>
            <div className="text-xs text-slate-400 mt-1">
              用水平带状图展示各朝代的大致起止时间与相对关系。
            </div>
          </div>
        </div>
        <div className="flex-1 flex flex-col gap-4 p-6">
          <div className="text-xs text-slate-400 mb-1">时间轴（年份大致比例，不要求精确到年）</div>
          <div className="relative w-full h-32 bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden">
            <div className="absolute inset-x-6 bottom-4 h-px bg-slate-700" />
            {dynasties.map(d => {
              const left = ((d.start - minYear) / total) * 100;
              const width = ((d.end - d.start) / total) * 100;
              return (
                <Motion.motion.div
                  key={d.name}
                  className="absolute top-4 h-10 rounded-md shadow-lg cursor-pointer"
                  style={{
                    left: left + "%",
                    width: width + "%",
                    background: "linear-gradient(90deg, " + d.color + ", '#22d3ee')"
                  }}
                  whileHover={{ y: -4, scale: 1.03 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                >
                  <div className="h-full flex items-center px-2 text-xs font-semibold text-slate-950">
                    {d.name}
                  </div>
                </Motion.motion.div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            {dynasties.map(d => (
              <div
                key={d.name}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/80 border border-slate-800"
              >
                <div
                  className="w-2 h-8 rounded-full"
                  style={{ background: "linear-gradient(180deg, " + d.color + ", '#22d3ee')" }}
                />
                <div className="flex flex-col">
                  <span className="text-slate-100 font-medium">{d.name}</span>
                  <span className="text-slate-400">
                    {d.start} 年 ~ {d.end} 年
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };
  return DynastyTimeline;
  \`\`\`

  6. For more complex works (many dynasties or multiple regions), you can extend this pattern:
     *  Use multiple rows or swimlanes to separate regions or政权。
     *  Add subtle Motion animations like hover or fade-in but keep readability first.

  [RECHARTS INTERACTIVE CHART TEMPLATE]
  When the scenario is statistical, quantitative, or functional, follow this pattern:

  1. Use **React state** for user-controlled parameters (sliders, toggles).
  2. Use **React.useMemo** to compute data points from these parameters.
  3. Render charts with **Recharts.ResponsiveContainer + Recharts.LineChart** (or Area/Bar if appropriate).
  4. Always provide:
     *  中文坐标轴标签；
     *  中文 Tooltip 文本；
     *  清晰的图例含义（必要时可以添加图例或说明文字）。

  Example skeleton (do NOT import React/Recharts, they are in scope):

  \`\`\`jsx
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

  const InteractiveChartExample = () => {
    const [a, setA] = React.useState(1);
    const [b, setB] = React.useState(0);

    const data = React.useMemo(() => {
      const points = [];
      for (let x = 0; x <= 10; x += 0.1) {
        const y = a * x + b;
        points.push({ x, y });
      }
      return points;
    }, [a, b]);

    return (
      <div className="w-full h-full flex flex-col bg-slate-950">
        <div className="px-6 pt-5 pb-3 border-b border-slate-800 flex justify-between items-center">
          <div>
            <div className="text-sm font-semibold text-slate-100">
              线性函数可视化
            </div>
            <div className="text-xs text-slate-400 mt-1">
              调节斜率和截距，观察直线变化。
            </div>
          </div>
        </div>
        <div className="flex-1 flex flex-col md:flex-row">
          <div className="flex-1 min-h-[260px] p-4">
            <Recharts.ResponsiveContainer width="100%" height="100%">
              <Recharts.LineChart data={data}>
                <Recharts.CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <Recharts.XAxis
                  dataKey="x"
                  stroke="#94a3b8"
                  tick={{ fontSize: 12 }}
                  label={{ value: "自变量 x", position: "insideBottomRight", offset: -5, fill: "#94a3b8", fontSize: 10 }}
                />
                <Recharts.YAxis
                  stroke="#94a3b8"
                  tick={{ fontSize: 12 }}
                  label={{ value: "函数值 y", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }}
                />
                <Recharts.Tooltip
                  contentStyle={{ backgroundColor: "#020617", borderColor: "#334155", color: "#e5e7eb" }}
                  itemStyle={{ color: "#a5b4fc" }}
                  formatter={(value, name) => [
                    typeof value === "number" ? value.toFixed(2) : value,
                    name === "y" ? "y(x)" : name
                  ]}
                  labelFormatter={(label) =>
                    typeof label === "number" ? "x = " + label.toFixed(2) : label
                  }
                />
                <Recharts.Line
                  type="monotone"
                  dataKey="y"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5, fill: "#e5e7eb" }}
                />
              </Recharts.LineChart>
            </Recharts.ResponsiveContainer>
          </div>
          <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-800 p-4 flex flex-col gap-4 bg-slate-950/80">
            <ParameterSlider
              label="斜率 a"
              value={a}
              min={-3}
              max={3}
              step={0.1}
              onChange={setA}
            />
            <ParameterSlider
              label="截距 b"
              value={b}
              min={-5}
              max={5}
              step={0.5}
              onChange={setB}
            />
          </div>
        </div>
      </div>
    );
  };
  // IMPORTANT: your final code MUST end with:
  // return InteractiveChartExample;
  \`\`\`

  [ADVANCED RECHARTS ANALYSIS VIEW TEMPLATE]
  For function fitting or time-series analysis, prefer a **two-panel layout**:
  - 上方：原始数据与模型预测的多条折线图；
  - 下方：对应的残差图（预测值 - 实际值），帮助用户判断拟合质量。

  Design principles:
  1. 使用 **同一数据数组**，字段示例：
     * time: 自变量（时间或 x）；
     * actual: 实际观测值；
     * predicted: 模型预测值；
     * residual: 残差（predicted - actual）。
  2. 两个图的 X 轴共用同一 time 维度，视觉上上下对齐；
  3. 残差图中应有 y=0 的参考线，便于识别偏差方向。

  Example skeleton:

  \`\`\`jsx
  const TimeSeriesWithResiduals = () => {
    const [noiseLevel, setNoiseLevel] = React.useState(0.2);

    const data = React.useMemo(() => {
      const points = [];
      for (let t = 0; t <= 20; t += 0.2) {
        const trueVal = Math.sin(t);
        const modelVal = 0.9 * Math.sin(t + 0.2);
        const noise = (Math.random() - 0.5) * 2 * noiseLevel;
        const observed = trueVal + noise;
        const residual = modelVal - observed;
        points.push({
          time: t,
          actual: observed,
          predicted: modelVal,
          residual: residual
        });
      }
      return points;
    }, [noiseLevel]);

    return (
      <div className="w-full h-full flex flex-col bg-slate-950">
        <div className="px-6 pt-5 pb-3 border-b border-slate-800 flex justify-between items-center">
          <div>
            <div className="text-sm font-semibold text-slate-100">
              时间序列拟合与残差分析
            </div>
            <div className="text-xs text-slate-400 mt-1">
              上方对比真实曲线与模型预测，下方观察残差分布。
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-4 p-4">
          {/* Top: actual vs predicted */}
          <div className="flex-1 min-h-[180px] bg-slate-900/60 rounded-xl border border-slate-800 p-3">
            <div className="text-xs text-slate-400 mb-1.5">原始数据与模型预测</div>
            <Recharts.ResponsiveContainer width="100%" height="100%">
              <Recharts.LineChart data={data}>
                <Recharts.CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <Recharts.XAxis
                  dataKey="time"
                  stroke="#94a3b8"
                  tick={{ fontSize: 11 }}
                  label={{ value: "时间 / t", position: "insideBottomRight", offset: -5, fill: "#94a3b8", fontSize: 10 }}
                />
                <Recharts.YAxis
                  stroke="#94a3b8"
                  tick={{ fontSize: 11 }}
                  label={{ value: "数值", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }}
                />
                <Recharts.Tooltip
                  contentStyle={{ backgroundColor: "#020617", borderColor: "#334155", color: "#e5e7eb" }}
                  itemStyle={{ color: "#a5b4fc" }}
                  formatter={(value, name) => {
                    const label =
                      name === "actual" ? "观测值" :
                      name === "predicted" ? "预测值" :
                      name;
                    return [typeof value === "number" ? value.toFixed(3) : value, label];
                  }}
                  labelFormatter={(label) =>
                    typeof label === "number" ? "t = " + label.toFixed(2) : label
                  }
                />
                <Recharts.Line
                  type="monotone"
                  dataKey="actual"
                  stroke="#38bdf8"
                  strokeWidth={1.8}
                  dot={false}
                  name="观测值"
                />
                <Recharts.Line
                  type="monotone"
                  dataKey="predicted"
                  stroke="#a3e635"
                  strokeDasharray="5 3"
                  strokeWidth={1.8}
                  dot={false}
                  name="预测值"
                />
              </Recharts.LineChart>
            </Recharts.ResponsiveContainer>
          </div>

          {/* Bottom: residuals */}
          <div className="flex-1 min-h-[150px] bg-slate-900/60 rounded-xl border border-slate-800 p-3">
            <div className="text-xs text-slate-400 mb-1.5">残差随时间变化</div>
            <Recharts.ResponsiveContainer width="100%" height="100%">
              <Recharts.LineChart data={data}>
                <Recharts.CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <Recharts.XAxis
                  dataKey="time"
                  stroke="#94a3b8"
                  tick={{ fontSize: 11 }}
                  label={{ value: "时间 / t", position: "insideBottomRight", offset: -5, fill: "#94a3b8", fontSize: 10 }}
                />
                <Recharts.YAxis
                  stroke="#94a3b8"
                  tick={{ fontSize: 11 }}
                  label={{ value: "残差 (预测 - 实际)", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }}
                />
                <Recharts.ReferenceLine y={0} stroke="#64748b" strokeDasharray="4 4" />
                <Recharts.Tooltip
                  contentStyle={{ backgroundColor: "#020617", borderColor: "#334155", color: "#e5e7eb" }}
                  itemStyle={{ color: "#fb7185" }}
                  formatter={(value) => [
                    typeof value === "number" ? value.toFixed(3) : value,
                    "残差"
                  ]}
                  labelFormatter={(label) =>
                    typeof label === "number" ? "t = " + label.toFixed(2) : label
                  }
                />
                <Recharts.Line
                  type="monotone"
                  dataKey="residual"
                  stroke="#fb7185"
                  strokeWidth={1.6}
                  dot={false}
                  name="残差"
                />
              </Recharts.LineChart>
            </Recharts.ResponsiveContainer>
          </div>
        </div>
      </div>
    );
  };
  // IMPORTANT: for such analysis views, still end with:
  // return TimeSeriesWithResiduals;
  \`\`\`

  [VISUAL QUALITY & STYLE GUIDELINES]
  These rules apply to **ALL** visualizations (2D charts, 3D scenes, UI panels):

  1. Clarity first:
     *  图表与 3D 场景要有清晰标题、简短说明文字；
     *  每一个曲线/系列/关键对象都应有明显的视觉区分（颜色、线型、形状）。
  2. Scientific storytelling:
     *  尽量用一句话解释“用户应该从这幅图中看到什么现象/规律”；
     *  对重要物理量或统计量，优先在界面上展示数值或标签。
  3. Interaction:
     *  对明显可调的参数（质量、时间步长、增长率等）提供交互控件；
     *  控件附近用简体中文标注含义、单位和当前值。
  4. Consistency:
     *  颜色与样式风格保持与深色 UI 一致（Slate 系列背景、品牌色高亮）；
     *  避免过多随机色，优先选定一套协调的色板。
  5. Performance & robustness:
     *  避免在每一帧创建大量对象或临时数组（使用 useMemo/useRef 缓存）；
     *  避免不必要的巨大 mesh 数量或极端分辨率。

  [CREATIVE FREEDOM & VARIATION]
  Within the above safety and clarity rules, you SHOULD still be creative:

  1. Layout freedom:
     *  可以根据场景需要选择左右布局、上下布局，或卡片式布局；
     *  可以在合理范围内调整留白、边框、阴影，让作品更有“作品感”。
  2. Visual choices:
     *  可以选择不同但协调的配色方案和线型风格（实线/虚线、粗细）；
     *  可以适度使用动画（framer-motion、R3F useFrame 等）增强表达，但不要喧宾夺主。
  3. Component abstraction:
     *  当你发现某个模式可复用（如 ParameterSlider、ControlPanel），可以在代码中抽象出小组件；
     *  模板片段（线性函数、逻辑斯蒂曲线、时间序列残差视图等）是“参考实现”，不是唯一解法。
  4. Respect user intent:
     *  当用户有明确审美或结构偏好时（如“极简风格”“像论文插图那样”），在上述规则范围内优先满足这些偏好。

  [3D R3F + DREI BEST PRACTICES]
  1. For 3D scenes about space, geometry, or physics, prefer **R3F + Drei** instead of plain THREE.
  2. Always build a meaningful scene graph, not just a single primitive:
     *   Combine spheres, cylinders, tori, rings, planes, lines, etc.
     *   Example: Molecule = multiple spheres + cylinders as bonds; Telescope = tubes + lenses + mount.
  3. Use **lighting + environment** to add realism:
     *   Add at least one key light and soft ambient light.
     *   Use \`<Drei.Environment preset="city" />\` or \`"sunset"\` for HDR 环境光照和金属/玻璃质感。
  4. For objects resting on a surface, add contact shadows:
     *   Use \`<Drei.ContactShadows position={[0, -X, 0]} opacity={0.4} scale={S} blur={2.5} />\`.
     *   Align the plane with your objects so阴影在视觉上“贴地”。
  5. Prefer高级 Drei 组件来增强科学表达：
     *   \`<Drei.Text /> / <Drei.Text3D />\` 展示公式名称、坐标轴标签或实验参数。
     *   \`<Drei.Float>\` 包裹需要轻微漂浮的对象（如粒子、标签、探测器）。
     *   \`<Drei.Html />\` 用于注释、说明小卡片、显示数值或推导步骤。
     *   \`<Drei.Line />\` 画出光路、力的方向、轨道轨迹。
     *   \`<Drei.Grid />\` 或 \`<Drei.PolarGrid />\` 提供空间参考。
  6. 对于“3D 物体”的指令，避免只渲染一个 \`<boxGeometry />\`：
     *   至少用 2–3 个 mesh 组合成有结构的科学模型。
     *   例如：行星系统 = 恒星 + 行星 + 轨道环 + 轨迹线 + 文本标签。

  [MATH RENDERING WITH KATEX]
  1. When explaining物理/数学原理（如 F = G m1 m2 / r^2, Schrödinger equation），可以输出 LaTeX 公式。
  2. 你可以在 React 组件中使用 KaTeX 生成 HTML 字符串，并通过 \`dangerouslySetInnerHTML\` 注入，例如：
     *   \`const formulaHtml = KaTeX.renderToString('F = G \\frac{m_1 m_2}{r^2}', { displayMode: true });\`
     *   \`<div dangerouslySetInnerHTML={{ __html: formulaHtml }} />\`
  3. 在 3D 场景中，如需将公式“挂在空中”，优先用 \`<Drei.Html>\` 或 \`<Drei.Text>\` 将公式或其说明放到空间中的合适位置。

  [SCENE DSL WORKFLOW]
  1. For more complex 3D scientific systems, you can optionally generate a 3D scene DSL JSON first (type = "r3f_scene"), then code:
     *   The host can turn this DSL into R3F + Drei using \`Sci3D.SceneFromDsl\`.
  2. Example JSON:
  \`\`\`json
  {
    "type": "r3f_scene",
    "camera": { "position": [0, 5, 12], "fov": 40 },
    "lights": [
      { "type": "environment", "preset": "city" },
      { "type": "point", "position": [10, 10, 10], "intensity": 1.2 }
    ],
    "objects": [
      { "kind": "planet", "id": "planet1", "mass": 10, "position": [-3, 0, 0] },
      { "kind": "planet", "id": "planet2", "mass": 5, "position": [3, 0, 0] },
      { "kind": "force_arrow", "from": "planet1", "to": "planet2" }
    ]
  }
  \`\`\`
  3. You can either:
     *   Embed the DSL under \`sceneDsl\` field in the JSON metadata, or
     *   Output the DSL as a separate \`\`\`json\`\`\` block when no JSX code is provided.
  4. The host may automatically wrap this DSL into a React component using \`Sci3D.SceneFromDsl\` and \`R3F.Canvas\`.

  [CODING BEST PRACTICES - PREVENT ERRORS]
  1.  **Sub-Components:** Define helper components **OUTSIDE** the main component.
  2.  **Hooks:** Never call hooks conditionally.
  3.  **Imports:** DO NOT write \`import ...\`. Use global variables (React, R3F, Physics, MathJS, etc.).
  4.  **Physics:** If using Physics, the component using \`useBox\` etc. MUST be a child of \`<Physics.Physics>\`.
  
  [AI CODE GENERATION LOOP]
  Apply the following internal workflow whenever you generate or fix code:

  1. Plan:
     *  在脑中先构思组件结构：状态、子组件、布局和交互；
     *  明确本次任务的 taskType（过程解释 / 仿真 / 时间轴 / 仪表板 / 结构图等）与 visualStrategy；
     *  在 Metadata.reply 中用中文简要描述这份“设计思路”，并确保与规划 JSON 中的 taskType、visualStrategy、views 一致。
  2. Implement:
     *  一次性输出完整组件代码，避免只输出片段或补丁；
     *  保证代码可以从头到尾独立运行（不依赖未声明的变量或未注入的库）。
  3. Self-review before finalizing:
     *  检查最后是否以 \`return ComponentName;\` 结尾，且该组件已在上文完整定义；
     *  检查是否误写了 \`import\` 或未使用提供的全局变量（React, Recharts, R3F 等）；
     *  检查 hooks 是否全部在组件顶层调用，且没有条件分支中的 hooks；
     *  检查 map 渲染时是否提供合理且稳定的 \`key\` 属性；
     *  检查明显的拼写错误和 JSX 结构不匹配问题（如标签未闭合）。
  4. When receiving [CRITICAL ERROR] feedback:
     *  把错误信息视为“权威诊断”，认真分析其含义；
     *  避免局部打补丁，**优先重新生成一版完整且更简洁的组件**；
     *  明确修正策略：减少复杂度、减少嵌套、优先选择稳健的库用法。

  [OUTPUT FORMAT]
  Return TWO parts (JSON Metadata + JSX Code).
  
  PART 1: Metadata (JSON)
  \`\`\`json
  {
    "reply": "Analysis: This requires a physics simulation. I will use R3F and Cannon...",
    "title": "Title (Chinese)",
    "description": "Description (Chinese)"
  }
  \`\`\`

  PART 2: Code (JSX)
  - NO export default.
  - Must end with \`return ComponentName;\`
  \`\`\`jsx
  // Helpers defined outside
  const Box = (props) => {
     // Physics hook needs to be inside Physics Provider
     const [ref] = Physics.useBox(() => ({ mass: 1, ...props }));
     return (
        <mesh ref={ref}>
           <boxGeometry />
           <meshStandardMaterial color="orange" />
        </mesh>
     );
  };

  const ComponentName = () => {
    return (
       <div className="w-full h-full bg-slate-950 text-slate-200 flex flex-col">
          <div className="p-4 border-b border-slate-800 flex justify-between">
             <h2 className="text-xl font-bold">Physics Demo</h2>
          </div>
          <div className="flex-1 relative">
             <R3F.Canvas camera={{ position: [0, 5, 10] }}>
                <ambientLight intensity={0.5} />
                <Drei.OrbitControls makeDefault />
                <Physics.Physics>
                   <Box position={[0, 5, 0]} />
                   <Physics.Debug color="black" scale={1.1}>
                      {/* Ground */}
                   </Physics.Debug>
                </Physics.Physics>
             </R3F.Canvas>
          </div>
       </div>
    );
  };
  return ComponentName;
  \`\`\`
  `;

  let userContext = "";
  if (currentArtifact) {
    userContext += `
    [CURRENT ARTIFACT STATE]:
    Title: ${currentArtifact.title}
    Description: ${currentArtifact.description}
    Code: 
    ${currentArtifact.code}
    
    [CONVERSATION HISTORY]:
    ${history.map(m => {
        let msg = `${m.role.toUpperCase()}: ${m.text}`;
        if(m.images && m.images.length > 0) {
            msg += ` [Attached ${m.images.length} images]`;
        }
        return msg;
    }).join('\n')}
    `;
  }
  userContext += `\n[NEW USER REQUEST]: ${prompt}\n`;

  let planningMetadata: PlanningMetadata | null = null;
  let planningSceneDsl: any | null = null;

  const planningPayload = `${userContext}\n[GENERATION MODE]: PLANNING_ONLY\n请只输出规划元数据 JSON（遵循 PLANNING METADATA SCHEMA，可以包含 sceneDsl 字段），不要输出任何 JSX 代码块。`;

  try {
    if (isGlmProvider) {
      const planningText = await callGlm(modelConfig.modelId, apiKey, sysPrompt, planningPayload);
      const planningResult = parsePlanningResponse(planningText, currentArtifact);
      planningMetadata = planningResult.metadata;
      planningSceneDsl = planningResult.sceneDsl;
    } else {
      if (!ai) {
        throw new Error("Gemini client not initialized");
      }
      const planningContents = [
        { role: 'user', parts: [{ text: planningPayload }] }
      ];
      const planningText = await callGemini(ai, modelConfig.modelId, sysPrompt, planningContents);
      const planningResult = parsePlanningResponse(planningText, currentArtifact);
      planningMetadata = planningResult.metadata;
      planningSceneDsl = planningResult.sceneDsl;
    }
  } catch (e) {
  }

  let attempt = 0;
  let currentPayload = `${userContext}\n[GENERATION MODE]: CODE_ONLY\n`;
  let lastError = "";

  if (planningMetadata) {
    const planningPack: any = {
      reply: planningMetadata.reply,
      title: planningMetadata.title,
      description: planningMetadata.description
    };
    if (planningMetadata.taskType) {
      planningPack.taskType = planningMetadata.taskType;
    }
    if (planningMetadata.visualStrategy) {
      planningPack.visualStrategy = planningMetadata.visualStrategy;
    }
    if (planningMetadata.views) {
      planningPack.views = planningMetadata.views;
    }
    if (planningSceneDsl) {
      planningPack.sceneDsl = planningSceneDsl;
    } else if (planningMetadata.sceneDsl) {
      planningPack.sceneDsl = planningMetadata.sceneDsl;
    }
    currentPayload += `\n[PLANNING SUMMARY JSON]:\n${JSON.stringify(planningPack)}\n\n请基于上述规划生成最终 JSX 代码，保持结构与交互设计一致。\n`;
  } else {
    currentPayload += `\nPlease generate the response following the TWO PARTS format (JSON metadata + JSX code).\n`;
  }

  while (attempt <= MAX_AUTO_REPAIR_ATTEMPTS) {
    try {
        console.log(`[Model] Generation Attempt ${attempt + 1} using provider ${modelConfig.provider} model ${modelConfig.modelId}`);
        
        if (isGlmProvider) {
            const textResponse = await callGlm(modelConfig.modelId, apiKey, sysPrompt, currentPayload);
            const result = parseResponse(textResponse, currentArtifact);
            const validation = validateCode(result.artifact.code);
            const sceneLint = lint3DScene(result.artifact.code);
            const safetyLint = lintSafetyAndPerformance(result.artifact.code);

            if (validation.isValid && sceneLint.isOk && safetyLint.isOk) {
                if (planningMetadata) {
                  result.reply = planningMetadata.reply || result.reply;
                  result.artifact.title = planningMetadata.title || result.artifact.title;
                  result.artifact.description = planningMetadata.description || result.artifact.description;
                  (result as any).planning = planningMetadata;
                }
                return result;
            } else {
                if (!validation.isValid) {
                    console.warn(`[GLM] Code validation failed on attempt ${attempt + 1}:`, validation.error);
                    lastError = validation.error || "Unknown compilation error";
                } else if (!sceneLint.isOk) {
                    lastError = sceneLint.issues.join("; ") || "Scene visual quality checks failed";
                } else if (!safetyLint.isOk) {
                    lastError = safetyLint.issues.join("; ") || "Safety and performance checks failed";
                }
                
                let fixStrategy = "1. Check for mismatched braces/parentheses.\n2. Ensure all hooks (useState, useEffect) are used correctly.\n3. DO NOT use external imports (like 'framer-motion' or 'three') that are not provided.\n4. Re-generate the WHOLE component.";

                if (lastError.startsWith("Detected possibly undeclared ref variables")) {
                  fixStrategy += "\n5. For each ref-like name mentioned, add a declaration near the top of the main component, for example: const myRef = React.useRef(null);\n6. Do not call useRef directly; always use React.useRef(...).";
                }

                if (!sceneLint.isOk && sceneLint.issues.length > 0) {
                  const visualFeedback = `[CRITICAL VISUAL FEEDBACK]\n${sceneLint.issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
                  fixStrategy += `\n7. Improve 3D scene visual structure according to the following checklist:\n${sceneLint.issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
                  currentPayload += `\n\n${visualFeedback}\n\n`;
                }

                if (!safetyLint.isOk && safetyLint.issues.length > 0) {
                  const safetyFeedback = `[SAFETY AND PERFORMANCE FEEDBACK]\n${safetyLint.issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
                  fixStrategy += `\n8. Improve safety and performance according to the following checklist:\n${safetyLint.issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
                  currentPayload += `\n\n${safetyFeedback}\n\n`;
                }

                currentPayload += `\n\n[CRITICAL ERROR]: The previous code caused a runtime/compilation, visual quality, or safety/performance error:\n"${lastError}"\n\nFIX STRATEGY:\n${fixStrategy}`;
                
                attempt++;
                continue;
            }
        }

        if (!ai) {
            throw new Error("Gemini client not initialized");
        }

        const currentTurnParts: any[] = [{ text: currentPayload }];
        
        if (images && images.length > 0) {
            images.forEach(base64Str => {
                const matches = base64Str.match(/^data:(.+);base64,(.+)$/);
                if (matches) {
                    currentTurnParts.push({
                        inlineData: {
                            mimeType: matches[1],
                            data: matches[2]
                        }
                    });
                }
            });
        }

        const effectiveContents = [
             { role: 'user', parts: currentTurnParts }
        ];

        const textResponse = await callGemini(ai, modelConfig.modelId, sysPrompt, effectiveContents);
        const result = parseResponse(textResponse, currentArtifact);

        const validation = validateCode(result.artifact.code);
        const sceneLint = lint3DScene(result.artifact.code);
        const safetyLint = lintSafetyAndPerformance(result.artifact.code);

        if (validation.isValid && sceneLint.isOk && safetyLint.isOk) {
            if (planningMetadata) {
              result.reply = planningMetadata.reply || result.reply;
              result.artifact.title = planningMetadata.title || result.artifact.title;
              result.artifact.description = planningMetadata.description || result.artifact.description;
              (result as any).planning = planningMetadata;
            }
            return result;
        } else {
            if (!validation.isValid) {
                console.warn(`[Gemini] Code validation failed on attempt ${attempt + 1}:`, validation.error);
                lastError = validation.error || "Unknown compilation error";
            } else if (!sceneLint.isOk) {
                lastError = sceneLint.issues.join("; ") || "Scene visual quality checks failed";
            } else if (!safetyLint.isOk) {
                lastError = safetyLint.issues.join("; ") || "Safety and performance checks failed";
            }
            
            let fixStrategy = "1. Check for mismatched braces/parentheses.\n2. Ensure all hooks (useState, useEffect) are used correctly.\n3. DO NOT use external imports (like 'framer-motion' or 'three') that are not provided.\n4. Re-generate the WHOLE component.";

            if (lastError.startsWith("Detected possibly undeclared ref variables")) {
              fixStrategy += "\n5. For each ref-like name mentioned, add a declaration near the top of the main component, for example: const myRef = React.useRef(null);\n6. Do not call useRef directly; always use React.useRef(...).";
            }

            if (!sceneLint.isOk && sceneLint.issues.length > 0) {
              const visualFeedback = `[CRITICAL VISUAL FEEDBACK]\n${sceneLint.issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
              fixStrategy += `\n7. Improve 3D scene visual structure according to the following checklist:\n${sceneLint.issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
              currentPayload += `\n\n${visualFeedback}\n\n`;
            }

            if (!safetyLint.isOk && safetyLint.issues.length > 0) {
              const safetyFeedback = `[SAFETY AND PERFORMANCE FEEDBACK]\n${safetyLint.issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
              fixStrategy += `\n8. Improve safety and performance according to the following checklist:\n${safetyLint.issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
              currentPayload += `\n\n${safetyFeedback}\n\n`;
            }

            currentPayload += `\n\n[CRITICAL ERROR]: The previous code caused a runtime/compilation, visual quality, or safety/performance error:\n"${lastError}"\n\nFIX STRATEGY:\n${fixStrategy}`;
            
            attempt++;
        }
    } catch (error: any) {
        console.error(`[Model] Error on attempt ${attempt + 1}:`, error);
        throw error;
    }
  }

  throw new Error(`Failed to generate valid code after ${MAX_AUTO_REPAIR_ATTEMPTS + 1} attempts. Last error: ${lastError}`);
};
