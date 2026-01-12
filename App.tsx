import React, { useState, useCallback, useEffect, useRef } from 'react';
import { INITIAL_ARTIFACT, BLANK_ARTIFACT, ADDITIONAL_WORKS } from './constants';
import { ScienceArtifact, ChatMessage, ModelConfig } from './types';
import { ArtifactRenderer } from './components/ArtifactRenderer';
import { ChatInterface } from './components/ChatInterface';
import { WorksList } from './components/WorksList';
import { generateScienceArtifact } from './services/geminiService';
import * as Lucide from 'lucide-react';
import { LandingPage } from './components/LandingPage';
import { Navbar } from './components/Navbar';

type RootView = 'landing' | 'create' | 'viewWorks';

const ROOT_VIEW_STORAGE_KEY = 'scistudio-root-view';

const getInitialRootView = (): RootView => {
  if (typeof window === 'undefined') {
    return 'landing';
  }
  const stored = window.localStorage.getItem(ROOT_VIEW_STORAGE_KEY);
  if (stored === 'landing' || stored === 'create' || stored === 'viewWorks') {
    return stored;
  }
  return 'landing';
};

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

interface AppInnerProps {
  onBackToLanding: () => void;
  entryAction: 'none' | 'create' | 'viewWorks' | 'openAuth';
  onEntryActionConsumed: () => void;
}

