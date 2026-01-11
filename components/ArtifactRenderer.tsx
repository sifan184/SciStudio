import React, { useState, useEffect, useRef, useMemo, useCallback, forwardRef } from 'react';
import * as Recharts from 'recharts';
import * as Lucide from 'lucide-react';
// @ts-ignore - Runtime imports via importmap
import * as Three from 'three';
// @ts-ignore
import * as ReactThreeFiber from '@react-three/fiber';
// @ts-ignore
import * as Drei from '@react-three/drei';
// @ts-ignore
import * as Cannon from '@react-three/cannon';
// @ts-ignore
import * as FramerMotion from 'framer-motion';
// @ts-ignore
import * as MathJS from 'mathjs';
// @ts-ignore
import * as KaTeX from 'katex';
// @ts-ignore
import * as Rapier from '@react-three/rapier';
// @ts-ignore
import * as PostProcessing from '@react-three/postprocessing';
import { create as createZustandStore } from 'zustand';

import { Sci3D } from '../utils/sci3d';
import { ScienceArtifact } from '../types';
import { sanitizeCode } from '../utils/codeUtils';

interface ArtifactRendererProps {
  artifact: ScienceArtifact;
  onRuntimeError?: (error: string) => void;
  hideTitleBar?: boolean;
}

// Helper to handle ESM default export wrapping
const normalizeModule = (mod: any) => {
  if (!mod) return mod;
  // If the module has no named exports other than default, or specifically for R3F/Drei structures
  // Check if we are trying to access named exports on the module but they are on default
  if (mod.default && !mod.Canvas && mod.default.Canvas) return mod.default; // R3F fix
  if (mod.default && !mod.OrbitControls && mod.default.OrbitControls) return mod.default; // Drei fix
  if (mod.default && !mod.motion && mod.default.motion) return mod.default; // Framer Motion fix
  if (mod.default && !mod.Physics && mod.default.Physics) return mod.default; // Cannon fix
  return mod;
};

const buildReactRuntime = () => {
  const base: any = (React as any).default || (React as any);
  const runtime: any = { ...base };
  if (useState) runtime.useState = useState;
  if (useEffect) runtime.useEffect = useEffect;
  if (useRef) runtime.useRef = useRef;
  if (useMemo) runtime.useMemo = useMemo;
  if (useCallback) runtime.useCallback = useCallback;
  return runtime;
};

const escapeHtml = (str: string) => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
};

