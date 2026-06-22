// CAD 图纸解析器 —— 演示版（硬编码返回）
import { EquipmentItem, SolutionLayoutItem } from '../types';
import { v4 as uuidv4 } from 'uuid';

// ============ CAD 解析结果类型 ============

export interface CadSpeakerPlacement {
  id: string;
  tag: string;
  model: string;
  function: string;
  position: [number, number, number];
  aim: [number, number, number];
  coverage_h_deg: number;
  coverage_v_deg: number;
  gain_db: number;
  mountingType: 'wall' | 'ceiling' | 'floor' | 'flown';
  brand: string;
}

export interface CadRoomConfig {
  length_m: number;
  width_m: number;
  height_m: number;
  floorArea_m2: number;
  volume_m3: number;
  scenario: 'meeting_room' | 'lecture_hall' | 'multipurpose';
}

export interface CadStageConfig {
  width_m: number;
  depth_m: number;
  height_m: number;
  front_to_near_m: number;
  front_to_far_m: number;
}

export interface CadSeatingArea {
  rows: number;
  seats_per_row: number;
  total_seats: number;
  start_x_m: number;
  end_x_m: number;
  start_y_m: number;
  end_y_m: number;
}

export interface CadMaterialLayer {
  name: string;
  location: 'floor' | 'ceiling' | 'wall_front' | 'wall_rear' | 'wall_left' | 'wall_right';
  material: string;
  absorption_coeff_500hz: number;
  absorption_coeff_1000hz: number;
  absorption_coeff_2000hz: number;
  thickness_mm: number;
}

export interface CadParsedResult {
  source: string;
  drawingNumber: string;
  scale: string;
  date: string;
  room: CadRoomConfig;
  stage: CadStageConfig;
  seating: CadSeatingArea;
  speakers: CadSpeakerPlacement[];
  materials: CadMaterialLayer[];
  listenerEarHeight_m: number;
  parsedAt: string;
  parseDurationMs: number;
  warnings: string[];
}

// ============ 两个预设场景 ============

