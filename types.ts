
export enum Scenario {
  MEETING_ROOM = 'MEETING_ROOM',
  LECTURE_HALL = 'LECTURE_HALL'
}

export enum Page {
  SOLUTION = 'SOLUTION',
  VERIFICATION = 'VERIFICATION',
  MANAGEMENT = 'MANAGEMENT',
  HISTORY = 'HISTORY',
  USERS = 'USERS'
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

export interface User {
  id: string;
  name: string;
  role: '系统管理员' | '资深工程师' | '设计助理' | '访客';
  email: string;
  lastActive: string;
  status: '活跃' | '禁用';
}

export enum TableType {
  SPEAKER = '音箱',
  LINE_ARRAY = '线阵列配套',
  AMPLIFIER = '定阻功放',
  PERIPHERAL = '周边设备',
  OTHER = '其他设备'
}
export interface DbInventoryItem {
  id: number; // 数据库 int 类型，解决 string 冲突
  产品名称: string;
  型号: string;
  市场价: number;
  品牌?: string;
  类型?: string;
  // 定阻功放/线阵配套/音箱共有
  额定功率?: string;
  额定阻抗?: string;
  // 音箱/线阵配套共有
  灵敏度?: string;
  最大声压级?: string;
  覆盖角?: string;
  面高?: number;
  用途?: string;
  main_id?: number; // 关联音箱的 ID
  // 周边设备特有
  输入通道?: number;
  输出通道?: number;
  // 定阻功放特有
  通道数?: number;
  // 其他设备特有
  描述?: string;
  场景?: string;
  // 前端辅助标识
  isChild?: boolean; 
}