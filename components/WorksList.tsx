import React, { useState } from 'react';
import { ScienceArtifact } from '../types';

interface WorksListProps {
  works: ScienceArtifact[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  currentUserId: string | null;
}

export const WorksList: React.FC<WorksListProps> = ({ works, onSelect, onCreate, onDelete, onDuplicate, currentUserId }) => {
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const t = {
    create: "新建作品",
    open: "打开",
    noWorks: "还没有作品",
    start: "创建一个全新的互动实验",
    created: "创建于",
    creator: "创建者",
    deleteTitle: "删除作品",
    deleteMsg: "确定要删除该作品吗？此操作无法撤销。",
    cancel: "取消",
    confirm: "删除",
    duplicate: "做同款"
  };

  const maskEmail = (email: string) => {
    const parts = email.split("@");
    if (parts.length !== 2) return email;
    const name = parts[0];
    const domain = parts[1];
    if (name.length <= 2) {
      return name[0] + "**@" + domain;
    }
    const head = name[0];
    const tail = name[name.length - 1];
    return `${head}**${tail}@${domain}`;
  };

  const handleDeleteRequest = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteId(id);
  };

  const handleConfirmDelete = () => {
    if (deleteId) {
      onDelete(deleteId);
      setDeleteId(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-8 overflow-y-auto h-full relative">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-4">
        {/* Create Card */}
        <div 
            onClick={onCreate}
            className="group cursor-pointer bg-slate-900/50 border-2 border-dashed border-slate-700 rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:border-brand-500/50 hover:bg-slate-800 transition-all min-h-[250px]"
        >
             <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4 group-hover:bg-brand-500/20 group-hover:text-brand-400 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
             </div>
             <h3 className="text-lg font-semibold text-slate-300 group-hover:text-white">{t.create}</h3>
             <p className="text-slate-500 text-sm mt-2">{t.start}</p>
        </div>

        {works.map((work) => {
          const isOwner = !!currentUserId && work.ownerId === currentUserId;
          return (
          <div 
            key={work.id} 
            className="bg-slate-850 border border-slate-700 rounded-2xl p-6 flex flex-col hover:border-slate-500 transition-all group shadow-lg hover:shadow-xl min-h-[250px] relative"
          >
            {isOwner && (
            <button 
                onClick={(e) => handleDeleteRequest(e, work.id)}
                className="absolute top-4 right-4 p-2 text-slate-600 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors opacity-0 group-hover:opacity-100 z-10"
                title={t.confirm}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
            )}

            <div className="mb-4 pr-8">
                <div className="flex justify-between items-start">
                    <h3 className="text-xl font-bold text-white mb-2 line-clamp-1 group-hover:text-brand-400 transition-colors">{work.title}</h3>
                </div>
                <p className="text-slate-400 text-sm line-clamp-3 leading-relaxed">
                    {work.description}
                </p>
            </div>
            
            <div className="mt-auto pt-4 border-t border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-600 font-mono">
                    {t.created}: {new Date(work.createdAt).toLocaleDateString()}
                    {work.ownerEmail && (
                      <span className="ml-2">
                        {t.creator}: {maskEmail(work.ownerEmail)}
                      </span>
                    )}
                </span>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => onDuplicate(work.id)}
                    className="text-sm bg-slate-900 hover:bg-slate-800 text-slate-200 px-3 py-2 rounded-lg transition-colors border border-slate-700 hover:border-slate-600"
                  >
                    {t.duplicate}
                  </button>
                  <button 
                    onClick={() => onSelect(work.id)}
                    className="text-sm bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg transition-colors border border-slate-700 hover:border-slate-600"
                  >
                    {t.open}
                  </button>
                </div>
            </div>
          </div>
        );
        })}
      </div>

      {/* Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-fade-in-up">
            <h3 className="text-xl font-bold text-white mb-2">{t.deleteTitle}</h3>
            <p className="text-slate-400 mb-6 text-sm leading-relaxed">{t.deleteMsg}</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                {t.cancel}
              </button>
              <button 
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors shadow-lg shadow-red-500/20"
              >
                {t.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