const MEETING_ROOM_MOCK: CadParsedResult = {
  source: 'sim/cad_samples/meeting_room_plan.svg',
  drawingNumber: 'ACOUSTIC-MR302-CAD-001',
  scale: '1:50',
  date: '2026-06-20',

  room: {
    length_m: 20.0,
    width_m: 12.0,
    height_m: 4.5,
    floorArea_m2: 240.0,
    volume_m3: 1080.0,
    scenario: 'meeting_room',
  },

  stage: {
    width_m: 8.0,
    depth_m: 4.0,
    height_m: 0.3,
    front_to_near_m: 1.5,
    front_to_far_m: 15.5,
  },

  seating: {
    rows: 9,
    seats_per_row: 16,
    total_seats: 144,
    start_x_m: 5.5,
    end_x_m: 18.5,
    start_y_m: 2.5,
    end_y_m: 9.5,
  },

  speakers: [
    {
      id: 'SPK-1',
      tag: 'MAIN-L',
      model: 'V8PRO',
      function: '主扩声 L',
      position: [3.5, 3.0, 3.8],
      aim: [10.5, 6.0, 1.2],
      coverage_h_deg: 90,
      coverage_v_deg: 60,
      gain_db: 0,
      mountingType: 'flown',
      brand: 'AcousticPro',
    },
    {
      id: 'SPK-2',
      tag: 'MAIN-R',
      model: 'V8PRO',
      function: '主扩声 R',
      position: [3.5, 9.0, 3.8],
      aim: [10.5, 6.0, 1.2],
      coverage_h_deg: 90,
      coverage_v_deg: 60,
      gain_db: 0,
      mountingType: 'flown',
      brand: 'AcousticPro',
    },
    {
      id: 'SPK-3',
      tag: 'AUX-L',
      model: 'CXD-60B',
      function: '辅助扩声 L',
      position: [13.4, 3.2, 3.8],
      aim: [15.0, 6.0, 1.2],
      coverage_h_deg: 100,
      coverage_v_deg: 70,
      gain_db: -2.5,
      mountingType: 'flown',
      brand: 'AcousticPro',
    },
    {
      id: 'SPK-4',
      tag: 'AUX-R',
      model: 'CXD-60B',
      function: '辅助扩声 R',
      position: [13.4, 8.8, 3.8],
      aim: [15.0, 6.0, 1.2],
      coverage_h_deg: 100,
      coverage_v_deg: 70,
      gain_db: -2.5,
      mountingType: 'flown',
      brand: 'AcousticPro',
    },
  ],

  materials: [
    {
      name: '吸音天花板',
      location: 'ceiling',
      material: '矿棉吸音板 15mm',
      absorption_coeff_500hz: 0.65,
      absorption_coeff_1000hz: 0.72,
      absorption_coeff_2000hz: 0.78,
      thickness_mm: 15,
    },
    {
      name: '地毯地面',
      location: 'floor',
      material: '商用尼龙地毯 8mm',
      absorption_coeff_500hz: 0.14,
      absorption_coeff_1000hz: 0.22,
      absorption_coeff_2000hz: 0.35,
      thickness_mm: 8,
    },
    {
      name: '前墙吸音板',
      location: 'wall_front',
      material: '木质穿孔吸音板 18mm',
      absorption_coeff_500hz: 0.55,
      absorption_coeff_1000hz: 0.61,
      absorption_coeff_2000hz: 0.58,
      thickness_mm: 18,
    },
    {
      name: '后墙扩散体',
      location: 'wall_rear',
      material: 'MLS扩散体 + 吸音棉',
      absorption_coeff_500hz: 0.38,
      absorption_coeff_1000hz: 0.42,
      absorption_coeff_2000hz: 0.40,
      thickness_mm: 100,
    },
    {
      name: '左侧墙吸音',
      location: 'wall_left',
      material: '布艺吸音板 25mm',
      absorption_coeff_500hz: 0.52,
      absorption_coeff_1000hz: 0.59,
      absorption_coeff_2000hz: 0.55,
      thickness_mm: 25,
    },
    {
      name: '右侧墙吸音',
      location: 'wall_right',
      material: '布艺吸音板 25mm',
      absorption_coeff_500hz: 0.52,
      absorption_coeff_1000hz: 0.59,
      absorption_coeff_2000hz: 0.55,
      thickness_mm: 25,
    },
  ],

  listenerEarHeight_m: 1.2,
  parsedAt: new Date().toISOString(),
  parseDurationMs: 847,
  warnings: [
    '图纸中未标注次低频音箱位置，已自动跳过',
    '天花高度为建筑层高，吊顶后净高以现场实测为准',
    '吸音材料数据来自图例标注，实际以材料送检报告为准',
  ],
};

