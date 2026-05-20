import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AcousticParams, EquipmentItem, Scenario, SolutionLayoutItem } from '../types';
import { isSimulationSpeakerItem } from '../utils/simulationSpeaker';

declare global {
  interface Window {
    Plotly?: any;
  }
}

interface AcousticSimulationDemoProps {
  params: AcousticParams;
  scenario: Scenario;
  items?: EquipmentItem[];
  layoutItems?: SolutionLayoutItem[];
  solutionId?: string;
}

interface DemoSpeaker {
  role: string;
  model: string;
  position: [number, number, number];
  aim: [number, number, number];
  gainDb: number;
  coverageH: number;
  coverageV: number;
  sourceItemId?: string;
  sourceRowIndex?: number;
  sourceName?: string;
  sourceType?: string;
  sourceUnitIndex?: number;
  sourceLabel?: string;
}

interface SimulationResult {
  config: {
    room: {
      length_m: number;
      width_m: number;
      height_m: number;
    };
    listener_area?: {
      ear_height_m?: number;
    };
    targets?: {
      min_spl_db?: number;
      max_nonuniformity_db?: number;
      min_headroom_db?: number;
    };
  };
  receivers: number[][];
  grid: {
    xs: number[];
    ys: number[];
    field: Array<Array<number | null>>;
  };
  best: {
    feasible?: boolean;
    reason?: string;
    totalCost?: number;
    speakerCount?: number;
    minSpl: number;
    avgSpl: number;
    maxSpl: number;
    nonuniformity?: number;
    headroom?: number;
    speakers: Array<{
      role: string;
      model: string;
      position: [number, number, number];
      aim: [number, number, number];
      gainDb: number;
      sourceItemId?: string;
      sourceRowIndex?: number;
      sourceName?: string;
      sourceType?: string;
      sourceUnitIndex?: number;
      sourceLabel?: string;
    }>;
  };
  source?: {
    catalog?: Array<{
      model: string;
      name?: string;
      estimated?: boolean;
      coverage_h_deg?: number;
      coverage_v_deg?: number;
    }>;
    missing?: string[];
  };
}

const PLOTLY_SRC = '/sim/plotly.min.js';
const rawApiBase = import.meta.env.VITE_API_BASE ?? '';
const API_BASE = rawApiBase.replace(/\/+$/, '');
let plotlyLoadPromise: Promise<void> | null = null;
const OPTIMIZATION_STEPS = [
  '读取当前方案清单与房间参数',
  '生成分散初始布点',
  '迭代优化位置、指向与增益',
  '国标指标复核与结果渲染',
];

const loadPlotly = () => {
  if (window.Plotly) return Promise.resolve();
  if (plotlyLoadPromise) return plotlyLoadPromise;

  plotlyLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${PLOTLY_SRC}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Plotly 加载失败')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = PLOTLY_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Plotly 加载失败'));
    document.head.appendChild(script);
  });

  return plotlyLoadPromise;
};

const clampRoomValue = (value: number, fallback: number, min: number, max: number) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, n));
};

const unit = (vec: number[]) => {
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  return norm < 1e-9 ? vec.slice() : vec.map((value) => value / norm);
};

const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const formatVec = (vec: number[]) => `(${vec.map((value) => value.toFixed(2)).join(', ')})`;

const linspace = (start: number, end: number, count: number) => {
  if (count <= 1) return [start];
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1));
};

