
// The Schema that Gemini Generates
export type Language = 'zh' | 'en';

export interface ScienceArtifact {
  id: string;
  createdAt: number;
  title: string;
  description: string;
  code: string;
  ownerId?: string;
  ownerEmail?: string | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  images?: string[]; // Base64 encoded image strings
}

export type PlanningTaskType =
  | 'process_explanation'
  | 'data_dashboard'
  | 'timeline'
  | 'micro_structure'
  | 'simulation'
  | 'other';

export type VisualStrategyType =
  | 'r3f_3d_only'
  | 'chart_dashboard'
  | 'timeline_with_cards'
  | 'r3f_plus_chart'
  | 'infographic_like'
  | 'auto';

export type PlanningViewKind =
  | 'r3f_scene'
  | 'recharts_chart'
  | 'timeline'
  | 'text_panel'
  | 'infographic';

export interface PlanningView {
  id: string;
  kind: PlanningViewKind;
  role?: string; // 中文说明用途，例如“主物理场景”“侧边数据图表”
  linksTo?: string[]; // 视图之间的联动关系
}

export interface PlanningMetadata {
  reply: string;
  title: string;
  description: string;
  taskType?: PlanningTaskType;
  visualStrategy?: VisualStrategyType;
  views?: PlanningView[];
  sceneDsl?: any;
  // 允许模型在规划阶段输出更多补充字段
  [key: string]: any;
}

export interface GenerationResponse {
  artifact: ScienceArtifact;
  reply: string;
  planning?: PlanningMetadata | null;
}

// Model Configuration
export interface ModelConfig {
  id: string;
  provider: 'Google' | 'OpenAI' | 'Anthropic' | string; // Extendable
  name: string; // Display name
  modelId: string; // API model string (e.g., gemini-1.5-pro)
  apiKey?: string; // Optional per model override
}

// UI Component Types
export interface VariableDefinition {
  id: string;
  label: string;
  description?: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
}

export interface ChartConfig {
  xMin: number;
  xMax: number;
  step: number;
  formulaY: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

export interface HeatmapConfig {
  formulaIntensity: string;
}

export type WidgetType = 'chart' | 'heatmap';

export interface Widget {
  id: string;
  type: WidgetType;
  config: ChartConfig | HeatmapConfig;
}
