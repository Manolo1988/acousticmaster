
export enum Scenario {
  MEETING_ROOM = 'MEETING_ROOM',
  LECTURE_HALL = 'LECTURE_HALL'
}

export enum Page {
  SOLUTION = 'SOLUTION',
  MANAGEMENT = 'MANAGEMENT',
  HISTORY = 'HISTORY'
}

export enum SolutionTab {
  DESIGN = 'DESIGN',
  VERIFICATION = 'VERIFICATION'
}

export enum ResultTab {
  PLAN = 'PLAN',
  SIMULATION = 'SIMULATION',
  REPORT = 'REPORT'
}

export interface MicConfig {
  id: string;
  type: string;
  count: number;
}

export interface AcousticParams {
  length: number;
  width: number;
  height: number;
  stageToNearAudience?: number;
  stageToFarAudience?: number;
  stageWidth?: number;
  stageDepth?: number;
  hasCentralControl: boolean;
  hasMatrix: boolean;
  hasVideoConf: boolean;
  hasRecording: boolean;
  mics: MicConfig[];
  extraRequirements: string;
}

export interface EquipmentItem {
  id: string;
  type: string;      // 类型
  name: string;      // 产品名称
  model: string;     // 型号
  quantity: number;  // 数量
}

export interface SolutionResult {
  id: string;
  title: string;
  items: EquipmentItem[];
  wordLink?: string;
  excelLink?: string;
  isGenerating?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  timestamp: Date;
}

export interface DesignState {
  projectName: string;
  scenario: Scenario;
  params: AcousticParams;
  blueprint: string | null;
  isDesigned: boolean;
  chatHistory: ChatMessage[];
  results: SolutionResult[];
  activeResultIndex: number;
}

export interface HistoryItem {
  id: string;
  type: string;
  name: string;
  date: string;
  status: string;
  scenario: Scenario;
  params: AcousticParams;
  results: SolutionResult[];
}

export type EquipmentCategory = '音箱' | '功放' | '中控' | '矩阵' | '视频会议' | '录播' | '话筒';

export interface Equipment {
  id: string;
  category: EquipmentCategory;
  brand: string;
  model: string;
  specs: string;
}
