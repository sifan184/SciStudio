import React, { useState, useCallback, useEffect, useRef } from 'react';
import { INITIAL_ARTIFACT, BLANK_ARTIFACT, ADDITIONAL_WORKS } from './constants';
import { ScienceArtifact, ChatMessage, ModelConfig } from './types';
import { ArtifactRenderer } from './components/ArtifactRenderer';
import { ChatInterface } from './components/ChatInterface';
import { WorksList } from './components/WorksList';
import { generateScienceArtifact } from './services/geminiService';
import * as Lucide from 'lucide-react';
import { loadCloudSnapshot, saveCloudSnapshot } from './services/cloudStorage';

const migrateWorks = (works: ScienceArtifact[]): ScienceArtifact[] => {
  return works.map(w => {
    if (w.title === "新建作品" && w.description === "空白画布") {
      return { ...w, description: "呈现你的想象" };
    }
    return w;
  });
};

const DEFAULT_MODELS: ModelConfig[] = [
  { id: 'default-1', provider: 'Google', name: 'Gemini 2.5 Flash', modelId: 'gemini-2.5-flash' },
  { id: 'default-2', provider: 'Google', name: 'Gemini 3.0 Pro', modelId: 'gemini-3-pro-preview' },
  { id: 'default-3', provider: 'Google', name: 'Gemini 3 Flash', modelId: 'gemini-3-flash-preview' },
  { id: 'default-4', provider: 'Zhipu', name: 'GLM 4.7', modelId: 'glm-4.7' },
];

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('App render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen bg-slate-950 text-slate-200 flex items-center justify-center">
          <div className="max-w-md px-6 py-4 border border-red-500/40 rounded-xl bg-red-950/40">
            <div className="text-sm font-semibold text-red-300 mb-2">界面渲染时出现错误</div>
            <div className="text-xs text-red-200 break-all">{this.state.message}</div>
            <div className="text-[10px] text-slate-400 mt-3">可以尝试刷新页面或清除浏览器 localStorage 后重试。</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  // Global State
  const [works, setWorks] = useState<ScienceArtifact[]>(() => {
    if (typeof window === 'undefined') {
      return [INITIAL_ARTIFACT, ...ADDITIONAL_WORKS];
    }
    try {
      const raw = window.localStorage.getItem('scistudio-works');
      if (!raw) return [INITIAL_ARTIFACT, ...ADDITIONAL_WORKS];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return [INITIAL_ARTIFACT, ...ADDITIONAL_WORKS];
      }
      return migrateWorks(parsed);
    } catch {
      return [INITIAL_ARTIFACT, ...ADDITIONAL_WORKS];
    }
  });
  const [currentWorkId, setCurrentWorkId] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const saved = window.localStorage.getItem('scistudio-currentWorkId');
      return saved || null;
    } catch {
      return null;
    }
  });
  const [messagesMap, setMessagesMap] = useState<Record<string, ChatMessage[]>>(() => {
    if (typeof window === 'undefined') {
      return {};
    }
    try {
      const raw = window.localStorage.getItem('scistudio-messages');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as Record<string, ChatMessage[]>;
    } catch {
      return {};
    }
  });
  
  // Model State
  const [models, setModels] = useState<ModelConfig[]>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_MODELS;
    }
    try {
      const raw = window.localStorage.getItem('scistudio-models');
      if (!raw) return DEFAULT_MODELS;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return DEFAULT_MODELS;
      }
      const apiKeysRaw = window.localStorage.getItem('scistudio-model-apikeys');
      const apiKeyMap = apiKeysRaw ? JSON.parse(apiKeysRaw) as Record<string, string> : {};
      return parsed.map(m => {
        if (!m.provider) return m;
        const key = apiKeyMap[m.provider];
        return key ? { ...m, apiKey: key } : m;
      });
    } catch {
      return DEFAULT_MODELS;
    }
  });
  const [selectedModelId, setSelectedModelId] = useState<string>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_MODELS[0].id;
    }
    try {
      const saved = window.localStorage.getItem('scistudio-selectedModelId');
      return saved || DEFAULT_MODELS[0].id;
    } catch {
      return DEFAULT_MODELS[0].id;
    }
  });

  // UI State
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  
  // Resize State
  const [sidebarWidth, setSidebarWidth] = useState(420);
  const [isResizing, setIsResizing] = useState(false);

  const [runtimeErrorMap, setRuntimeErrorMap] = useState<Record<string, string | null>>({});
  const autoRetryRef = useRef<Record<string, string | null>>({});

  // Derived State
  const activeWork = works.find(w => w.id === currentWorkId);
  const activeMessages = currentWorkId ? (messagesMap[currentWorkId] || []) : [];

  // --- Actions ---

  const handleUpdateModel = (modelId: string, updates: Partial<ModelConfig>) => {
    setModels(prev => prev.map(m => m.id === modelId ? { ...m, ...updates } : m));
  };

  const handleSelectWork = (id: string) => {
    setCurrentWorkId(id);
    setError(null);
    setIsChatOpen(false); // Default to collapsed thumbnail when opening existing
  };

  const handleCreateWork = () => {
    const newId = crypto.randomUUID();
    const newWork = { ...BLANK_ARTIFACT, id: newId, createdAt: Date.now() };
    setWorks(prev => [newWork, ...prev]);
    setCurrentWorkId(newId);
    setError(null);
    setIsChatOpen(true); // Default to OPEN when creating new
  };

  const handleDeleteWork = (id: string) => {
    setWorks(prev => prev.filter(w => w.id !== id));
    if (currentWorkId === id) {
      setCurrentWorkId(null);
    }
    setMessagesMap(prev => {
        const newMap = { ...prev };
        delete newMap[id];
        return newMap;
    });
  };

  const handleHomeClick = () => {
    setCurrentWorkId(null);
    setError(null);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const snapshot = await loadCloudSnapshot();
        if (!snapshot || cancelled) return;
        if (snapshot.works && snapshot.works.length > 0) {
          setWorks(migrateWorks(snapshot.works));
        }
        if (snapshot.messagesMap) {
          setMessagesMap(snapshot.messagesMap);
        }
        if (typeof snapshot.selectedModelId === "string" && snapshot.selectedModelId.length > 0) {
          setSelectedModelId(snapshot.selectedModelId);
        }
        if (snapshot.modelsWithoutKeys && snapshot.modelsWithoutKeys.length > 0) {
          setModels(prev => {
            const byId: Record<string, ModelConfig> = {};
            prev.forEach(m => {
              byId[m.id] = m;
            });
            return snapshot.modelsWithoutKeys.map(m => {
              const existing = byId[m.id];
              if (existing && existing.apiKey) {
                return { ...m, apiKey: existing.apiKey };
              }
              return m;
            });
          });
        }
      } catch (e) {
        console.error("Load cloud snapshot error:", e);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRuntimeError = (message: string) => {
    if (!activeWork) return;
     if (isGenerating) return;
    const workId = activeWork.id;
    const codeSignature = activeWork.code;
    const lastSignature = autoRetryRef.current[workId] || null;
    const baseHistory = activeMessages;

    const errorText = `[CRITICAL ERROR] Runtime error in last visualization: ${message}`;
    const errorMsg: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'model',
      text: errorText
    };

    const newHistory = [...baseHistory, errorMsg];

    setMessagesMap(prev => ({ ...prev, [workId]: newHistory }));

    setRuntimeErrorMap(prev => ({
      ...prev,
      [workId]: message
    }));

    if (lastSignature === codeSignature) {
      return;
    }

    autoRetryRef.current[workId] = codeSignature;

    const lastUser = [...baseHistory].reverse().find(m => m.role === 'user');
    if (!lastUser) {
      return;
    }
    const prompt = lastUser.text;
    const images = lastUser.images || [];

    (async () => {
      try {
        if (currentWorkId !== workId) {
          return;
        }
        setIsGenerating(true);

        const currentModelConfig = models.find(m => m.id === selectedModelId) || models[0];

        const response = await generateScienceArtifact(
          prompt,
          images,
          currentModelConfig,
          activeWork,
          newHistory
        );

        if (currentWorkId !== workId) {
          return;
        }

        setWorks(prev =>
          prev.map(w =>
            w.id === workId ? { ...response.artifact, id: workId, createdAt: activeWork.createdAt } : w
          )
        );

        const modelMsg: ChatMessage = {
          id: (Date.now() + 2).toString(),
          role: 'model',
          text: response.reply || "已根据运行时错误自动重试并修复。"
        };

        setMessagesMap(prev => {
          const existing = prev[workId] || newHistory;
          return { ...prev, [workId]: [...existing, modelMsg] };
        });
      } catch (e: any) {
        console.error("Silent retry error:", e);
        const rawMessage = e instanceof Error ? e.message : String(e);
        setError(prev => prev || `错误: ${rawMessage}`);
      } finally {
        setIsGenerating(false);
      }
    })();
  };

  const handleGenerate = async (prompt: string, images: string[]) => {
    if (!activeWork) return;

    setIsGenerating(true);
    setError(null);

    // Optimistically add user message
    const userMsg: ChatMessage = { 
        id: Date.now().toString(), 
        role: 'user', 
        text: prompt, 
        images: images // Store images in message history
    };
    const newHistory = [...activeMessages, userMsg];
    
    setMessagesMap(prev => ({ ...prev, [activeWork.id]: newHistory }));

    try {
      // Find selected model config
      const currentModelConfig = models.find(m => m.id === selectedModelId) || models[0];

      const response = await generateScienceArtifact(
          prompt, 
          images, 
          currentModelConfig, 
          activeWork, 
          newHistory
      );
      
      setWorks(prev => prev.map(w => w.id === activeWork.id ? { ...response.artifact, id: activeWork.id, createdAt: activeWork.createdAt } : w));
      
      const modelMsg: ChatMessage = { 
        id: (Date.now() + 1).toString(), 
        role: 'model', 
        text: response.reply || "已更新配置。"
      };
      
      setMessagesMap(prev => ({ ...prev, [activeWork.id]: [...newHistory, modelMsg] }));

    } catch (e: any) {
      console.error("App Generate Error:", e);
      const rawMessage = e instanceof Error ? e.message : String(e);
      let displayMessage = rawMessage;

      if (
        rawMessage.includes("You exceeded your current quota") ||
        rawMessage.includes('"status":"RESOURCE_EXHAUSTED"')
      ) {
        displayMessage =
          "当前 Gemini 项目的调用额度已用完或为 0，请在 AI Studio / Google Cloud 中检查该模型的配额和计费状态，或稍后再试。";
      } else if (
        rawMessage.includes("The model is overloaded") ||
        rawMessage.includes('"status":"UNAVAILABLE"')
      ) {
        displayMessage =
          "当前使用的 Gemini 模型负载过高（服务端 503），这不是你的问题，稍后重试或切换到其他模型（如 Gemini 2.5 Flash）通常可以恢复。";
      } else if (rawMessage.includes("Detected possibly undeclared ref variables")) {
        const match = rawMessage.match(/Detected possibly undeclared ref variables:\s*(.*)$/);
        const vars = match && match[1] ? match[1] : "";
        const varsText = vars ? `（${vars}）` : "";
        displayMessage =
          `当前生成的代码中有一些内部引用变量${varsText}没有正确定义，这是 AI 生成代码的结构问题，而不是你的操作错误。请尝试点击“重新生成”或稍微调整一下指令描述后再试。`;
      } else if (
        rawMessage.includes("GLM API Error: 401") ||
        rawMessage.includes('"code":"401"') ||
        rawMessage.includes("令牌已过期或验证不正确")
      ) {
        displayMessage =
          "当前调用的 GLM 接口返回了 401 错误，说明使用的令牌无效或已过期。请在配置中检查并更新 GLM API Key 后再重试，此问题不会影响你已有的作品内容。";
      } else if (
        rawMessage.includes("Failed to generate valid code after") ||
        rawMessage.includes("validation.tsx: Unexpected token")
      ) {
        displayMessage =
          "当前模型自动生成的代码在多次自动修复后仍然存在语法问题（例如括号或 JSX 结构不合法）。这是 AI 生成代码的质量问题，而不是你的操作错误，建议适当简化或拆分指令，再点击“重新生成”重试。";
      }

      setError(`错误: ${displayMessage}`);
      
      const errorMsg: ChatMessage = { 
        id: (Date.now() + 1).toString(), 
        role: 'model', 
        text: `抱歉，遇到问题: ${displayMessage}` 
      };
      setMessagesMap(prev => ({ ...prev, [activeWork.id]: [...newHistory, errorMsg] }));
    } finally {
      setIsGenerating(false);
    }
  };

  // --- Persistence ---
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('scistudio-works', JSON.stringify(works));
    } catch {
    }
  }, [works]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (currentWorkId) {
        window.localStorage.setItem('scistudio-currentWorkId', currentWorkId);
      } else {
        window.localStorage.removeItem('scistudio-currentWorkId');
      }
    } catch {
    }
  }, [currentWorkId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('scistudio-messages', JSON.stringify(messagesMap));
    } catch {
    }
  }, [messagesMap]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('scistudio-selectedModelId', selectedModelId);
    } catch {
    }
  }, [selectedModelId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const modelsWithoutKeys = models.map(m => {
        const { apiKey, ...rest } = m;
        return rest;
      });
      window.localStorage.setItem('scistudio-models', JSON.stringify(modelsWithoutKeys));
      const apiKeyMap: Record<string, string> = {};
      models.forEach(m => {
        if (m.provider && m.apiKey) {
          apiKeyMap[m.provider] = m.apiKey;
        }
      });
      window.localStorage.setItem('scistudio-model-apikeys', JSON.stringify(apiKeyMap));
    } catch {
    }
  }, [models]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const persist = async () => {
      try {
        const modelsWithoutKeys = models.map(m => {
          const { apiKey, ...rest } = m;
          return rest;
        });
        await saveCloudSnapshot({
          works,
          messagesMap,
          selectedModelId,
          modelsWithoutKeys
        });
      } catch (e) {
        console.error("Save cloud snapshot error:", e);
      }
    };
    persist();
  }, [works, messagesMap, selectedModelId, models]);

  // --- Resize Handlers ---
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate width based on distance from right edge of screen
      const newWidth = window.innerWidth - e.clientX;
      // Clamp width between 250px and 800px (or 60% of screen)
      const clampedWidth = Math.max(250, Math.min(newWidth, window.innerWidth * 0.6));
      setSidebarWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-200 overflow-hidden flex flex-col font-sans selection:bg-brand-500/30">
      
      {/* Navbar */}
      <header className="h-14 flex-shrink-0 border-b border-slate-800 bg-slate-900/90 backdrop-blur flex items-center justify-between px-4 sm:px-6 z-20 shadow-sm">
        <div className="flex items-center gap-8">
          {/* Logo Area */}
          <div 
            className="flex items-center gap-2 cursor-pointer group select-none"
            onClick={handleHomeClick}
          >
            <div className="relative w-8 h-8 flex items-center justify-center">
               <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-500 w-8 h-8 group-hover:rotate-180 transition-transform duration-700 ease-in-out"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </div>
            <div className="flex flex-col">
                <span className="font-bold text-lg tracking-tight text-white leading-none">SciStudio<span className="text-brand-500">.ai</span></span>
                <span className="text-[10px] text-slate-500 font-mono tracking-widest">可视化创意平台</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3"></div>
      </header>

      {/* Main Layout Area */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Error Banner */}
        {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 border border-red-500/50 text-white px-4 py-2 rounded-full shadow-xl backdrop-blur text-sm flex items-center gap-2 animate-bounce-in">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span className="max-w-xs truncate">{error}</span>
                <button onClick={() => setError(null)} className="ml-2 hover:bg-white/20 rounded-full p-0.5"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
        )}

        {/* Content Area */}
        <main className="flex-1 overflow-hidden relative flex flex-col transition-all duration-300">
           {activeWork ? (
              <ArtifactRenderer artifact={activeWork} onRuntimeError={handleRuntimeError} />
           ) : (
              <WorksList 
                  works={works} 
                  onSelect={handleSelectWork} 
                  onCreate={handleCreateWork}
                  onDelete={handleDeleteWork}
              />
           )}
        </main>

        {/* Chat Sidebar (Conditional) */}
        {activeWork && isChatOpen && (
          <aside 
            className={`flex-shrink-0 z-40 shadow-2xl border-l border-slate-800 bg-slate-900 relative flex flex-col ${isResizing ? 'transition-none' : 'transition-[width] duration-300'}`}
            style={{ width: sidebarWidth }}
          >
             {/* Drag Handle */}
             <div 
               onMouseDown={startResizing}
               className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-brand-500 z-50 transition-colors group"
             >
                <div className="absolute inset-y-0 -left-1 w-3 bg-transparent" /> {/* Hitbox */}
             </div>

             <ChatInterface 
                messages={activeMessages} 
                models={models}
                selectedModelId={selectedModelId}
                onSelectModel={setSelectedModelId}
                onUpdateModel={handleUpdateModel}
                onGenerate={handleGenerate} 
                isGenerating={isGenerating}
                onClose={() => setIsChatOpen(false)}
             />
          </aside>
        )}

        {/* Floating Chat Thumbnail */}
        {activeWork && !isChatOpen && (
          <button 
            onClick={() => setIsChatOpen(true)}
            className="absolute bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-brand-600 hover:bg-brand-500 shadow-xl shadow-brand-500/30 flex items-center justify-center transition-all hover:scale-105 active:scale-95 group"
            title="打开 AI 助手"
          >
             {isGenerating ? (
               <div className="absolute inset-0 rounded-full border-2 border-white/30 animate-ping"></div>
             ) : null}
             <div className="relative">
                <Lucide.Bot size={28} className="text-white" />
                {isGenerating && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                  </span>
                )}
             </div>
             
             {/* Tooltip on Hover */}
             <div className="absolute right-full mr-3 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-slate-700">
                AI 助手
             </div>
          </button>
        )}

      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppInner />
    </AppErrorBoundary>
  );
}