const buildDemoSpeakers = (
  room: { length: number; width: number; height: number },
  items: EquipmentItem[] = [],
  layoutItems: SolutionLayoutItem[] = []
): DemoSpeaker[] => {
  const layoutSpeakers = layoutItems
    .filter((item) => `${item.function} ${item.name} ${item.model}`.includes('音箱'))
    .slice(0, 8)
    .map((item, index) => ({
      role: item.function || `音箱 ${index + 1}`,
      model: item.model || 'SIM-DEMO',
      sourceItemId: item.id,
      sourceRowIndex: index + 1,
      sourceName: item.name,
      sourceType: item.function,
      sourceUnitIndex: 1,
      sourceLabel: `${index + 1}. ${item.function || '音箱'} / ${item.name || item.model} / ${item.model}`,
      position: [
        clampRoomValue(item.x, room.length * 0.18, 0.2, room.length - 0.2),
        clampRoomValue(item.y, room.width * 0.25, 0.2, room.width - 0.2),
        clampRoomValue(item.z, Math.min(room.height - 0.4, 2.6), 0.4, room.height - 0.2),
      ] as [number, number, number],
      aim: [
        clampRoomValue(item.x + room.length * 0.34, room.length * 0.58, 0.2, room.length - 0.2),
        room.width / 2,
        1.2,
      ] as [number, number, number],
      gainDb: 0,
      coverageH: 90,
      coverageV: 60,
    }));

  if (layoutSpeakers.length > 0) return layoutSpeakers;

  const firstSpeaker = items.find(isSimulationSpeakerItem);
  const model = firstSpeaker?.model || 'V8PRO';
  const speakerCount = Math.max(2, Math.min(4, Number(firstSpeaker?.quantity || 2)));
  const z = Math.min(room.height - 0.35, Math.max(2.2, room.height * 0.36));
  const base: DemoSpeaker[] = [
    {
      role: '主扩 L',
      model,
      sourceItemId: firstSpeaker?.id,
      sourceRowIndex: firstSpeaker ? items.indexOf(firstSpeaker) + 1 : 1,
      sourceName: firstSpeaker?.name || model,
      sourceType: firstSpeaker?.type || '音箱',
      sourceUnitIndex: 1,
      sourceLabel: firstSpeaker ? `${items.indexOf(firstSpeaker) + 1}. ${firstSpeaker.type || '音箱'} / ${firstSpeaker.name || model} / ${model}` : `1. 音箱 / ${model} / ${model}`,
      position: [0.55, room.width * 0.28, z],
      aim: [room.length * 0.62, room.width * 0.5, 1.2],
      gainDb: 0,
      coverageH: 90,
      coverageV: 60,
    },
    {
      role: '主扩 R',
      model,
      sourceItemId: firstSpeaker?.id,
      sourceRowIndex: firstSpeaker ? items.indexOf(firstSpeaker) + 1 : 1,
      sourceName: firstSpeaker?.name || model,
      sourceType: firstSpeaker?.type || '音箱',
      sourceUnitIndex: 2,
      sourceLabel: firstSpeaker ? `${items.indexOf(firstSpeaker) + 1}. ${firstSpeaker.type || '音箱'} / ${firstSpeaker.name || model} / ${model}` : `1. 音箱 / ${model} / ${model}`,
      position: [0.55, room.width * 0.72, z],
      aim: [room.length * 0.62, room.width * 0.5, 1.2],
      gainDb: 0,
      coverageH: 90,
      coverageV: 60,
    },
    {
      role: '辅助 L',
      model: firstSpeaker?.model || 'CXD-60B',
      sourceItemId: firstSpeaker?.id,
      sourceRowIndex: firstSpeaker ? items.indexOf(firstSpeaker) + 1 : 1,
      sourceName: firstSpeaker?.name || firstSpeaker?.model || 'CXD-60B',
      sourceType: firstSpeaker?.type || '音箱',
      sourceUnitIndex: 3,
      sourceLabel: firstSpeaker ? `${items.indexOf(firstSpeaker) + 1}. ${firstSpeaker.type || '音箱'} / ${firstSpeaker.name || firstSpeaker.model} / ${firstSpeaker.model}` : '1. 音箱 / CXD-60B / CXD-60B',
      position: [room.length * 0.62, room.width * 0.18, Math.min(room.height - 0.35, z + 0.2)],
      aim: [room.length * 0.72, room.width * 0.5, 1.2],
      gainDb: -2.5,
      coverageH: 100,
      coverageV: 70,
    },
    {
      role: '辅助 R',
      model: firstSpeaker?.model || 'CXD-60B',
      sourceItemId: firstSpeaker?.id,
      sourceRowIndex: firstSpeaker ? items.indexOf(firstSpeaker) + 1 : 1,
      sourceName: firstSpeaker?.name || firstSpeaker?.model || 'CXD-60B',
      sourceType: firstSpeaker?.type || '音箱',
      sourceUnitIndex: 4,
      sourceLabel: firstSpeaker ? `${items.indexOf(firstSpeaker) + 1}. ${firstSpeaker.type || '音箱'} / ${firstSpeaker.name || firstSpeaker.model} / ${firstSpeaker.model}` : '1. 音箱 / CXD-60B / CXD-60B',
      position: [room.length * 0.62, room.width * 0.82, Math.min(room.height - 0.35, z + 0.2)],
      aim: [room.length * 0.72, room.width * 0.5, 1.2],
      gainDb: -2.5,
      coverageH: 100,
      coverageV: 70,
    },
  ];

  return base.slice(0, speakerCount);
};

