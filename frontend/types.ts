
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
  mics?: MicConfig[];
  // 各类型话筒数量
  micHandheld: number;
  micGooseneck: number;
  micOmni: number;
  micLavalier: number;
  micCeiling: number;
  extraRequirements: string;
}

export interface EquipmentItem {
  id: string;
  type: string;      // 类型
  name: string;      // 产品名称
  model: string;     // 型号
  quantity: number;  // 数量
  brand?: string;    // 品牌（可选）
  unitPrice?: number; // 单价（可选）
}

export type ReportGenerationStatus = 'idle' | 'generating' | 'done' | 'error';
export type ReportChapterStatus = 'pending' | 'generating' | 'done' | 'error';

export interface ReportChapterState {
  key: string;
  title: string;
  markdown: string;
  status: ReportChapterStatus;
  error?: string;
}

export interface SolutionResult {
  id: string;
  title: string;
  items: EquipmentItem[];
  wordLink?: string;
  excelLink?: string;
  markdownRaw?: string;
  markdownProcessed?: string;
  postProcessReport?: {
    injected_blocks?: string[];
    toc_added?: boolean;
    replaced_resource_placeholders?: string[];
    chapter_inserted_resources?: string[];
    chapter_skipped_resources?: string[];
    replaced_image_placeholders?: string[];
    chapter_inserted_images?: string[];
    chapter_skipped_images?: string[];
    replaced_device_placeholders?: string[];
    missing_device_placeholders?: string[];
    figure_caption_count?: number;
    table_caption_count?: number;
  };
  chapters?: ReportChapterState[];
  reportGenerationStatus?: ReportGenerationStatus;
  reportGenerationError?: string;
  isGenerating?: boolean;
  simulationImage?: string;
  lastReportSignature?: string;
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

export type UserRole = '管理员' | '普通用户' | '游客';

export interface User {
  id: number;
  username: string;
  phone: string;
  company: string;
  role: UserRole;
  createdAt?: string;
}

export interface AuthUser extends User {
  isGuest: boolean;
  guestId?: string;
}

export interface HistoryRecord {
  id: number;
  userId?: number | null;
  guestId?: string | null;
  username: string;
  createdAt: string;
  projectName: string;
  scenario: Scenario;
  params: AcousticParams;
  results: SolutionResult[];
}

export enum TableType {
  FIXED_COMBINATION = '固定搭配',
  SPEAKER = '音箱',
  AMPLIFIER = '定阻功放',
  PERIPHERAL = '周边设备',
  FIXED_SCENE_EXTRA = '固定搭配场景剩余周边设备',
  NON_FIXED_SCENE_EXTRA = '非固定搭配场景剩余周边设备',
  LOCAL_STATIC_RESOURCE = '本地静态资源管理'
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
  设备图片?: string;

  // 资源管理兼容字段
  图片名称?: string;
  插入章节?: string;
  目标章节?: string;
  图片文件?: string;
  使用场景?: string;
  图片解释?: string;
  资源类型?: string;

  // 本地静态资源
  资源内容?: string;
  标识键?: string;
  来源文件?: string;
  是否启用?: string;

  // 兼容字段
  设备类型?: string;
  序号?: number;
  // 前端辅助标识
  isChild?: boolean; 
}