const LECTURE_HALL_MOCK: CadParsedResult = {
  source: 'sim/cad_samples/lecture_hall_plan.svg',
  drawingNumber: 'ACOUSTIC-LH101-CAD-001',
  scale: '1:75',
  date: '2026-06-18',

  room: {
    length_m: 30.0,
    width_m: 18.0,
    height_m: 7.0,
    floorArea_m2: 540.0,
    volume_m3: 3780.0,
    scenario: 'lecture_hall',
  },

  stage: {
    width_m: 15.0,
    depth_m: 6.0,
    height_m: 0.6,
    front_to_near_m: 2.5,
    front_to_far_m: 26.0,
  },

  seating: {
    rows: 18,
    seats_per_row: 22,
    total_seats: 396,
    start_x_m: 8.5,
    end_x_m: 27.0,
    start_y_m: 3.0,
    end_y_m: 15.0,
  },

  speakers: [
    {
      id: 'SPK-1',
      tag: 'MAIN-L',
      model: 'LA210',
      function: '线阵列主扩 L',
      position: [2.0, 3.5, 6.5],
      aim: [16.0, 9.0, 1.2],
      coverage_h_deg: 120,
      coverage_v_deg: 10,
      gain_db: 0,
      mountingType: 'flown',
      brand: 'AcousticPro',
    },
    {
      id: 'SPK-2',
      tag: 'MAIN-R',
      model: 'LA210',
      function: '线阵列主扩 R',
      position: [2.0, 14.5, 6.5],
      aim: [16.0, 9.0, 1.2],
      coverage_h_deg: 120,
      coverage_v_deg: 10,
      gain_db: 0,
      mountingType: 'flown',
      brand: 'AcousticPro',
    },
    {
      id: 'SPK-3',
      tag: 'FRONT-FILL-L',
      model: 'CX-80',
      function: '前区补声 L',
      position: [6.0, 2.0, 1.2],
      aim: [11.0, 4.5, 1.2],
      coverage_h_deg: 90,
      coverage_v_deg: 60,
      gain_db: -3,
      mountingType: 'floor',
      brand: 'AcousticPro',
    },
    {
      id: 'SPK-4',
      tag: 'FRONT-FILL-R',
      model: 'CX-80',
      function: '前区补声 R',
      position: [6.0, 16.0, 1.2],
      aim: [11.0, 13.5, 1.2],
      coverage_h_deg: 90,
      coverage_v_deg: 60,
      gain_db: -3,
      mountingType: 'floor',
      brand: 'AcousticPro',
    },
    {
      id: 'SPK-5',
      tag: 'DELAY-L',
      model: 'V8PRO',
      function: '延时补声 L',
      position: [18.0, 3.0, 5.5],
      aim: [24.0, 9.0, 1.2],
      coverage_h_deg: 90,
      coverage_v_deg: 60,
      gain_db: -1.5,
      mountingType: 'flown',
      brand: 'AcousticPro',
    },
    {
      id: 'SPK-6',
      tag: 'DELAY-R',
      model: 'V8PRO',
      function: '延时补声 R',
      position: [18.0, 15.0, 5.5],
      aim: [24.0, 9.0, 1.2],
      coverage_h_deg: 90,
      coverage_v_deg: 60,
      gain_db: -1.5,
      mountingType: 'flown',
      brand: 'AcousticPro',
    },
    {
      id: 'SPK-7',
      tag: 'SUB-L',
      model: 'SUB218',
      function: '超低音 L',
      position: [2.5, 4.0, 0.3],
      aim: [8.0, 4.5, 0.6],
      coverage_h_deg: 360,
      coverage_v_deg: 360,
      gain_db: 3,
      mountingType: 'floor',
      brand: 'AcousticPro',
    },
    {
      id: 'SPK-8',
      tag: 'SUB-R',
      model: 'SUB218',
      function: '超低音 R',
      position: [2.5, 14.0, 0.3],
      aim: [8.0, 13.5, 0.6],
      coverage_h_deg: 360,
      coverage_v_deg: 360,
      gain_db: 3,
      mountingType: 'floor',
      brand: 'AcousticPro',
    },
  ],

  materials: [
    {
      name: '吸音吊顶',
      location: 'ceiling',
      material: '玻纤吸音板 25mm',
      absorption_coeff_500hz: 0.72,
      absorption_coeff_1000hz: 0.80,
      absorption_coeff_2000hz: 0.85,
      thickness_mm: 25,
    },
    {
      name: '木地板',
      location: 'floor',
      material: '实木复合地板 12mm',
      absorption_coeff_500hz: 0.10,
      absorption_coeff_1000hz: 0.08,
      absorption_coeff_2000hz: 0.07,
      thickness_mm: 12,
    },
    {
      name: '前墙扩散',
      location: 'wall_front',
      material: 'QRD扩散体 + 吸音背衬',
      absorption_coeff_500hz: 0.42,
      absorption_coeff_1000hz: 0.38,
      absorption_coeff_2000hz: 0.35,
      thickness_mm: 150,
    },
    {
      name: '后墙全吸音',
      location: 'wall_rear',
      material: '聚酯纤维吸音板 50mm',
      absorption_coeff_500hz: 0.82,
      absorption_coeff_1000hz: 0.88,
      absorption_coeff_2000hz: 0.92,
      thickness_mm: 50,
    },
    {
      name: '左侧墙吸音',
      location: 'wall_left',
      material: '槽孔吸音板 25mm + 空腔 100mm',
      absorption_coeff_500hz: 0.68,
      absorption_coeff_1000hz: 0.74,
      absorption_coeff_2000hz: 0.70,
      thickness_mm: 125,
    },
    {
      name: '右侧墙吸音',
      location: 'wall_right',
      material: '槽孔吸音板 25mm + 空腔 100mm',
      absorption_coeff_500hz: 0.68,
      absorption_coeff_1000hz: 0.74,
      absorption_coeff_2000hz: 0.70,
      thickness_mm: 125,
    },
  ],

  listenerEarHeight_m: 1.2,
  parsedAt: new Date().toISOString(),
  parseDurationMs: 1234,
  warnings: [
    '舞台机械升降区未标注音箱避开位置',
    '二楼挑台下方需补充近场补声音箱',
  ],
};

