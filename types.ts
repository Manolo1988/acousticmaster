
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

export enum VerificationResultTab {
  REPORT = 'REPORT',
  MAP_3D = 'MAP_3D'
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
  extraRequirements: string; // 新增字段
}

export interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  timestamp: Date;
}

export interface DesignState {
  scenario: Scenario;
  params: AcousticParams;
  blueprint: string | null;
  isDesigned: boolean;
  chatHistory: ChatMessage[];
}

export type EquipmentCategory = '音箱' | '功放' | '中控' | '矩阵' | '视频会议' | '录播' | '话筒';

export interface Equipment {
  id: string;
  category: EquipmentCategory;
  brand: string;
  model: string;
  specs: string;
}
