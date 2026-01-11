import React from 'react';
import { ParticleBackground } from './ParticleBackground';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { INITIAL_ARTIFACT, ADDITIONAL_WORKS } from '../constants';
import { ArtifactRenderer } from './ArtifactRenderer';
import { ScienceArtifact } from '../types';
import { Navbar } from './Navbar';

interface LandingPageProps {
  onCreateClick: () => void;
  onViewWorksClick: () => void;
}

interface SamplePreviewCardProps {
  artifact: ScienceArtifact;
  onViewWorksClick: () => void;
}

const SamplePreviewCard: React.FC<SamplePreviewCardProps> = ({ artifact, onViewWorksClick }) => (
  <motion.div
    whileHover={{ scale: 1.02, translateY: -4 }}
    className="group rounded-2xl border border-slate-700/70 bg-slate-900/80 backdrop-blur-sm shadow-lg cursor-pointer overflow-hidden flex flex-col"
    onClick={onViewWorksClick}
  >
    <div className="relative w-full aspect-video bg-slate-950">
      <div className="absolute inset-0">
        <ArtifactRenderer artifact={artifact} hideTitleBar />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-slate-950/90 to-transparent opacity-80 group-hover:opacity-40 transition-opacity" />
    </div>
  </motion.div>
);

type LandingPendingAction = 'none' | 'create' | 'viewWorks';

