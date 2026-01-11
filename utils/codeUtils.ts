export const sanitizeCode = (code: string): string => {
  let cleanCode = code;
  
  // Remove all import statements (single and multi-line)
  cleanCode = cleanCode.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');
  cleanCode = cleanCode.replace(/^\s*import\s+['"][^'"]+['"];?/gm, '');

  // Remove export default and named exports
  cleanCode = cleanCode.replace(/^\s*export\s+default\s+/gm, '');
  cleanCode = cleanCode.replace(/^\s*export\s+/gm, '');

  cleanCode = cleanCode.replace(/^\s*(const|let|var)\s+\w+\s*=\s*require\(['"][^'"]+['"]\);\s*$/gm, '');
  cleanCode = cleanCode.replace(/^\s*require\(['"][^'"]+['"]\);\s*$/gm, '');

  cleanCode = cleanCode.replace(/\bReact\.useRef\s*\(/g, 'useRef(');
  cleanCode = cleanCode.replace(/\bReact\.useState\s*\(/g, 'useState(');
  cleanCode = cleanCode.replace(/\bReact\.useEffect\s*\(/g, 'useEffect(');
  cleanCode = cleanCode.replace(/\bReact\.useMemo\s*\(/g, 'useMemo(');
  cleanCode = cleanCode.replace(/\bReact\.useCallback\s*\(/g, 'useCallback(');
  cleanCode = cleanCode.replace(/\bReact\.forwardRef\s*\(/g, 'forwardRef(');

  return cleanCode;
};

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export interface SceneLintResult {
  isOk: boolean;
  issues: string[];
}

export interface SafetyLintResult {
  isOk: boolean;
  issues: string[];
}

const findUndeclaredRefVariables = (code: string): string[] => {
  const refUsageRegex = /([A-Za-z_$][A-Za-z0-9_$]*Ref)\b/g;
  const found = new Set<string>();
  let match;

  while ((match = refUsageRegex.exec(code)) !== null) {
    found.add(match[1]);
  }

  const undeclared: string[] = [];
  found.forEach((name) => {
    if (name === 'useRef' || name === 'forwardRef') {
      return;
    }
    const declRegex = new RegExp(`\\b(const|let|var)\\s+${name}\\b`);
    if (!declRegex.test(code)) {
      undeclared.push(name);
    }
  });

  return undeclared;
};

export const validateCode = (code: string): ValidationResult => {
  try {
    if (code.includes('Error: Could not parse code from AI response.')) {
      return {
        isValid: false,
        error: 'AI response did not contain any parsable JSX code. Please re-generate with a proper component.'
      };
    }

    const cleanCode = sanitizeCode(code);
    const undeclaredRefs = findUndeclaredRefVariables(cleanCode);
    if (undeclaredRefs.length > 0) {
      return {
        isValid: false,
        error: `Detected possibly undeclared ref variables: ${undeclaredRefs.join(', ')}`
      };
    }

    const babelRuntime =
      typeof window !== 'undefined' && (window as any).Babel
        ? (window as any).Babel
        : null;

    if (!babelRuntime || typeof babelRuntime.transform !== 'function') {
      return {
        isValid: false,
        error: 'Babel runtime is not available for code validation.'
      };
    }

    const transpiled = babelRuntime.transform(cleanCode, {
      presets: ['react', 'es2017', 'typescript'],
      parserOpts: { allowReturnOutsideFunction: true },
      filename: 'validation.tsx'
    }).code;

    const funcBody = [
      'try {',
      transpiled,
      '} catch (e) {}'
    ].join('\n');

    new Function(
      'React',
      'Recharts',
      'Lucide',
      'THREE',
      'R3F',
      'Drei',
      'Physics',
      'Motion',
      'MathJS',
      funcBody
    );

    return { isValid: true };
  } catch (err: any) {
    return {
      isValid: false,
      error: err.message || err.toString()
    };
  }
};

const isProbably3DScene = (code: string): boolean => {
  if (!code) return false;
  if (code.includes('R3F.Canvas')) return true;
  if (code.includes('<mesh') || code.includes('<sphereGeometry') || code.includes('<boxGeometry')) return true;
  if (code.includes('Drei.OrbitControls') || code.includes('Drei.Stars') || code.includes('Drei.Environment')) return true;
  return false;
};

export const lint3DScene = (code: string): SceneLintResult => {
  if (!isProbably3DScene(code)) {
    return { isOk: true, issues: [] };
  }

  const issues: string[] = [];

  const hasLight =
    /ambientLight/.test(code) ||
    /directionalLight/.test(code) ||
    /pointLight/.test(code) ||
    /spotLight/.test(code) ||
    /Drei\.Environment/.test(code);

  if (!hasLight) {
    issues.push('当前场景缺少光源，物体可能过暗。建议添加 ambientLight 和 Drei.Environment。');
  }

  const hasControls =
    /Drei\.OrbitControls/.test(code) ||
    /Drei\.TrackballControls/.test(code) ||
    /Drei\.FlyControls/.test(code);

  if (!hasControls) {
    issues.push('当前 3D 场景缺少交互控制。建议添加 Drei.OrbitControls 或合适的摄像机控制。');
  }

  const meshMatches = code.match(/<mesh[\s>]/g);
  const meshCount = meshMatches ? meshMatches.length : 0;
  const mentionsComplexSystem = /系统|多体|轨道|planet|system|field/i.test(code);

  if (meshCount <= 1 && mentionsComplexSystem) {
    issues.push('当前 3D 结构过于简单，与“系统/多体/复杂结构”描述不符。建议增加更多结构化几何体或使用高层组件。');
  }

  return {
    isOk: issues.length === 0,
    issues
  };
};

export const lintSafetyAndPerformance = (code: string): SafetyLintResult => {
  if (!code) {
    return { isOk: true, issues: [] };
  }

  const issues: string[] = [];

  if (/\bwhile\s*\(\s*true\s*\)/.test(code) || /\bfor\s*\(\s*;\s*;\s*\)/.test(code)) {
    issues.push('检测到可能的无限循环结构（如 while(true) 或 for(;;)）。请使用有限步长或基于时间步进的更新方式。');
  }

  if (/\bdocument\./.test(code) || /\bwindow\./.test(code)) {
    issues.push('检测到对 window 或 document 的直接访问。请避免直接操作全局对象，改用 React 状态、props 或已提供的可视化组件。');
  }

  if (/\bfetch\s*\(/.test(code) || /\bXMLHttpRequest\b/.test(code)) {
    issues.push('检测到网络请求调用。当前环境不建议在可视化组件内部直接发起网络请求，请改为使用静态或模拟数据。');
  }

  const largeLoopPattern = /\bfor\s*\(\s*let\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*(\d{5,})/;
  const largeLoopMatch = code.match(largeLoopPattern);
  if (largeLoopMatch) {
    issues.push('检测到包含大量迭代次数的 for 循环，可能导致性能问题。请降低迭代次数或使用更高效的数据结构。');
  }

  if (/\bsetInterval\s*\(/.test(code)) {
    issues.push('检测到 setInterval 调用。请优先使用 R3F.useFrame 或基于 requestAnimationFrame 的受控更新，并注意在组件卸载时清理定时器。');
  }

  return {
    isOk: issues.length === 0,
    issues
  };
};