const roomMeshTrace = (room: { length: number; width: number; height: number }) => {
  const vertices = [
    [0, 0, 0], [room.length, 0, 0], [room.length, room.width, 0], [0, room.width, 0],
    [0, 0, room.height], [room.length, 0, room.height], [room.length, room.width, room.height], [0, room.width, room.height],
  ];
  const faces = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]];
  return {
    type: 'mesh3d',
    name: 'Room',
    x: vertices.map((p) => p[0]),
    y: vertices.map((p) => p[1]),
    z: vertices.map((p) => p[2]),
    i: faces.map((f) => f[0]),
    j: faces.map((f) => f[1]),
    k: faces.map((f) => f[2]),
    color: '#64748b',
    opacity: 0.14,
    hoverinfo: 'skip',
  };
};

const coverageTrace = (speaker: DemoSpeaker, color: string, room: { length: number; width: number; height: number }) => {
  const pos = speaker.position;
  const forward = unit(speaker.aim.map((value, axis) => value - pos[axis]));
  let right = cross(forward, [0, 0, 1]);
  if (Math.sqrt(right.reduce((sum, value) => sum + value * value, 0)) < 1e-9) right = [1, 0, 0];
  right = unit(right);
  const vertical = unit(cross(right, forward));
  const length = Math.min(Math.max(room.length, room.width) * 0.3, 8);
  const base = pos.map((value, axis) => value + forward[axis] * length);
  const radiusH = length * Math.tan((speaker.coverageH / 2) * Math.PI / 180);
  const radiusV = length * Math.tan((speaker.coverageV / 2) * Math.PI / 180);
  const vertices: number[][] = [pos];

  for (let idx = 0; idx < 36; idx += 1) {
    const theta = (idx / 36) * Math.PI * 2;
    vertices.push([
      base[0] + right[0] * Math.cos(theta) * radiusH + vertical[0] * Math.sin(theta) * radiusV,
      base[1] + right[1] * Math.cos(theta) * radiusH + vertical[1] * Math.sin(theta) * radiusV,
      Math.max(0, Math.min(room.height, base[2] + right[2] * Math.cos(theta) * radiusH + vertical[2] * Math.sin(theta) * radiusV)),
    ]);
  }

  const i: number[] = [];
  const j: number[] = [];
  const k: number[] = [];
  for (let idx = 1; idx < vertices.length; idx += 1) {
    i.push(0);
    j.push(idx);
    k.push(idx === vertices.length - 1 ? 1 : idx + 1);
  }

  return {
    type: 'mesh3d',
    name: `${speaker.model} coverage`,
    x: vertices.map((p) => p[0]),
    y: vertices.map((p) => p[1]),
    z: vertices.map((p) => p[2]),
    i,
    j,
    k,
    color,
    opacity: 0.16,
    showlegend: false,
    hovertemplate: `${speaker.model} 覆盖范围<extra></extra>`,
  };
};

const buildSplField = (room: { length: number; width: number; height: number }, speakers: DemoSpeaker[]) => {
  const xs = linspace(1.2, Math.max(1.8, room.length - 0.9), 28);
  const ys = linspace(0.8, Math.max(1.4, room.width - 0.8), 18);
  const earHeight = 1.2;

  const field = ys.map((y) => xs.map((x) => {
    const energy = speakers.reduce((sum, speaker) => {
      const dx = x - speaker.position[0];
      const dy = y - speaker.position[1];
      const dz = earHeight - speaker.position[2];
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const aimDx = speaker.aim[0] - speaker.position[0];
      const aimDy = speaker.aim[1] - speaker.position[1];
      const aimDz = speaker.aim[2] - speaker.position[2];
      const toPoint = unit([dx, dy, dz]);
      const aim = unit([aimDx, aimDy, aimDz]);
      const dot = Math.max(-1, Math.min(1, toPoint[0] * aim[0] + toPoint[1] * aim[1] + toPoint[2] * aim[2]));
      const angleLoss = Math.max(0, Math.acos(dot) * 180 / Math.PI - speaker.coverageH / 2) * 0.16;
      const spl = 110 + speaker.gainDb - 20 * Math.log10(distance) - angleLoss;
      return sum + Math.pow(10, spl / 10);
    }, 0);
    return 10 * Math.log10(Math.max(1, energy));
  }));

  const flat = field.flat();
  return {
    xs,
    ys,
    field,
    min: Math.min(...flat),
    avg: flat.reduce((sum, value) => sum + value, 0) / flat.length,
    max: Math.max(...flat),
    earHeight,
  };
};