export const LandingPage: React.FC<LandingPageProps> = ({ onCreateClick, onViewWorksClick }) => {
  interface AuthUser {
    id: string;
    email: string | null;
  }
  const allWorks = [INITIAL_ARTIFACT, ...ADDITIONAL_WORKS];
  const totalWorks = allWorks.length;
  const sampleWorks = allWorks.slice(0, 3);
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const [activeSampleIndex, setActiveSampleIndex] = React.useState(0);
  const [isAuthOpen, setIsAuthOpen] = React.useState(false);
  const [authMode, setAuthMode] = React.useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = React.useState("");
  const [authPassword, setAuthPassword] = React.useState("");
  const [authPasswordConfirm, setAuthPasswordConfirm] = React.useState("");
  const [authLoading, setAuthLoading] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [pendingAction, setPendingAction] = React.useState<LandingPendingAction>('none');
  const [authUser, setAuthUser] = React.useState<AuthUser | null>(null);
  const authPanelRef = React.useRef<HTMLDivElement | null>(null);

  const scrollToSample = (index: number) => {
    const container = scrollContainerRef.current;
    if (!container || sampleWorks.length === 0) return;
    const clamped = Math.max(0, Math.min(sampleWorks.length - 1, index));
    const child = container.children[clamped] as HTMLElement | undefined;
    if (!child) return;
    setActiveSampleIndex(clamped);
    container.scrollTo({
      left: child.offsetLeft,
      behavior: 'smooth',
    });
  };

  React.useEffect(() => {
    scrollToSample(0);
  }, []);

  React.useEffect(() => {
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
      }
    };
    loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  const openAuth = (mode: "login" | "signup", message: string | null, action: LandingPendingAction) => {
    setAuthMode(mode);
    setAuthError(message);
    setPendingAction(action);
    setIsAuthOpen(true);
  };

  const checkLoginBefore = async (action: LandingPendingAction) => {
    if (action === 'none') {
      return;
    }
    if (authUser) {
      if (action === 'create') {
        onCreateClick();
      } else if (action === 'viewWorks') {
        onViewWorksClick();
      }
      return;
    }
    try {
      const res = await fetch("/api/auth/user", {
        credentials: "include"
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.user) {
          if (action === 'create') {
            onCreateClick();
          } else if (action === 'viewWorks') {
            onViewWorksClick();
          }
          return;
        }
      }
    } catch {
    }
    const message =
      action === 'create'
        ? "请先登录后再创建作品"
        : "请先登录后再查看作品";
    openAuth("login", message, action);
  };

  const handleAuthSubmit = async () => {
    if (!authEmail || !authPassword) {
      return;
    }
    setAuthError(null);
    setAuthLoading(true);
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
        setAuthError(messageFromJson || "认证失败，请稍后重试");
        return;
      }
      const user =
        data && typeof data === "object" && "user" in data
          ? (data as any).user
          : null;
      setAuthUser(user ?? null);
      setIsAuthOpen(false);
      setAuthEmail("");
      setAuthPassword("");
      setAuthPasswordConfirm("");
      setAuthError(null);
      if (pendingAction === 'create') {
        onCreateClick();
      } else if (pendingAction === 'viewWorks') {
        onViewWorksClick();
      }
      setPendingAction('none');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setAuthError(`认证请求失败：${message}`);
    } finally {
      setAuthLoading(false);
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
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setAuthError(message);
    }
  };

  React.useEffect(() => {
    if (!isAuthOpen) return;
    const handleClick = (e: MouseEvent | TouchEvent) => {
      const panel = authPanelRef.current;
      if (!panel) return;
      const target = e.target as Node | null;
      if (target && panel.contains(target)) return;
      setIsAuthOpen(false);
      setAuthError(null);
      setPendingAction('none');
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, [isAuthOpen]);

  return (
    <div className="relative w-full min-h-screen overflow-hidden text-white font-sans selection:bg-blue-500/30">
      <ParticleBackground />

      <div className="relative z-10 flex flex-col min-h-screen">
        <Navbar
          right={
            authUser ? (
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
                    setIsAuthOpen(prev => {
                      const next = !prev;
                      if (!next) {
                        setAuthError(null);
                        setPendingAction('none');
                      } else {
                        setAuthMode("login");
                      }
                      return next;
                    });
                  }}
                  className="px-3 py-1 rounded-full text-xs bg-brand-600 text-white hover:bg-brand-500"
                >
                  登录
                </button>
                {isAuthOpen && (
                  <div
                    ref={authPanelRef}
                    className="absolute right-0 top-10 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-xl p-4 z-30"
                  >
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
            )
          }
        />

        <main className="flex-1 flex flex-col items-center px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="w-full max-w-4xl mx-auto text-center mt-16 sm:mt-20"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="inline-flex items-center gap-2 px-3 py-1 mb-5 text-sm font-medium rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20"
            >
              <Sparkles size={14} />
              <span>可交互式科普动画 创作平台</span>
            </motion.div>

            <h1 className="mb-4 text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-200 via-indigo-200 to-purple-200 drop-shadow-sm">
              让科学原理
              <br className="sm:hidden" />
              <span className="text-white"> 触手可及</span>
            </h1>

  

            <div className="flex flex-wrap items-center justify-center gap-4 mb-10 text-sm text-slate-300">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl sm:text-4xl font-bold text-blue-200">
                  {totalWorks}+
                </span>
                <span className="text-slate-400">科普作品</span>
              </div>
          
            </div>

            <motion.button
              whileHover={{
                scale: 1.05,
                boxShadow: '0 0 20px rgba(59, 130, 246, 0.5)',
              }}
              whileTap={{ scale: 0.95 }}
              onClick={() => checkLoginBefore('create')}
              className="group relative inline-flex items-center justify-center gap-3 px-8 py-3.5 text-base sm:text-lg font-bold text-white transition-all duration-300 bg-brand-600 rounded-full hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-600 ring-offset-slate-950"
            >
              立即开始创作
              <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
              <div className="absolute inset-0 rounded-full bg-white/20 blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </motion.button>
          </motion.div>

          <motion.section
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.8 }}
            className="relative w-screen max-w-none -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 mt-16 mb-16"
          >
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
              <div>
                <h2 className="text-2xl sm:text-3xl font-semibold text-slate-50">
                  优秀作品
                </h2>
            
              </div>
              <button
                onClick={() => checkLoginBefore('viewWorks')}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium rounded-full border border-slate-700/80 bg-slate-900/80 text-slate-100 hover:border-brand-500 hover:text-white hover:bg-slate-900 transition-colors"
              >
                查看全部作品
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <div
                ref={scrollContainerRef}
                className="relative flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth horizontal-scroll-hide"
              >
                {sampleWorks.map((work) => (
                  <div
                    key={work.id}
                    className="snap-start flex-shrink-0 w-[90vw] sm:w-[80vw] md:w-[70vw] lg:w-[65vw] max-w-5xl"
                  >
                    <SamplePreviewCard
                      artifact={work}
                      onViewWorksClick={() => checkLoginBefore('viewWorks')}
                    />
                  </div>
                ))}
              </div>

              {sampleWorks.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => scrollToSample(activeSampleIndex - 1)}
                    disabled={activeSampleIndex <= 0}
                    className="hidden sm:flex items-center justify-center absolute top-1/2 -translate-y-1/2 -left-2 lg:-left-4 h-9 w-9 rounded-full border border-slate-700 bg-slate-900/80 text-slate-200 shadow-md hover:bg-slate-800 hover:border-slate-500 disabled:opacity-40 disabled:cursor-default"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollToSample(activeSampleIndex + 1)}
                    disabled={activeSampleIndex >= sampleWorks.length - 1}
                    className="hidden sm:flex items-center justify-center absolute top-1/2 -translate-y-1/2 -right-2 lg:-right-4 h-9 w-9 rounded-full border border-slate-700 bg-slate-900/80 text-slate-200 shadow-md hover:bg-slate-800 hover:border-slate-500 disabled:opacity-40 disabled:cursor-default"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </motion.section>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 1 }}
            className="pb-8 text-xs sm:text-sm text-slate-500"
          >
            © 2026 SciStudio AI. All rights reserved.
          </motion.div>
        </main>
      </div>
    </div>
  );
};