function AppInner({ onBackToLanding, entryAction, onEntryActionConsumed }: AppInnerProps) {
  interface AuthUser {
    id: string;
    email: string | null;
  }
  // Global State
  const [works, setWorks] = useState<ScienceArtifact[]>(() => {
    return [INITIAL_ARTIFACT, ...ADDITIONAL_WORKS];
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
  const [messagesMap, setMessagesMap] = useState<Record<string, ChatMessage[]>>({});
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthPanelOpen, setIsAuthPanelOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("");

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
  const canEditActiveWork = !!(activeWork && authUser && activeWork.ownerId === authUser.id);
  const activeMenu: 'works' | 'create' = currentWorkId ? 'create' : 'works';

  // --- Actions ---

  const handleUpdateModel = (modelId: string, updates: Partial<ModelConfig>) => {
    setModels(prev => prev.map(m => m.id === modelId ? { ...m, ...updates } : m));
  };

  const handleSelectWork = (id: string) => {
    if (!authUser) {
      setIsAuthPanelOpen(true);
      setAuthError("请先登录后再打开作品");
      return;
    }
    setError(null);
    setIsChatOpen(false);
    const work = works.find(w => w.id === id);
    if (id.startsWith("w_")) {
      (async () => {
        try {
          const res = await fetch(`/api/works/${id}`, {
            credentials: "include"
          });
          if (!res.ok) {
            if (res.status === 401) {
              setAuthUser(null);
              onBackToLanding();
              return;
            }
            let message = `打开作品失败（HTTP ${res.status}）`;
            try {
              const text = await res.text();
              if (text) {
                try {
                  const data = JSON.parse(text);
                  if (data && typeof data === "object" && typeof (data as any).error === "string") {
                    message = (data as any).error;
                  } else {
                    message = text;
                  }
                } catch {
                  message = text;
                }
              }
            } catch {
            }
            setError(message);
            return;
          }
          const json = await res.json();
          const remoteWork = json.work as ScienceArtifact;
          const remoteMessages = (json.messages as ChatMessage[]) || [];
          setWorks(prev => {
            const exists = prev.some(w => w.id === remoteWork.id);
            if (exists) {
              return prev.map(w => (w.id === remoteWork.id ? remoteWork : w));
            }
            return [remoteWork, ...prev];
          });
          setMessagesMap(prev => ({
            ...prev,
            [remoteWork.id]: remoteMessages
          }));
          setCurrentWorkId(remoteWork.id);
        } catch {
        }
      })();
    } else if (work) {
      setCurrentWorkId(id);
    }
  };

  const handleCreateWork = () => {
    if (isGenerating) {
      setError("您有作品正在生成中，请稍后重试");
      return;
    }
    if (!authUser) {
      setIsAuthPanelOpen(true);
      setAuthError("请先登录后再创建作品");
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/works", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          credentials: "include",
          body: JSON.stringify({
            baseArtifact: BLANK_ARTIFACT
          })
        });
        if (!res.ok) {
          setError("创建作品失败");
          return;
        }
        const json = await res.json();
        const work = json.work as ScienceArtifact;
        setWorks(prev => [work, ...prev]);
        setMessagesMap(prev => ({
          ...prev,
          [work.id]: []
        }));
        setCurrentWorkId(work.id);
        setError(null);
        setIsChatOpen(true);
      } catch {
        setError("创建作品失败");
      }
    })();
  };

  const handleDuplicateWork = (id: string) => {
    if (isGenerating) {
      setError("您有作品正在生成中，请稍后重试");
      return;
    }
    if (!authUser) {
      setIsAuthPanelOpen(true);
      setAuthError("请先登录后再创建作品");
      return;
    }
    const source = works.find(w => w.id === id) || null;
    const baseArtifact = source && !id.startsWith("w_") ? source : null;
    (async () => {
      try {
        const res = await fetch("/api/works", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          credentials: "include",
          body: JSON.stringify({
            baseArtifact,
            sourceWorkId: id
          })
        });
        if (!res.ok) {
          setError("创建作品失败");
          return;
        }
        const json = await res.json();
        const work = json.work as ScienceArtifact;
        setWorks(prev => [work, ...prev]);
        setMessagesMap(prev => ({
          ...prev,
          [work.id]: baseArtifact ? (messagesMap[id] || []) : []
        }));
        setCurrentWorkId(work.id);
        setError(null);
        setIsChatOpen(true);
      } catch {
        setError("创建作品失败");
      }
    })();
  };

  const handleDeleteWork = (id: string) => {
    const work = works.find(w => w.id === id);
    if (!work) {
      return;
    }
    if (!authUser || work.ownerId !== authUser.id || !id.startsWith("w_")) {
      return;
    }
    setWorks(prev => prev.filter(w => w.id !== id));
    if (currentWorkId === id) {
      setCurrentWorkId(null);
    }
    setMessagesMap(prev => {
      const newMap = { ...prev };
      delete newMap[id];
      return newMap;
    });
    (async () => {
      try {
        await fetch(`/api/works/${id}`, {
          method: "DELETE",
          credentials: "include"
        });
      } catch {
      }
    })();
  };

  const handleHomeClick = () => {
    setCurrentWorkId(null);
    setError(null);
  };

  useEffect(() => {
    let cancelled = false;
    const loadUser = async () => {
      try {
        const res = await fetch("/api/auth/user", {
          credentials: "include"
        });
        if (!res.ok) {
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setAuthUser(json.user ?? null);
        }
      } catch {
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    };
    loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (entryAction === 'none') return;

    if (entryAction === 'create') {
      handleCreateWork();
    } else if (entryAction === 'viewWorks') {
      if (!authUser) {
        setIsAuthPanelOpen(true);
        setAuthError("请先登录后再查看作品");
      } else {
        handleHomeClick();
      }
    } else if (entryAction === 'openAuth') {
      setIsAuthPanelOpen(true);
      setAuthMode("login");
      setAuthError(null);
    }
    onEntryActionConsumed();
  }, [entryAction, authLoading, authUser, handleCreateWork, handleHomeClick, onEntryActionConsumed]);

  const handleAuthSubmit = async () => {
    setAuthError(null);
    try {
      const endpoint = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      if (authMode === "signup" && authPassword !== authPasswordConfirm) {
        setAuthError("两次输入的密码不一致");
        return;
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          email: authEmail,
          password: authPassword
        })
      });
      const text = await res.text().catch(() => "");
      let data: any = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (!res.ok) {
        const messageFromJson =
          data && typeof data === "object" && typeof (data as any).error === "string"
            ? (data as any).error
            : null;
        let fallback = "认证失败，请稍后重试";
        if (res.status) {
          if (res.status === 599) {
            fallback =
              "认证服务异常（HTTP 599），通常表示边缘函数或网络超时，请稍后重试或联系运维检查 ESA 日志";
          } else if (res.status >= 500) {
            fallback = `认证服务内部错误（HTTP ${res.status}），请稍后重试`;
          } else {
            fallback = `认证服务异常（HTTP ${res.status}），请稍后重试`;
          }
        }
        const finalMessage = messageFromJson || fallback;
        setAuthError(finalMessage);
        if (!messageFromJson && text) {
          console.error("Auth error response:", res.status, text);
        }
        return;
      }
      const user =
        data && typeof data === "object" && "user" in data
          ? (data as any).user
          : null;
      setAuthUser(user ?? null);
      setIsAuthPanelOpen(false);
      setAuthEmail("");
      setAuthPassword("");
      setAuthPasswordConfirm("");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setAuthError(`认证请求失败：${message}`);
    }
  };

  const handleSignOut = async () => {
    setAuthError(null);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include"
      });
      setAuthUser(null);
      onBackToLanding();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setAuthError(message);
    }
  };

  const persistWorkState = async (workId: string, artifact: ScienceArtifact, messages: ChatMessage[]) => {
    if (!authUser) return;
    if (!workId.startsWith("w_")) return;
    try {
      await fetch(`/api/works/${workId}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          artifact,
          messages
        })
      });
    } catch {
    }
  };

  const handleRuntimeError = (message: string) => {
    if (!activeWork) return;
    if (!isGenerating) {
    } else {
      return;
    }
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

        const updatedArtifact: ScienceArtifact = {
          ...response.artifact,
          id: workId,
          createdAt: activeWork.createdAt,
          ownerId: activeWork.ownerId,
          ownerEmail: activeWork.ownerEmail
        };

        setWorks(prev =>
          prev.map(w =>
            w.id === workId ? updatedArtifact : w
          )
        );

        const modelMsg: ChatMessage = {
          id: (Date.now() + 2).toString(),
          role: 'model',
          text: response.reply || "已根据运行时错误自动重试并修复。"
        };

        let finalMessages: ChatMessage[] = [];
        setMessagesMap(prev => {
          const existing = prev[workId] || newHistory;
          const combined = [...existing, modelMsg];
          finalMessages = combined;
          return { ...prev, [workId]: combined };
        });
        await persistWorkState(workId, updatedArtifact, finalMessages);
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
    if (!authUser || !activeWork.ownerId || activeWork.ownerId !== authUser.id || !activeWork.id.startsWith("w_")) {
      setError("只有作品创建者才能编辑此作品");
      return;
    }

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
          newHistory,
          (delta: string) => {
            if (!delta) return;
            if (currentModelConfig.provider !== "Zhipu") return;
            let localId = "";
            setMessagesMap(prev => {
              const list = prev[activeWork.id] || newHistory;
              const last = list[list.length - 1];
              if (!localId || !last || last.id !== localId || last.role !== "model") {
                const msg: ChatMessage = {
                  id: Date.now().toString(),
                  role: "model",
                  text: delta
                };
                localId = msg.id;
                return {
                  ...prev,
                  [activeWork.id]: [...list, msg]
                };
              }
              const updated: ChatMessage = {
                ...last,
                text: last.text + delta
              };
              const nextList = [...list.slice(0, list.length - 1), updated];
              return {
                ...prev,
                [activeWork.id]: nextList
              };
            });
          }
      );

      const updatedArtifact: ScienceArtifact = {
        ...response.artifact,
        id: activeWork.id,
        createdAt: activeWork.createdAt,
        ownerId: activeWork.ownerId,
        ownerEmail: activeWork.ownerEmail
      };

      setWorks(prev => prev.map(w => w.id === activeWork.id ? updatedArtifact : w));
      
      const modelMsg: ChatMessage = { 
        id: (Date.now() + 1).toString(), 
        role: 'model', 
        text: response.reply || "已更新配置。"
      };
      
      let finalMessages: ChatMessage[] = [];
      setMessagesMap(prev => {
        const combined = [...newHistory, modelMsg];
        finalMessages = combined;
        return { ...prev, [activeWork.id]: combined };
      });
      await persistWorkState(activeWork.id, updatedArtifact, finalMessages);

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
        rawMessage.includes("GLM API Error: 429") ||
        rawMessage.includes("Too Many Requests") ||
        rawMessage.includes("High concurrency usage of this API")
      ) {
        displayMessage =
          "当前 GLM 接口并发或调用频率过高，服务端返回 429 限流。请稍等片刻后再试，或降低同时发起的请求数量，如有长期高并发需求建议在智谱控制台提升配额。";
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
    let cancelled = false;
    const loadWorks = async () => {
      try {
        const res = await fetch("/api/works", {
          credentials: "include"
        });
        if (!res.ok) {
          return;
        }
        const json = await res.json();
        const serverWorks = (json.works as ScienceArtifact[]) || [];
        if (cancelled) return;
        setWorks(prev => {
          const byId: Record<string, boolean> = {};
          prev.forEach(w => {
            byId[w.id] = true;
          });
          const merged = [...prev];
          serverWorks.forEach(w => {
            if (!byId[w.id]) {
              merged.push(w);
            }
          });
          return merged;
        });
      } catch {
      }
    };
    loadWorks();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) return;
    if (!currentWorkId || !currentWorkId.startsWith("w_")) return;
    const work = works.find(w => w.id === currentWorkId);
    if (work && typeof work.code === "string" && work.code) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/works/${currentWorkId}`, {
          credentials: "include"
        });
        if (!res.ok) {
          if (res.status === 401) {
            if (!cancelled) {
              setAuthUser(null);
              onBackToLanding();
            }
            return;
          }
          if (cancelled) return;
          let message = `打开作品失败（HTTP ${res.status}）`;
          try {
            const text = await res.text();
            if (text) {
              try {
                const data = JSON.parse(text);
                if (data && typeof data === "object" && typeof (data as any).error === "string") {
                  message = (data as any).error;
                } else {
                  message = text;
                }
              } catch {
                message = text;
              }
            }
          } catch {
          }
          setError(message);
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        const remoteWork = json.work as ScienceArtifact;
        const remoteMessages = (json.messages as ChatMessage[]) || [];
        setWorks(prev => {
          const exists = prev.some(w => w.id === remoteWork.id);
          if (exists) {
            return prev.map(w => (w.id === remoteWork.id ? remoteWork : w));
          }
          return [remoteWork, ...prev];
        });
        setMessagesMap(prev => ({
          ...prev,
          [remoteWork.id]: remoteMessages
        }));
        setCurrentWorkId(remoteWork.id);
      } catch {
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, authUser, currentWorkId, works, onBackToLanding]);

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

  const handleCreateMenuClick = () => {
    if (activeMenu === 'create') {
      return;
    }
    handleCreateWork();
  };

  const navbarCenter = (
    <>
      <button
        onClick={handleHomeClick}
        className={
          activeMenu === 'works'
            ? "px-2 py-1 rounded-full bg-brand-600 text-white hover:bg-brand-500"
            : "px-2 py-1 rounded-full hover:bg-slate-800 hover:text-white"
        }
      >
        作品
      </button>
      <button
        onClick={handleCreateMenuClick}
        className={
          activeMenu === 'create'
            ? "px-3 py-1 rounded-full bg-brand-600 text-white hover:bg-brand-500"
            : "px-3 py-1 rounded-full hover:bg-slate-800 hover:text-white"
        }
      >
        创作
      </button>
    </>
  );

  const navbarRight = authUser ? (
    <>
      <span className="text-xs text-slate-300 max-w-[140px] truncate">
        {authUser.email}
      </span>
      <button
        onClick={handleSignOut}
        disabled={authLoading}
        className="px-3 py-1 rounded-full text-xs bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        退出登录
      </button>
    </>
  ) : (
    <>
      <button
        onClick={() => {
          setIsAuthPanelOpen(v => !v);
          setAuthError(null);
        }}
        className="px-3 py-1 rounded-full text-xs bg-brand-600 text-white hover:bg-brand-500"
      >
        登录 / 注册
      </button>
      {isAuthPanelOpen && (
        <div className="absolute right-0 top-10 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-xl p-4 z-30">
          <div className="flex mb-3 text-xs bg-slate-800 rounded-full overflow-hidden">
            <button
              onClick={() => {
                setAuthMode("login");
                setAuthError(null);
              }}
              className={`flex-1 py-1.5 ${authMode === "login" ? "bg-brand-600 text-white" : "text-slate-300"}`}
            >
              登录
            </button>
            <button
              onClick={() => {
                setAuthMode("signup");
                setAuthError(null);
              }}
              className={`flex-1 py-1.5 ${authMode === "signup" ? "bg-brand-600 text-white" : "text-slate-300"}`}
            >
              注册
            </button>
          </div>
          <div className="space-y-2">
            <div className="space-y-1">
              <div className="text-[11px] text-slate-300">邮箱</div>
              <input
                type="email"
                value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                className="w-full rounded-md bg-slate-800 border border-slate-700 px-2 py-1 text-xs text-slate-100 outline-none focus:border-brand-500"
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] text-slate-300">密码</div>
              <input
                type="password"
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                className="w-full rounded-md bg-slate-800 border border-slate-700 px-2 py-1 text-xs text-slate-100 outline-none focus:border-brand-500"
                placeholder="至少 6 位"
              />
            </div>
            {authMode === "signup" && (
              <div className="space-y-1">
                <div className="text-[11px] text-slate-300">确认密码</div>
                <input
                  type="password"
                  value={authPasswordConfirm}
                  onChange={e => setAuthPasswordConfirm(e.target.value)}
                  className="w-full rounded-md bg-slate-800 border border-slate-700 px-2 py-1 text-xs text-slate-100 outline-none focus:border-brand-500"
                  placeholder="再次输入密码"
                />
              </div>
            )}
            {authError && (
              <div className="text-[11px] text-red-400">
                {authError}
              </div>
            )}
            <button
              onClick={handleAuthSubmit}
              disabled={authLoading || !authEmail || !authPassword}
              className="w-full mt-1 px-3 py-1.5 rounded-md text-xs bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {authMode === "login" ? "登录" : "注册"}
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-200 overflow-hidden flex flex-col font-sans selection:bg-brand-500/30">
      <Navbar
        onLogoClick={onBackToLanding}
        center={navbarCenter}
        right={navbarRight}
      />

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

        <main className="flex-1 overflow-hidden relative flex flex-col transition-all duration-300">
          {activeWork ? (
            <div className="flex-1 min-h-0 relative">
              <ArtifactRenderer artifact={activeWork} onRuntimeError={handleRuntimeError} hideTitleBar />
            </div>
          ) : (
            <WorksList
              works={works}
              onSelect={handleSelectWork}
              onCreate={handleCreateWork}
              onDelete={handleDeleteWork}
              onDuplicate={handleDuplicateWork}
              currentUserId={authUser ? authUser.id : null}
            />
          )}
        </main>

        {/* Chat Sidebar (Conditional) */}
        {activeWork && isChatOpen && canEditActiveWork && (
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
        {activeWork && !isChatOpen && canEditActiveWork && (
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
  const [rootView, setRootView] = useState<RootView>(() => getInitialRootView());
  const [entryAction, setEntryAction] = useState<'none' | 'create' | 'viewWorks' | 'openAuth'>('none');

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(ROOT_VIEW_STORAGE_KEY, rootView);
  }, [rootView]);

  const handleBackToLanding = () => {
    setRootView('landing');
    setEntryAction('none');
  };

  const handleLandingCreate = () => {
    setRootView('create');
    setEntryAction('create');
  };

  const handleLandingViewWorks = () => {
    setRootView('viewWorks');
    setEntryAction('viewWorks');
  };

  if (rootView === 'landing') {
    return (
      <LandingPage
        onCreateClick={handleLandingCreate}
        onViewWorksClick={handleLandingViewWorks}
      />
    );
  }

  return (
    <AppErrorBoundary>
      <AppInner
        onBackToLanding={handleBackToLanding}
        entryAction={entryAction}
        onEntryActionConsumed={() => setEntryAction('none')}
      />
    </AppErrorBoundary>
  );
}
