import React, { useEffect, useRef, useState, useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Widget, ChartConfig, HeatmapConfig, VariableDefinition } from '../types';

// --- Helper: Safe Formula Evaluator ---
const evaluateFormula = (formula: string, scope: Record<string, number>) => {
  try {
    const keys = Object.keys(scope);
    const values = Object.values(scope);
    // Create a function with keys as arguments
    const func = new Function(...keys, `return ${formula};`);
    return func(...values);
  } catch (e) {
    console.warn(`Formula Eval Error: ${formula}`, e);
    return 0;
  }
};

// --- Widget: Line Chart ---
interface ChartWidgetProps {
  config: ChartConfig;
  variables: Record<string, number>;
}

export const ChartWidget: React.FC<ChartWidgetProps> = ({ config, variables }) => {
  const data = useMemo(() => {
    const points = [];
    // Generate X points
    for (let x = config.xMin; x <= config.xMax; x += config.step) {
      // Create scope with 'x' and all user variables
      const scope = { x, ...variables };
      const y = evaluateFormula(config.formulaY, scope);
      points.push({ x: parseFloat(x.toFixed(2)), y });
    }
    return points;
  }, [config, variables]);

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
          <XAxis 
            dataKey="x" 
            stroke="#94a3b8" 
            tick={{fontSize: 12}} 
            label={{ value: config.xAxisLabel, position: 'insideBottomRight', offset: -5, fill: '#94a3b8', fontSize: 10 }}
          />
          <YAxis 
            stroke="#94a3b8" 
            tick={{fontSize: 12}}
            label={{ value: config.yAxisLabel, angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 10 }} 
          />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc' }} 
            itemStyle={{ color: '#818cf8' }}
            formatter={(val: number) => val.toFixed(3)}
          />
          <Line 
            type="monotone" 
            dataKey="y" 
            stroke="#bef264" // Lime green for contrast
            strokeWidth={2} 
            dot={false} 
            activeDot={{ r: 6, fill: '#fff' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

// --- Widget: Heatmap Canvas (Simulates Screen) ---
interface HeatmapWidgetProps {
  config: HeatmapConfig;
  variables: Record<string, number>;
}

export const HeatmapWidget: React.FC<HeatmapWidgetProps> = ({ config, variables }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    // Simulate "x" from -20 to 20 across the width
    const xMin = -20;
    const xMax = 20;
    
    // We only compute 1D gradient usually for slits, but let's support 2D simply
    // Optimization: If formula doesn't use 'y', calculate row once.
    const isYDependent = config.formulaIntensity.includes('y');

    const rowBuffer = new Float32Array(width);
    
    // Pre-calculate X row if Y not involved
    if (!isYDependent) {
       for (let i = 0; i < width; i++) {
         const x = xMin + (i / width) * (xMax - xMin);
         const scope = { x, y: 0, ...variables };
         rowBuffer[i] = Math.max(0, Math.min(1, evaluateFormula(config.formulaIntensity, scope)));
       }
    }

    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        let intensity = 0;
        
        if (isYDependent) {
           const x = xMin + (i / width) * (xMax - xMin);
           const y = -10 + (j / height) * 20; // arbitrary y range
           const scope = { x, y, ...variables };
           intensity = Math.max(0, Math.min(1, evaluateFormula(config.formulaIntensity, scope)));
        } else {
           intensity = rowBuffer[i];
        }
        
        // Color mapping: Black to Yellow/White
        // Index mapping
        const index = (j * width + i) * 4;
        
        // Simple Yellow Laser Color (R: 255, G: 255, B: 0)
        // Adjust alpha based on intensity for a glow effect
        data[index] = 255;     // R
        data[index + 1] = 255; // G
        data[index + 2] = 0;   // B
        data[index + 3] = intensity * 255; // Alpha
      }
    }

    ctx.putImageData(imgData, 0, 0);

  }, [config, variables]);

  return (
    <div className="w-full h-48 bg-black rounded-lg border border-slate-700 overflow-hidden relative">
        <canvas 
            ref={canvasRef} 
            width={400} 
            height={200} 
            className="w-full h-full object-cover opacity-90 blur-[1px]" 
        />
        <div className="absolute bottom-2 left-2 text-xs text-slate-500 font-mono">-20mm</div>
        <div className="absolute bottom-2 right-2 text-xs text-slate-500 font-mono">+20mm</div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-slate-500 font-mono">0</div>
    </div>
  );
};