const renderTextWithKaTeX = (text: string) => {
  if (!text) return { __html: '' };
  const parts: string[] = [];
  const regex = /\$\$(.+?)\$\$|\$(.+?)\$/gs;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const katexMod: any = (KaTeX as any).default || (KaTeX as any);

  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, matchIndex)));
    }

    const mathContent = match[1] ?? match[2];
    const displayMode = !!match[1];

    try {
      const html = katexMod.renderToString(mathContent, {
        displayMode,
        throwOnError: false
      });
      parts.push(html);
    } catch {
      parts.push(escapeHtml(match[0]));
    }

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)));
  }

  return { __html: parts.join('') };
};

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onError?: (error: string) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: string;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false, error: '' };

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: '' };
  }

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return { hasError: true, error: error.toString() };
  }

  componentDidCatch(error: any) {
    const message = error instanceof Error ? error.message : String(error);
    if (this.props.onError) {
      this.props.onError(message);
    }
  }

  render() {
    if (this.state.hasError) {
      const lucideAny = Lucide as any;
      const L = lucideAny.default || lucideAny;
      const Icon = L.AlertCircle || L.AlertTriangle || (() => <span>!</span>);
      
      return (
        <div className="p-6 bg-red-900/20 border border-red-500/50 rounded-xl m-4 text-red-200 font-mono text-sm whitespace-pre-wrap">
          <h3 className="font-bold text-red-400 mb-2 flex items-center gap-2">
            <Icon size={18} /> Runtime Error
          </h3>
          {this.state.error}
          <div className="mt-4 text-xs text-red-300 opacity-70">
            Click "Regenerate" or ask the AI to fix this error in the chat.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const ArtifactRenderer: React.FC<ArtifactRendererProps> = ({ artifact, onRuntimeError, hideTitleBar }) => {
  const [Component, setComponent] = useState<React.FC | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!artifact.code) return;

    try {
      setCompileError(null);
      
      // 1. Sanitize Code using shared utility
      const cleanCode = sanitizeCode(artifact.code);

      // 2. Transpile
      const babel = (window as any).Babel;
      if (!babel) {
        throw new Error("Babel compiler not loaded. Please refresh the page.");
      }

      const transpiled = babel.transform(cleanCode, {
        presets: ['react', 'es2017', 'typescript'],
        parserOpts: { allowReturnOutsideFunction: true },
        filename: 'artifact.tsx'
      }).code;

      // 3. Prepare Libraries (Normalize ESM imports)
      const safeR3F = normalizeModule(ReactThreeFiber);
      const safeDrei = normalizeModule(Drei);
      const safeMotion = normalizeModule(FramerMotion);
      const safeCannon = normalizeModule(Cannon);
      const safeKaTeX: any = (KaTeX as any).default || (KaTeX as any);
      const safeRapier = normalizeModule(Rapier);
      const safePostProcessing = normalizeModule(PostProcessing);
      const runtimeReact = buildReactRuntime();
      
      // 4. Construct Function
      // SAFETY: Use explicit string concatenation + newlines to avoid comment issues and template literal breakage
      const funcBody = [
        'try {',
        transpiled,
        '} catch (e) {',
        '  return () => React.createElement("div", {className: "text-red-500 p-4"}, "Initialization Error: " + e.message);',
        '}'
      ].join('\n');

      const createComponent = new Function(
        'React', 
        'Recharts', 
        'Lucide', 
        'THREE', 
        'R3F', 
        'Drei', 
        'Physics', 
        'Motion', 
        'MathJS',
        'KaTeX',
        'Rapier',
        'PostProcessing',
        'Zustand',
        'Sci3D',
        'useState',
        'useEffect',
        'useRef',
        'useMemo',
        'useCallback',
        'forwardRef',
        funcBody
      );

      const UserComponent = createComponent(
          runtimeReact, 
          Recharts, 
          Lucide, 
          Three, 
          safeR3F, 
          safeDrei, 
          safeCannon,
          safeMotion,
          MathJS,
          safeKaTeX,
          safeRapier,
          safePostProcessing,
          { create: createZustandStore },
          Sci3D,
          useState,
          useEffect,
          useRef,
          useMemo,
          useCallback,
          forwardRef
      );
      
      if (typeof UserComponent !== 'function') {
        throw new Error("Code did not return a valid React component function. Ensure the code ends with 'return ComponentName;'.");
      }

      setComponent(() => UserComponent);

    } catch (err: any) {
      console.error("Compilation Error:", err);
      setCompileError(err.toString());
    }
  }, [artifact.code]);

  const handleCopy = () => {
    navigator.clipboard.writeText(artifact.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Safe Icons with fallback for module structure variations
  const lucideAny = Lucide as any;
  const L = lucideAny.default || lucideAny; // Handle if Lucide is { default: { ... } } or { ... }
  
  const CopyIcon = L.Copy || L.Clipboard || (() => <span>C</span>);
  const CheckIcon = L.Check || (() => <span>OK</span>);
  const CodeIcon = L.Code || L.Code2 || (() => <span>&lt;/&gt;</span>);
  const HideIcon = L.EyeOff || L.Eye || (() => <span>O</span>);
  const XIcon = L.XCircle || L.X || (() => <span>X</span>);
  const LoaderIcon = L.Loader2 || L.Loader || (() => <span>...</span>);

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden relative">
      {!hideTitleBar && (
        <div className="w-full z-10 p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center shrink-0 shadow-sm">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">{artifact.title}</h1>
            <p
              className="text-slate-400 text-xs mt-1 max-w-3xl line-clamp-1"
              dangerouslySetInnerHTML={renderTextWithKaTeX(artifact.description)}
            />
          </div>
          
          <button 
            onClick={() => setShowCode(!showCode)}
            className={`ml-4 p-2 border rounded-lg transition-all flex-shrink-0 ${showCode ? 'bg-brand-600 border-brand-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800'}`}
            title={showCode ? "隐藏代码" : "显示代码"}
          >
            {showCode ? <HideIcon size={16} /> : <CodeIcon size={16} />}
          </button>
        </div>
      )}

       <div className="flex-1 w-full min-h-0 relative bg-slate-950/50">
          {showCode && !hideTitleBar && (
             <div className="absolute inset-0 z-20 bg-slate-900/95 backdrop-blur flex flex-col animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-950/50">
                    <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">Source Code</span>
                    <button 
                        onClick={handleCopy}
                        className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
                    >
                        {copied ? <CheckIcon size={14} className="text-green-400" /> : <CopyIcon size={14} />}
                        {copied ? '已复制' : '复制'}
                    </button>
                </div>
                <div className="flex-1 overflow-auto p-6">
                    <pre className="font-mono text-sm text-slate-300 whitespace-pre-wrap">{artifact.code}</pre>
                </div>
             </div>
          )}

          <div className="w-full h-full overflow-hidden">
            {compileError ? (
              <div className="p-6 mt-10 mx-4 bg-red-900/20 border border-red-500/50 rounded-xl text-red-200 font-mono text-sm">
                <h3 className="font-bold text-red-400 mb-2 flex items-center gap-2">
                  <XIcon size={18} /> Compilation Error
                </h3>
                {compileError}
              </div>
            ) : (
              <ErrorBoundary key={artifact.code} onError={onRuntimeError}>
                {Component ? <Component /> : <div className="p-20 text-slate-500 flex items-center justify-center gap-2"><LoaderIcon className="animate-spin" /> 加载中...</div>}
              </ErrorBoundary>
            )}
          </div>
       </div>
    </div>
  );
};
