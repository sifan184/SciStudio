import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ModelConfig } from '../types';
import * as Lucide from 'lucide-react';
// @ts-ignore
import * as KaTeX from 'katex';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  models: ModelConfig[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onUpdateModel: (id: string, updates: Partial<ModelConfig>) => void;
  onGenerate: (prompt: string, images: string[]) => Promise<void>;
  isGenerating: boolean;
  onClose: () => void;
}

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

// Modal Component for Configuring Models
const ConfigModelModal = ({ 
    model, 
    onClose, 
    onSave 
}: { 
    model: ModelConfig, 
    onClose: () => void, 
    onSave: (updates: Partial<ModelConfig>) => void 
}) => {
  const [apiKey, setApiKey] = useState(model.apiKey || '');

  const handleSubmit = () => {
    onSave({ apiKey: apiKey });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 w-full max-w-md rounded-xl shadow-2xl border border-slate-700 flex flex-col overflow-hidden text-sm animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-4 border-b border-slate-800 bg-slate-950/50">
          <span className="text-slate-200 font-bold text-base flex items-center gap-2">
             <Lucide.Settings2 size={16} className="text-brand-500"/> 配置模型
          </span>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <Lucide.X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          
          {/* Info */}
          <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-slate-500 text-xs font-medium uppercase tracking-wider">服务商</label>
                <div className="w-full bg-slate-800/50 text-slate-400 border border-slate-700/50 rounded-lg px-3 py-2 text-xs font-mono">
                    {model.provider}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-slate-500 text-xs font-medium uppercase tracking-wider">模型 ID</label>
                <div className="w-full bg-slate-800/50 text-slate-400 border border-slate-700/50 rounded-lg px-3 py-2 text-xs font-mono truncate" title={model.modelId}>
                    {model.modelId}
                </div>
              </div>
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <label className="block text-brand-400 font-medium flex items-center justify-between">
                <span>API 密钥</span>
                <span className="text-[10px] text-slate-500 font-normal">可选 (覆盖环境变量)</span>
            </label>
            <div className="relative">
                <input 
                  type="password" 
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-slate-950 text-slate-200 border border-slate-700 rounded-lg px-3 py-2.5 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/50 placeholder-slate-600 font-mono transition-all"
                />
                <Lucide.Key className="absolute right-3 top-2.5 text-slate-600" size={16} />
            </div>
            <p className="text-[10px] text-slate-500 leading-tight">
                此 Key 将保存在浏览器 localStorage 中，仅用于本地调用，请勿在不可信环境中填写真实生产密钥。
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 pt-0 flex justify-end gap-3">
           <button 
            onClick={onClose}
            className="px-4 py-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            取消
          </button>
          <button 
            onClick={handleSubmit}
            className="px-6 py-2 bg-brand-600 hover:bg-brand-500 text-white font-medium rounded-lg transition-all shadow-lg shadow-brand-500/20"
          >
            保存配置
          </button>
        </div>

      </div>
    </div>
  );
};

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
    messages, 
    onGenerate, 
    isGenerating, 
    onClose,
    models,
    selectedModelId,
    onSelectModel,
    onUpdateModel
}) => {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]); // Base64 strings
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [thinkingElapsedMs, setThinkingElapsedMs] = useState(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const MAX_IMAGES = 3;

  const t = {
    title: "AI 助手",
    placeholder: "输入指令或粘贴图片 (Ctrl+V)...",
    thinking: "思考中..."
  };

  const selectedModel = models.find(m => m.id === selectedModelId) || models[0];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    let timer: number | null = null;
    if (isGenerating) {
      const start = Date.now();
      setThinkingElapsedMs(0);
      timer = window.setInterval(() => {
        setThinkingElapsedMs(Date.now() - start);
      }, 100);
    } else {
      setThinkingElapsedMs(0);
    }
    return () => {
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [isGenerating]);

  useEffect(() => {
    if (!inputRef.current) return;
    const el = inputRef.current;
    const maxHeight = 200;
    el.style.height = 'auto';
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
  }, [input]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!input.trim() && images.length === 0) || isGenerating) return;

    const prompt = input;
    const currentImages = images;

    setInput('');
    setImages([]);
    
    await onGenerate(prompt, currentImages);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Common file processor for both Select and Paste events
  const processFiles = (files: File[]) => {
    const remainingSlots = MAX_IMAGES - images.length;
    if (remainingSlots <= 0) return;

    // Take only as many files as allowed
    const filesToProcess = files.slice(0, remainingSlots);

    filesToProcess.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
          const result = reader.result as string;
          setImages(prev => {
              if (prev.length >= MAX_IMAGES) return prev;
              return [...prev, result];
          });
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files));
    }
    // Reset input so same file can be selected again if removed
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files: File[] = [];
    
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
            const file = items[i].getAsFile();
            if (file) files.push(file);
        }
    }

    if (files.length > 0) {
        e.preventDefault(); // Stop binary string from pasting into textarea
        processFiles(files);
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const isImageLimitReached = images.length >= MAX_IMAGES;

  return (
    <>
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800">
      
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur flex-shrink-0">
        <div className="flex items-center gap-2">
           <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <span className="text-brand-500">✨</span> {t.title}
           </h2>
           <div className={`w-2 h-2 rounded-full ${isGenerating ? 'bg-amber-400 animate-pulse' : 'bg-green-500'}`}></div>
        </div>
        
        <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1 hover:bg-slate-800 rounded-md">
          <Lucide.X size={18} />
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex flex-col max-w-[90%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                
                {/* Images in History */}
                {msg.images && msg.images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2 justify-end">
                        {msg.images.map((img, idx) => (
                            <img key={idx} src={img} className="h-24 w-auto rounded-lg border border-slate-700 object-cover" alt="User upload" />
                        ))}
                    </div>
                )}

                <div className={`rounded-2xl p-3 text-sm leading-relaxed ${
                msg.role === 'user' 
                    ? 'bg-brand-600 text-white rounded-br-none' 
                    : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-none'
                }`}>
                <div dangerouslySetInnerHTML={renderTextWithKaTeX(msg.text)} />
                </div>
            </div>
          </div>
        ))}
        
        {isGenerating && (
          <div className="flex justify-start">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl rounded-bl-none p-3 flex items-center gap-2">
              <div className="flex space-x-1">
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-0"></div>
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150"></div>
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-300"></div>
              </div>
              <span className="text-xs text-slate-400">
                {t.thinking}
                {thinkingElapsedMs > 0 && (
                  <span className="ml-1">
                    {(thinkingElapsedMs / 1000).toFixed(1)}s
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-slate-800 bg-slate-900 flex-shrink-0 z-20">
          <div className="bg-slate-950 border border-slate-700 rounded-xl flex flex-col focus-within:border-slate-600 transition-colors">
              
              {/* Image Previews in Input */}
              {images.length > 0 && (
                <div className="flex gap-2 p-3 pb-0 overflow-x-auto">
                    {images.map((img, i) => (
                        <div key={i} className="relative group flex-shrink-0">
                            <img src={img} alt="preview" className="h-16 w-16 object-cover rounded-md border border-slate-700" />
                            <button 
                                onClick={() => removeImage(i)}
                                className="absolute -top-1.5 -right-1.5 bg-slate-800 text-slate-400 hover:text-white rounded-full p-0.5 border border-slate-600 shadow-sm"
                            >
                                <Lucide.X size={12} />
                            </button>
                        </div>
                    ))}
                    {images.length < MAX_IMAGES && (
                        <div className="h-16 w-12 border border-dashed border-slate-700 rounded-md flex items-center justify-center text-slate-600 text-xs">
                             {images.length}/{MAX_IMAGES}
                        </div>
                    )}
                </div>
              )}

              <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={t.placeholder}
                  className="w-full bg-transparent text-slate-200 text-sm p-3 focus:outline-none resize-none min-h-[64px] max-h-[200px]"
                  rows={1}
                  ref={inputRef}
                  disabled={isGenerating}
              />
              
              {/* Toolbar */}
              <div className="flex items-center justify-between px-2 pb-2 mt-1">
                  <div className="flex items-center gap-1">
                      {/* Image Upload */}
                      <button 
                        onClick={() => !isImageLimitReached && fileInputRef.current?.click()}
                        className={`p-1.5 rounded-md transition-colors ${
                            isImageLimitReached 
                            ? 'text-slate-600 cursor-not-allowed' 
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                        }`}
                        title={isImageLimitReached ? "图片上限已满 (3/3)" : "上传图片"}
                      >
                          <Lucide.Image size={18} />
                      </button>
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileSelect} 
                        className="hidden" 
                        accept="image/*" 
                        multiple 
                        disabled={isImageLimitReached}
                      />

                       {/* Model Selector */}
                       <div className="relative ml-2">
                        <button 
                          onClick={() => setShowModelMenu(!showModelMenu)}
                          className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-900 border border-slate-700 hover:border-slate-600 px-2 py-1 rounded-md transition-all"
                        >
                            <span className="truncate max-w-[100px]">{selectedModel.name}</span>
                            <Lucide.ChevronDown size={12} />
                        </button>
                        
                        {showModelMenu && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowModelMenu(false)} />
                            <div className="absolute bottom-full left-0 mb-2 w-56 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-20 overflow-hidden py-1">
                               <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 mb-1">
                                  <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">选择模型</span>
                                  <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowConfigModal(true);
                                        setShowModelMenu(false);
                                    }}
                                    className="text-slate-500 hover:text-brand-400 transition-colors p-0.5 rounded hover:bg-slate-800"
                                    title="配置 API Key"
                                  >
                                      <Lucide.Settings2 size={14} />
                                  </button>
                               </div>
                               {models.map(m => (
                                 <button
                                   key={m.id}
                                   onClick={() => { onSelectModel(m.id); setShowModelMenu(false); }}
                                   className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-800 transition-colors flex justify-between items-center ${selectedModelId === m.id ? 'text-brand-400 bg-slate-800/30' : 'text-slate-300'}`}
                                 >
                                    <span>{m.name}</span>
                                    {selectedModelId === m.id && <Lucide.Check size={12} />}
                                 </button>
                               ))}
                            </div>
                          </>
                        )}
                      </div>
                  </div>

                  <button 
                      onClick={() => handleSubmit()}
                      disabled={isGenerating || (!input.trim() && images.length === 0)}
                      className={`p-1.5 rounded-lg transition-colors flex items-center justify-center ${
                         (!input.trim() && images.length === 0) || isGenerating 
                         ? 'bg-slate-800 text-slate-600 cursor-not-allowed' 
                         : 'bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-500/20'
                      }`}
                  >
                      <Lucide.ArrowUp size={18} />
                  </button>
              </div>
          </div>
      </div>
    </div>
    
    {/* Config Model Modal */}
    {showConfigModal && (
        <ConfigModelModal 
            model={selectedModel}
            onClose={() => setShowConfigModal(false)}
            onSave={(updates) => onUpdateModel(selectedModel.id, updates)}
        />
    )}
    </>
  );
};