const MOCK_RESULT = MEETING_ROOM_MOCK;

// ============ 解析进度步骤 ============

const PARSE_STEPS = [
  { weight: 12, message: '加载 CAD 图元数据...' },
  { weight: 14, message: '识别图层与块定义...' },
  { weight: 18, message: '提取墙体轮廓与尺寸标注...' },
  { weight: 14, message: '解析舞台/主席台区域...' },
  { weight: 16, message: '识别音箱图块符号与接线...' },
  { weight: 12, message: '提取吸音材料标注...' },
  { weight: 10, message: '计算声学混响参数...' },
  { weight: 4,  message: '生成结构化解析报告...' },
];

// ============ 模拟解析函数 ============

export async function parseCadDrawing(
  onProgress?: (percent: number, message: string) => void,
  isLectureHall?: boolean,
): Promise<CadParsedResult> {
  const started = performance.now();
  const result = isLectureHall ? LECTURE_HALL_MOCK : MEETING_ROOM_MOCK;

  let cumulated = 0;
  for (const step of PARSE_STEPS) {
    cumulated += step.weight;
    onProgress?.(cumulated, step.message);
    await new Promise((resolve) => setTimeout(resolve, 160 + Math.random() * 180));
  }

  const durationMs = Math.round(performance.now() - started);

  return {
    ...result,
    parsedAt: new Date().toISOString(),
    parseDurationMs: durationMs,
  };
}

export function parseCadDrawingSync(isLectureHall?: boolean): CadParsedResult {
  const result = isLectureHall ? LECTURE_HALL_MOCK : MEETING_ROOM_MOCK;
  return {
    ...result,
    parsedAt: new Date().toISOString(),
    parseDurationMs: 0,
  };
}

// ============ 转换函数 ============

export function cadResultToEquipmentItems(cad: CadParsedResult): EquipmentItem[] {
  return cad.speakers.map((s) => ({
    id: `cad-${s.id}-${uuidv4().slice(0, 8)}`,
    type: '音箱',
    name: s.function,
    model: s.model,
    quantity: 1,
    brand: s.brand,
  }));
}

export function cadResultToLayoutItems(cad: CadParsedResult): SolutionLayoutItem[] {
  return cad.speakers.map((s, i) => ({
    id: `cad-layout-${s.id}`,
    function: s.function,
    name: `${s.model} / ${s.function}`,
    model: s.model,
    x: s.position[0],
    y: s.position[1],
    z: s.position[2],
    pitch: 0,
    yaw: 0,
  }));
}

export interface CadSimulationPayload {
  params: {
    length: number;
    width: number;
    height: number;
    stageWidth?: number;
    stageDepth?: number;
    stageToNearAudience?: number;
    stageToFarAudience?: number;
  };
  items: EquipmentItem[];
  layoutItems: SolutionLayoutItem[];
  parsedResult: CadParsedResult;
}

export function cadResultToSimulationPayload(cad: CadParsedResult): CadSimulationPayload {
  return {
    params: {
      length: cad.room.length_m,
      width: cad.room.width_m,
      height: cad.room.height_m,
      stageWidth: cad.stage.width_m,
      stageDepth: cad.stage.depth_m,
      stageToNearAudience: cad.stage.front_to_near_m,
      stageToFarAudience: cad.stage.front_to_far_m,
    },
    items: cadResultToEquipmentItems(cad),
    layoutItems: cadResultToLayoutItems(cad),
    parsedResult: cad,
  };
}
