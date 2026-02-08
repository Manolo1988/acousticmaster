
import { Scenario, AcousticParams, Equipment } from './types';

export const MIC_TYPES = [
  '手持无线话筒',
  '鹅颈会议话筒',
  '全向阵列话筒',
  '领夹话筒',
  '吊装话筒'
];

export const DEFAULT_PARAMS: AcousticParams = {
  length: 12,
  width: 8,
  height: 3.5,
  stageToNearAudience: 2,
  stageToFarAudience: 15,
  stageWidth: 10,
  stageDepth: 5,
  hasCentralControl: true,
  hasMatrix: true,
  hasVideoConf: false,
  hasRecording: false,
  mics: [{ id: '1', type: '手持无线话筒', count: 2 }],
  extraRequirements: '' // 初始化为空
};

export const SCENARIO_THEMES = {
  [Scenario.MEETING_ROOM]: {
    bg: 'bg-slate-50',
    sidebar: 'bg-white/95',
    chatBg: 'bg-blue-50/20',
    primary: 'bg-blue-600',
    text: 'text-blue-600',
    accent: 'blue',
    border: 'border-blue-200',
    glass: 'backdrop-blur-xl bg-white/60 border-blue-100 shadow-sm'
  },
  [Scenario.LECTURE_HALL]: {
    bg: 'bg-stone-50',
    sidebar: 'bg-white/95',
    chatBg: 'bg-purple-50/20',
    primary: 'bg-purple-600',
    text: 'text-purple-600',
    accent: 'purple',
    border: 'border-purple-200',
    glass: 'backdrop-blur-xl bg-white/60 border-purple-100 shadow-sm'
  }
};

export const VERIFY_THEME = {
  bg: 'bg-emerald-50',
  sidebar: 'bg-white/95',
  chatBg: 'bg-emerald-50/30',
  primary: 'bg-emerald-600',
  text: 'text-emerald-600',
  accent: 'emerald',
  border: 'border-emerald-200',
  glass: 'backdrop-blur-xl bg-white/60 border-emerald-100 shadow-sm'
};

export const MOCK_EQUIPMENTS: Equipment[] = [
  { id: '1', category: '音箱', brand: '博士 (Bose)', model: 'EdgeMax EM180', specs: '125W, 110Hz-16kHz' },
  { id: '2', category: '功放', brand: '皇冠 (Crown)', model: 'XTi 4002', specs: '1200W x 2 @ 4Ω' },
  { id: '3', category: '话筒', brand: '舒尔 (Shure)', model: 'MXA910', specs: 'Ceiling Array, Dante' },
  { id: '4', category: '矩阵', brand: '爱思创 (Extron)', model: 'DTP CrossPoint', specs: '8x4 Seamless Switcher' },
  { id: '5', category: '中控', brand: '快思聪 (Crestron)', model: 'CP4-R', specs: 'Control System with 4-series' },
];

export const MOCK_HISTORY = [
  { id: 'h1', type: 'DESIGN', name: '阿里巴巴总部5号会议室', date: '2024-05-20', status: '已完成' },
  { id: 'h2', type: 'VERIFICATION', name: '上海大剧院方案核验', date: '2024-05-18', status: '已完成' },
  { id: 'h3', type: 'DESIGN', name: '某高校报告厅声学改造', date: '2024-05-15', status: '草稿' },
];
