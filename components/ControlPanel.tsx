import React from 'react';
import { VariableDefinition } from '../types';

interface ControlPanelProps {
  variables: VariableDefinition[];
  values: Record<string, number>;
  onChange: (id: string, val: number) => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ variables, values, onChange }) => {
  const title = "实验控制台";

  return (
    <div className="bg-slate-850 border border-slate-700 rounded-xl p-5 shadow-lg flex flex-col gap-6">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-2 bg-brand-600 rounded-lg">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white"><line x1="4" x2="20" y1="21" y2="21"/><line x1="4" x2="20" y1="3" y2="3"/><line x1="4" x2="20" y1="12" y2="12"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="3" r="2"/><circle cx="12" cy="21" r="2"/></svg>
        </div>
        <h2 className="text-xl font-bold text-white">{title}</h2>
      </div>

      {variables.length === 0 && (
          <div className="text-slate-500 text-sm italic">
              暂无控制变量
          </div>
      )}

      {variables.map((v) => (
        <div key={v.id} className="group">
          <div className="flex justify-between items-end mb-2">
            <label className="text-slate-300 font-medium text-sm flex items-center gap-2">
              {v.label}
              {v.description && (
                <span className="text-slate-500 text-xs font-normal hidden group-hover:inline transition-opacity">
                   - {v.description}
                </span>
              )}
            </label>
            <span className="text-brand-500 font-mono font-bold bg-brand-500/10 px-2 py-0.5 rounded text-sm">
              {values[v.id]} {v.unit}
            </span>
          </div>
          <input
            type="range"
            min={v.min}
            max={v.max}
            step={v.step}
            value={values[v.id] || v.defaultValue}
            onChange={(e) => onChange(v.id, parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-brand-500 hover:accent-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
          />
          <div className="flex justify-between text-xs text-slate-500 mt-1 font-mono">
            <span>{v.min}</span>
            <span>{v.max}</span>
          </div>
        </div>
      ))}
    </div>
  );
};