const AcousticSimulationDemo: React.FC<AcousticSimulationDemoProps> = ({ params, items = [], layoutItems = [], solutionId }) => {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultCacheRef = useRef(new Map<string, SimulationResult>());
  const [plotError, setPlotError] = useState('');
  const [plotReady, setPlotReady] = useState(false);
  const [simulationData, setSimulationData] = useState<SimulationResult | null>(null);
  const [simulationError, setSimulationError] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [optimizationStep, setOptimizationStep] = useState(0);
  const [optimizationRound, setOptimizationRound] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showCoverage, setShowCoverage] = useState(true);
  const requestSignature = useMemo(() => JSON.stringify({
    solutionId,
    params: { length: params.length, width: params.width, height: params.height },
    items: items.map((item) => ({ id: item.id, type: item.type, name: item.name, model: item.model, quantity: item.quantity })),
  }), [items, params.height, params.length, params.width, solutionId]);
  const speakerItems = useMemo(() => items.filter(isSimulationSpeakerItem), [items]);

  const fallbackRoom = useMemo(() => ({
    length: clampRoomValue(params.length, 20, 4, 80),
    width: clampRoomValue(params.width, 10, 3, 50),
    height: clampRoomValue(params.height, 8, 2.4, 18),
  }), [params.height, params.length, params.width]);

  const room = useMemo(() => {
    const simRoom = simulationData?.config?.room;
    if (!simRoom) return fallbackRoom;
    return {
      length: clampRoomValue(simRoom.length_m, fallbackRoom.length, 4, 80),
      width: clampRoomValue(simRoom.width_m, fallbackRoom.width, 3, 50),
      height: clampRoomValue(simRoom.height_m, fallbackRoom.height, 2.4, 18),
    };
  }, [fallbackRoom, simulationData]);

  const productCoverageByModel = useMemo(() => {
    const map = new Map<string, { h: number; v: number }>();
    (simulationData?.source?.catalog || []).forEach((item) => {
      if (!item.model) return;
      map.set(item.model, {
        h: Number(item.coverage_h_deg || 90),
        v: Number(item.coverage_v_deg || 60),
      });
    });
    return map;
  }, [simulationData]);

  const fallbackSpeakers = useMemo(() => buildDemoSpeakers(fallbackRoom, items, layoutItems), [items, layoutItems, fallbackRoom]);
  const speakers = useMemo(() => {
    const simSpeakers = simulationData?.best?.speakers || [];
    if (simSpeakers.length === 0) return fallbackSpeakers;
    return simSpeakers.map((speaker) => {
      const coverage = productCoverageByModel.get(speaker.model);
      return {
        role: speaker.role,
        model: speaker.model,
        position: speaker.position,
        aim: speaker.aim,
        gainDb: Number(speaker.gainDb || 0),
        coverageH: coverage?.h || 90,
        coverageV: coverage?.v || 60,
        sourceItemId: speaker.sourceItemId,
        sourceRowIndex: speaker.sourceRowIndex,
        sourceName: speaker.sourceName,
        sourceType: speaker.sourceType,
        sourceUnitIndex: speaker.sourceUnitIndex,
        sourceLabel: speaker.sourceLabel,
      };
    });
  }, [fallbackSpeakers, productCoverageByModel, simulationData]);

  const fallbackSplField = useMemo(() => buildSplField(fallbackRoom, fallbackSpeakers), [fallbackRoom, fallbackSpeakers]);
  const splField = useMemo(() => {
    if (!simulationData?.grid?.xs?.length || !simulationData?.grid?.ys?.length || !simulationData?.grid?.field?.length) {
      return fallbackSplField;
    }
    const flat = simulationData.grid.field.flat().filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return {
      xs: simulationData.grid.xs,
      ys: simulationData.grid.ys,
      field: simulationData.grid.field,
      min: Number(simulationData.best?.minSpl || Math.min(...flat)),
      avg: Number(simulationData.best?.avgSpl || flat.reduce((sum, value) => sum + value, 0) / Math.max(1, flat.length)),
      max: Number(simulationData.best?.maxSpl || Math.max(...flat)),
      earHeight: Number(simulationData.config?.listener_area?.ear_height_m || 1.2),
    };
  }, [fallbackSplField, simulationData]);
  const listenerCount = splField.xs.length * splField.ys.length;
  const standardRows = useMemo(() => {
    const minSplTarget = Number(simulationData?.config?.targets?.min_spl_db || 95);
    const uniformityTarget = Number(simulationData?.config?.targets?.max_nonuniformity_db || 8);
    const headroomTarget = Number(simulationData?.config?.targets?.min_headroom_db || 3);
    const nonuniformity = Number(simulationData?.best?.nonuniformity || (splField.max - splField.min));
    const headroom = Number(simulationData?.best?.headroom ?? (splField.min - minSplTarget));
    return [
      {
        name: '服务区最低声压级',
        standard: `>= ${minSplTarget.toFixed(0)} dB`,
        value: `${splField.min.toFixed(1)} dB`,
        pass: splField.min >= minSplTarget,
      },
      {
        name: '稳态声场不均匀度',
        standard: `<= ${uniformityTarget.toFixed(0)} dB`,
        value: `${nonuniformity.toFixed(1)} dB`,
        pass: nonuniformity <= uniformityTarget,
      },
      {
        name: '最低点声压余量',
        standard: `>= ${headroomTarget.toFixed(0)} dB`,
        value: `${headroom.toFixed(1)} dB`,
        pass: headroom >= headroomTarget,
      },
    ];
  }, [simulationData, splField.max, splField.min]);

  useEffect(() => {
    abortRef.current?.abort();
    setSimulationData(resultCacheRef.current.get(requestSignature) || null);
    setSimulationError('');
    setIsSimulating(false);
    setOptimizationStep(0);
    setOptimizationRound(0);
    setElapsedSeconds(0);
  }, [requestSignature]);

  useEffect(() => {
    if (!isSimulating) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setElapsedSeconds(seconds);
      if (seconds < 2) setOptimizationStep(0);
      else if (seconds < 5) setOptimizationStep(1);
      else {
        const round = Math.min(20, Math.max(1, Math.floor((seconds - 5) / 2) + 1));
        setOptimizationStep(round >= 20 ? 3 : 2);
        setOptimizationRound(round);
      }
    }, 350);
    return () => window.clearInterval(timer);
  }, [isSimulating]);

  const runInverseDesign = () => {
    if (speakerItems.length === 0) {
      setSimulationData(null);
      setSimulationError('当前方案中未找到可用于逆向设计的音箱设备。');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsSimulating(true);
    setOptimizationStep(0);
    setOptimizationRound(0);
    setElapsedSeconds(0);
    setSimulationData(null);
    setSimulationError('');
    fetch(`${API_BASE}/api/simulation/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        params,
        items,
        layoutItems,
      }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.details || data.error || '逆向设计接口调用失败');
        }
        return data as SimulationResult;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        resultCacheRef.current.set(requestSignature, data);
        setSimulationData(data);
        setOptimizationStep(3);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSimulationData(null);
        setSimulationError(error.message || '逆向设计接口调用失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsSimulating(false);
      });
  };

  useEffect(() => {
    let canceled = false;

    loadPlotly()
      .then(() => {
        if (canceled || !plotRef.current || !window.Plotly) return;
        setPlotError('');
        setPlotReady(false);

        if (!simulationData) {
          Promise.resolve(window.Plotly.purge(plotRef.current)).then(() => {
            if (!canceled) setPlotReady(true);
          });
          return;
        }

        const colors = ['#38bdf8', '#f59e0b', '#22c55e', '#f472b6', '#a78bfa', '#2dd4bf'];
        const traces: any[] = [
          roomMeshTrace(room),
          {
            type: 'surface',
            name: 'SPL',
            x: splField.xs,
            y: splField.ys,
            z: splField.ys.map(() => splField.xs.map(() => splField.earHeight)),
            surfacecolor: splField.field,
            colorscale: 'Turbo',
            cmin: Math.max(80, splField.min - 1),
            cmax: splField.max + 1,
            opacity: 0.92,
            colorbar: {
              title: { text: 'SPL dB', font: { color: '#334155' } },
              tickfont: { color: '#475569' },
              x: 0.03,
              xanchor: 'left',
              y: 0.5,
              yanchor: 'middle',
              thickness: 12,
              len: 0.62,
            },
            hovertemplate: 'SPL=%{surfacecolor:.1f} dB<extra></extra>',
          },
          {
            type: 'scatter3d',
            name: '听音测点',
            mode: 'markers',
            x: splField.xs.flatMap((x) => splField.ys.map(() => x)),
            y: splField.xs.flatMap(() => splField.ys),
            z: Array(listenerCount).fill(splField.earHeight),
            marker: { size: 2.6, color: '#d8dee9', line: { color: '#38bdf8', width: 0.4 } },
            hovertemplate: '听音测点<extra></extra>',
          },
        ];

        const legendModels = new Set<string>();
        speakers.forEach((speaker, index) => {
          const color = colors[index % colors.length];
          if (showCoverage) traces.push(coverageTrace(speaker, color, room));
          const showLegend = !legendModels.has(speaker.model);
          legendModels.add(speaker.model);
          traces.push({
            type: 'scatter3d',
            name: speaker.model,
            legendgroup: speaker.model,
            showlegend: showLegend,
            mode: 'markers+text',
            x: [speaker.position[0]],
            y: [speaker.position[1]],
            z: [speaker.position[2]],
            text: [`${speaker.sourceRowIndex ? `#${speaker.sourceRowIndex}` : ''}${speaker.sourceUnitIndex ? `-${speaker.sourceUnitIndex}` : ''}` || speaker.role],
            textposition: 'top center',
            marker: { size: 7, color, symbol: 'diamond', line: { color: '#ffffff', width: 1 } },
            hovertemplate: `${speaker.sourceLabel || speaker.role}<br>第 ${speaker.sourceUnitIndex || index + 1} 台：${speaker.model}<br>${formatVec(speaker.position)}<extra></extra>`,
          });
        });

        Promise.resolve(window.Plotly.react(plotRef.current, traces, {
          paper_bgcolor: '#ffffff',
          plot_bgcolor: '#ffffff',
          font: { color: '#334155', size: 11 },
          margin: { l: 78, r: 8, t: 8, b: 0 },
          scene: {
            bgcolor: '#ffffff',
            aspectmode: 'data',
            xaxis: { title: 'X m', backgroundcolor: '#ffffff', gridcolor: '#e2e8f0', zerolinecolor: '#cbd5e1', color: '#64748b' },
            yaxis: { title: 'Y m', backgroundcolor: '#ffffff', gridcolor: '#e2e8f0', zerolinecolor: '#cbd5e1', color: '#64748b' },
            zaxis: { title: 'Z m', backgroundcolor: '#ffffff', gridcolor: '#e2e8f0', zerolinecolor: '#cbd5e1', color: '#64748b' },
            camera: { eye: { x: 1.45, y: -1.75, z: 1.15 }, center: { x: 0, y: 0, z: -0.08 } },
          },
          legend: {
            x: 0.98,
            xanchor: 'right',
            y: 0.5,
            yanchor: 'middle',
            bgcolor: 'rgba(255,255,255,0.9)',
            bordercolor: '#e2e8f0',
            borderwidth: 1,
            font: { color: '#475569' },
          },
        }, { displaylogo: false, responsive: true })).then(() => {
          if (!canceled) setPlotReady(true);
        });
      })
      .catch((error) => {
        if (!canceled) setPlotError(error.message || 'Plotly 加载失败');
      });

    return () => {
      canceled = true;
      if (plotRef.current && window.Plotly) {
        window.Plotly.purge(plotRef.current);
      }
    };
  }, [listenerCount, room, showCoverage, simulationData, speakers, splField]);

  return (
    <div className="h-full min-h-[560px] bg-white text-slate-700 flex flex-col overflow-hidden">
      <div className="h-12 px-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
        <div className="min-w-0 flex items-center gap-3">
          <h3 className="text-sm font-black text-slate-900 truncate">逆向设计方案生成</h3>
          <span className={`px-2 py-0.5 rounded-sm text-[11px] font-black border ${simulationData?.best?.feasible ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : isSimulating ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
            {isSimulating ? `迭代中 ${elapsedSeconds}s` : simulationData ? simulationData.best?.feasible ? '指标满足' : '需调整清单' : '待生成'}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={runInverseDesign}
            disabled={isSimulating || speakerItems.length === 0}
            className={`h-8 px-3 rounded border text-[12px] font-black transition-all ${isSimulating || speakerItems.length === 0 ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed' : 'border-blue-200 bg-blue-600 text-white hover:bg-blue-700 shadow-sm'}`}
          >
            {simulationData ? '重新生成' : '开始逆向优化'}
          </button>
          <button
            type="button"
            onClick={() => setShowCoverage((value) => !value)}
            className="h-8 px-3 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[12px] font-bold text-slate-600"
          >
            {showCoverage ? '隐藏覆盖范围' : '显示覆盖范围'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="px-4 py-3 bg-white border-r border-slate-200">
          <div className="text-[11px] text-slate-400 font-black uppercase">方案模式</div>
          <div className="mt-1 text-sm font-black text-slate-900">固定清单布点</div>
        </div>
        <div className="px-4 py-3 bg-white border-r border-slate-200">
          <div className="text-[11px] text-slate-400 font-black uppercase">SPL min/avg/max</div>
          <div className="mt-1 text-sm font-black text-slate-900 tabular-nums">{simulationData ? `${splField.min.toFixed(1)} / ${splField.avg.toFixed(1)} / ${splField.max.toFixed(1)}` : '--'}</div>
        </div>
        <div className="px-4 py-3 bg-white border-r border-slate-200">
          <div className="text-[11px] text-slate-400 font-black uppercase">不均匀度</div>
          <div className="mt-1 text-sm font-black text-slate-900 tabular-nums">{simulationData ? `${Number(simulationData?.best?.nonuniformity || (splField.max - splField.min)).toFixed(1)} dB` : '--'}</div>
        </div>
        <div className="px-4 py-3 bg-white">
          <div className="text-[11px] text-slate-400 font-black uppercase">音箱数量</div>
          <div className="mt-1 text-sm font-black text-slate-900 tabular-nums">{simulationData ? speakers.length : speakerItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</div>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_360px] min-h-0 flex-1">
        <div className="relative min-h-[420px] bg-white border-r border-slate-200">
          <div ref={plotRef} className={`absolute inset-0 bg-white ${simulationData ? '' : 'hidden'}`} />
          {!plotReady && !plotError && (
            <div className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-slate-400 bg-white">
              {isSimulating ? '正在迭代优化位置、指向与增益...' : '正在加载三维逆向设计视图...'}
            </div>
          )}
          {!isSimulating && !simulationData && plotReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/82 backdrop-blur-[1px]">
              <div className="w-[360px] rounded border border-blue-100 bg-white shadow-lg p-5 text-center">
                <div className="text-[13px] font-black text-slate-900">当前方案尚未生成逆向设计</div>
                <div className="mt-2 text-[12px] leading-relaxed text-slate-500">
                  点击右上角“开始逆向优化”，系统会以当前方案清单为输入，独立求解本方案的位置、指向和增益。
                </div>
                <button
                  type="button"
                  onClick={runInverseDesign}
                  disabled={speakerItems.length === 0}
                  className={`mt-4 h-9 px-4 rounded text-[12px] font-black ${speakerItems.length === 0 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                >
                  开始逆向优化
                </button>
              </div>
            </div>
          )}
          {isSimulating && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/86 backdrop-blur-[1px]">
              <div className="w-[460px] rounded border border-blue-100 bg-white shadow-xl p-5">
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-black text-slate-900">正在求解当前方案</div>
                  <div className="text-[12px] font-mono font-black text-blue-600">
                    {optimizationRound > 0 ? `第 ${optimizationRound}/20 轮` : `${elapsedSeconds}s`}
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {OPTIMIZATION_STEPS.map((step, index) => {
                    const active = index === optimizationStep;
                    const done = index < optimizationStep;
                    const label = index === 2 && optimizationRound > 0 ? `第 ${optimizationRound}/20 轮：优化位置、指向与增益` : step;
                    return (
                      <div key={step} className={`flex items-center gap-3 rounded border px-3 py-2 ${active ? 'border-blue-200 bg-blue-50' : done ? 'border-emerald-100 bg-emerald-50' : 'border-slate-100 bg-slate-50'}`}>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black ${active ? 'bg-blue-600 text-white animate-pulse' : done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                          {done ? '✓' : index + 1}
                        </div>
                        <div className={`text-[12px] font-bold ${active ? 'text-blue-700' : done ? 'text-emerald-700' : 'text-slate-400'}`}>
                          {label}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-500"
                    style={{ width: `${isSimulating ? Math.min(96, Math.max(8, (optimizationRound / 20) * 100)) : 100}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-slate-400 font-bold">
                  最多迭代 20 步；若提前满足国标约束，求解会直接结束。
                </div>
              </div>
            </div>
          )}
          {simulationError && plotReady && (
            <div className="absolute left-4 top-4 max-w-lg rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-700 shadow-sm">
              {simulationError} 当前显示前端兜底示例。
            </div>
          )}
          {plotError && (
            <div className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-rose-500 bg-white">
              {plotError}
            </div>
          )}
        </div>

        <aside className="min-h-0 overflow-auto bg-white">
          <div className="p-4 space-y-4">
            <section>
              <div className="text-[12px] font-black text-slate-500 mb-2">音箱位置与指向</div>
              <div className="overflow-hidden rounded border border-slate-200">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-400">
                    <tr>
                      <th className="px-2 py-2 text-left font-black">清单来源</th>
                      <th className="px-2 py-2 text-left font-black">型号</th>
                      <th className="px-2 py-2 text-left font-black">坐标 m</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {simulationData && speakers.map((speaker, index) => (
                      <tr key={`${speaker.role}-${index}`} className="text-slate-600">
                        <td className="px-2 py-2 font-bold">
                          <div className="text-slate-700">{speaker.sourceLabel || speaker.role}</div>
                          <div className="mt-0.5 text-[11px] font-mono text-slate-400">第 {speaker.sourceUnitIndex || index + 1} 台 · {speaker.role}</div>
                        </td>
                        <td className="px-2 py-2 font-mono">{speaker.model}</td>
                        <td className="px-2 py-2 font-mono text-[11px]">{formatVec(speaker.position)}</td>
                      </tr>
                    ))}
                    {!simulationData && (
                      <tr>
                        <td colSpan={3} className="px-2 py-6 text-center text-slate-400 font-bold">
                          当前方案尚未生成，请点击“开始逆向优化”。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <div className="text-[12px] font-black text-slate-500 mb-2">逆向设计参数来源</div>
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3 text-[12px] leading-relaxed text-slate-600">
                {simulationData?.source?.catalog?.some((item) => item.estimated) ? '部分型号未在数据库中查到，已按设备类型进行保守估算。' : '音箱声学参数来自数据库库存表。'}
                {simulationData?.source?.missing?.length ? ` 未匹配：${simulationData.source.missing.join('、')}` : ''}
              </div>
            </section>

            <section>
              <div className="text-[12px] font-black text-slate-500 mb-2">国标指标对比</div>
              <div className="overflow-hidden rounded border border-slate-200">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-400">
                    <tr>
                      <th className="px-2 py-2 text-left font-black">项目</th>
                      <th className="px-2 py-2 text-left font-black">要求</th>
                      <th className="px-2 py-2 text-left font-black">设计值</th>
                      <th className="px-2 py-2 text-left font-black">结果</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {simulationData ? standardRows.map((row) => (
                      <tr key={row.name}>
                        <td className="px-2 py-2 font-bold text-slate-600">{row.name}</td>
                        <td className="px-2 py-2 font-mono text-slate-500">{row.standard}</td>
                        <td className="px-2 py-2 font-mono text-slate-700">{row.value}</td>
                        <td className={`px-2 py-2 font-black ${row.pass ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {row.pass ? '满足' : '不满足'}
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={4} className="px-2 py-6 text-center text-slate-400 font-bold">
                          生成后显示国标指标对比。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 rounded border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                当前按 GB 50371-2006 涉及的最大声压级、稳态声场不均匀度等验收方向进行逆向设计对标；正式验收仍需按空场测量、频带与测点方法复核。
              </div>
            </section>

            <section>
              <div className="text-[12px] font-black text-slate-500 mb-2">说明</div>
              <div className="rounded border border-blue-100 bg-blue-50 px-3 py-3 text-[12px] leading-relaxed text-blue-800">
                当前不做设备选型，只按照方案清单中的音箱型号和数量，迭代优化摆放位置、安装高度、指向角和增益，使服务区声压级与声场不均匀度尽量满足对标指标。
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default AcousticSimulationDemo;
