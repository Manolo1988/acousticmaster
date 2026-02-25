
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
  extraRequirements: ''
};

export const SCENARIO_THEMES = {
  [Scenario.MEETING_ROOM]: {
    color: 'blue-600',
    lightBg: 'bg-slate-50',
    chatBg: 'bg-blue-50/20'
  },
  [Scenario.LECTURE_HALL]: {
    color: 'purple-600',
    lightBg: 'bg-stone-50',
    chatBg: 'bg-purple-50/20'
  }
};

export const VERIFY_THEME = {
  color: 'emerald-600',
  lightBg: 'bg-emerald-50',
  chatBg: 'bg-emerald-50/30'
};

export const MOCK_EQUIPMENTS: Equipment[] = [
  { id: '1', category: '音箱', brand: '博士 (Bose)', model: 'EdgeMax EM180', specs: '125W, 110Hz-16kHz' },
  { id: '2', category: '功放', brand: '皇冠 (Crown)', model: 'XTi 4002', specs: '1200W x 2 @ 4Ω' },
  { id: '3', category: '话筒', brand: '舒尔 (Shure)', model: 'MXA910', specs: 'Ceiling Array, Dante' },
  { id: '4', category: '矩阵', brand: '爱思创 (Extron)', model: 'DTP CrossPoint', specs: '8x4 Seamless Switcher' },
  { id: '5', category: '中控', brand: '快思聪 (Crestron)', model: 'CP4-R', specs: 'Control System with 4-series' },
];

