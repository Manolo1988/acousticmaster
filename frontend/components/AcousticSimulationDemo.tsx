import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AcousticParams, EquipmentItem, Scenario, SolutionLayoutItem } from '../types';
import { isSimulationSpeakerItem } from '../utils/simulationSpeaker';

declare global {
  interface Window {
    Plotly?: any;
    __acousticSimulationDownloadPng?: (fileName?: string) => Promise<boolean>;
    __acousticSimulationGetReportPayload?: (solutionId?: string) => Promise<Record<string, any> | null>;
    __acousticSimulationLatestPayload?: { solutionId: string; payload: Record<string, any> };
  }
}

interface AcousticSimulationDemoProps {
  params: AcousticParams;
  scenario: Scenario;
  items?: EquipmentItem[];
  layoutItems?: SolutionLayoutItem[];
  solutionId?: string;
  onApplyLayout?: (layoutItems: SolutionLayoutItem[]) => void;
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
  adjustment?: {
    needed?: boolean;
    feasible?: boolean;
    reason?: string;
    added?: Array<{
      model: string;
      quantity: number;
    }>;
    result?: {
      minSpl?: number;
      avgSpl?: number;
      maxSpl?: number;
      nonuniformity?: number;
      headroom?: number;
      speakerCount?: number;
      reason?: string;
    };
  };
}

type SimulationSnapshotView = 'top' | 'side';

const rawApiBase = import.meta.env.VITE_API_BASE ?? '';
const API_BASE = rawApiBase.replace(/\/+$/, '');
const SIM_RESULT_CACHE_PREFIX = 'acoustic-sim-result:v5:';
const SIM_RESULT_CACHE_LIMIT = 24;
const MEETING_TARGETS = {
  minSpl: 95,
  maxUniformity: 8,
  minHeadroom: 3,
};

const LECTURE_TARGETS = {
  minSpl: 98,
  maxUniformity: 8,
  minHeadroom: 3,
};

const getSimulationTargets = (scenario: Scenario) =>
  scenario === Scenario.LECTURE_HALL ? LECTURE_TARGETS : MEETING_TARGETS;
const persistentSimulationResultCache = new Map<string, SimulationResult>();

const normalizeText = (value: unknown) => String(value ?? '').trim();

const normalizeNumber = (value: unknown, precision = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
};

const buildSimulationCacheSignatures = (
  solutionId: string | undefined,
  scenario: Scenario,
  params: AcousticParams,
  items: EquipmentItem[],
  layoutItems: SolutionLayoutItem[],
  targets: { minSpl: number; maxUniformity: number; minHeadroom: number }
) => {
  const normalizedItems = items
    .map((item) => ({
      type: normalizeText(item.type),
      name: normalizeText(item.name),
      model: normalizeText(item.model),
      quantity: Number(item.quantity || 0),
    }))
    .sort((a, b) => `${a.type}|${a.name}|${a.model}|${a.quantity}`.localeCompare(`${b.type}|${b.name}|${b.model}|${b.quantity}`));

  const normalizedLayout = layoutItems
    .map((item) => ({
      function: normalizeText(item.function),
      model: normalizeText(item.model),
      x: normalizeNumber(item.x, 2),
      y: normalizeNumber(item.y, 2),
      z: normalizeNumber(item.z, 2),
    }))
    .sort((a, b) => `${a.function}|${a.model}|${a.x}|${a.y}|${a.z}`.localeCompare(`${b.function}|${b.model}|${b.x}|${b.y}|${b.z}`));

  const basePayload = {
    scenario,
    room: {
      length: normalizeNumber(params.length, 2),
      width: normalizeNumber(params.width, 2),
      height: normalizeNumber(params.height, 2),
    },
    targets,
    items: normalizedItems,
    layout: normalizedLayout,
  };

  const signatures = [
    solutionId ? `solution:${normalizeText(solutionId)}|${JSON.stringify(basePayload.room)}` : '',
    `content:${JSON.stringify(basePayload)}`,
  ].filter(Boolean);

  return Array.from(new Set(signatures));
};

const readSimulationResultCache = (signatures: string[]) => {
  for (const signature of signatures) {
    const inMemory = persistentSimulationResultCache.get(signature);
    if (inMemory) return inMemory;
  }

  if (typeof window === 'undefined') return null;

  for (const signature of signatures) {
    try {
      const raw = window.sessionStorage.getItem(`${SIM_RESULT_CACHE_PREFIX}${signature}`);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as SimulationResult;
      persistentSimulationResultCache.set(signature, parsed);
      return parsed;
    } catch {
      // Ignore invalid cache entries.
    }
  }

  return null;
};

const writeSimulationResultCache = (signatures: string[], result: SimulationResult) => {
  signatures.forEach((signature) => {
    if (!signature) return;
    persistentSimulationResultCache.set(signature, result);
  });

  while (persistentSimulationResultCache.size > SIM_RESULT_CACHE_LIMIT) {
    const oldestKey = persistentSimulationResultCache.keys().next().value;
    if (!oldestKey) break;
    persistentSimulationResultCache.delete(oldestKey);
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(`${SIM_RESULT_CACHE_PREFIX}${oldestKey}`);
    }
  }

  if (typeof window === 'undefined') return;
  signatures.forEach((signature) => {
    if (!signature) return;
    try {
      window.sessionStorage.setItem(`${SIM_RESULT_CACHE_PREFIX}${signature}`, JSON.stringify(result));
    } catch {
      // Ignore cache write failure.
    }
  });
};

const isNetworkFetchError = (error: unknown) => {
  const message = String((error as { message?: string })?.message || '').toLowerCase();
  return (
    error instanceof TypeError
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('load failed')
  );
};

const toDisplaySimulationError = (error: unknown) => {
  const raw = String((error as { message?: string })?.message || '').trim();
  if (!raw) return '逆向设计服务调用失败，请稍后重试。';
  if (isNetworkFetchError(error)) {
    return '逆向设计服务连接失败，请确认后端已启动且接口可访问。';
  }
  return raw;
};

const buildSimulationRunEndpoints = () => {
  const endpoints = [`${API_BASE}/api/simulation/run`];
  if (!API_BASE && typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    // HTTPS 页面下直连 http://host:300x 会被浏览器按 mixed-content 拦截。
    if (protocol !== 'https:') {
      endpoints.push(`${protocol}//${hostname}:3002/api/simulation/run`);
      endpoints.push(`${protocol}//${hostname}:3001/api/simulation/run`);
    }
  }
  return Array.from(new Set(endpoints));
};

const postSimulationRun = async (
  payload: {
    params: AcousticParams;
    items: EquipmentItem[];
    layoutItems: SolutionLayoutItem[];
    targets: { minSpl: number; maxUniformity: number; minHeadroom: number };
    listener?: {
      frontMargin?: number;
      rearMargin?: number;
      sideMargin?: number;
      earHeight?: number;
    };
  },
  signal: AbortSignal,
) => {
  const endpoints = buildSimulationRunEndpoints();
  let lastError: Error | null = null;
  const nonNetworkErrors: Error[] = [];

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const retryable404 = response.status === 404 && index < endpoints.length - 1;
        if (retryable404) continue;
        throw new Error(data.details || data.error || `逆向设计接口调用失败（${response.status}）`);
      }
      return data as SimulationResult;
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') throw error;
      lastError = error instanceof Error ? error : new Error('逆向设计接口调用失败');
      if (!isNetworkFetchError(lastError)) {
        nonNetworkErrors.push(lastError);
      }
      if (index === endpoints.length - 1) {
        if (nonNetworkErrors.length > 0) {
          throw nonNetworkErrors[nonNetworkErrors.length - 1];
        }
        throw lastError;
      }
    }
  }

  if (nonNetworkErrors.length > 0) {
    throw nonNetworkErrors[nonNetworkErrors.length - 1];
  }

  if (lastError && isNetworkFetchError(lastError)) {
    throw new Error('逆向设计服务连接失败，请确认后端已启动且接口可访问。');
  }

  throw lastError || new Error('逆向设计接口调用失败');
};

const OPTIMIZATION_STEPS = [
  '读取当前方案清单与房间参数',
  '生成分散初始布点',
  '迭代优化位置、指向与增益',
  '国标指标复核与结果渲染',
];

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
  layoutItems: SolutionLayoutItem[] = [],
  scenario: Scenario = Scenario.MEETING_ROOM
): DemoSpeaker[] => {
  const layoutDefaultZ = scenario === Scenario.MEETING_ROOM
    ? Math.min(room.height - 0.4, 4)
    : Math.min(room.height - 0.4, 7);
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
        clampRoomValue(item.z, layoutDefaultZ, 0.4, room.height - 0.2),
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
  const mountHeight = scenario === Scenario.MEETING_ROOM
    ? 4
    : Math.max(4.5, room.height * 0.6);
  const z = Math.min(room.height - 0.35, mountHeight);
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

type RoomModel = { length: number; width: number; height: number };
type SplFieldModel = ReturnType<typeof buildSplField>;

const makeTextSprite = (text: string, options?: { color?: string; background?: string; fontSize?: number }) => {
  const canvas = document.createElement('canvas');
  const fontSize = options?.fontSize ?? 28;
  const padX = 14;
  const padY = 10;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.font = `700 ${fontSize}px sans-serif`;
  const metrics = context.measureText(text);
  const width = Math.max(24, Math.ceil(metrics.width + padX * 2));
  const height = Math.max(24, Math.ceil(fontSize + padY * 2));
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, width, height);
  if (options?.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.font = `700 ${fontSize}px sans-serif`;
  ctx.fillStyle = options?.color || '#334155';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padX, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width / 150, height / 150, 1);
  return sprite;
};

const buildSplSampler = (splField: { xs: number[]; ys: number[]; field: Array<Array<number | null>>; avg: number }) => {
  const xs = splField.xs;
  const ys = splField.ys;
  const safeField = ys.map((_, yi) => xs.map((_, xi) => {
    const value = splField.field?.[yi]?.[xi];
    return typeof value === 'number' && Number.isFinite(value) ? value : splField.avg;
  }));

  const locate = (arr: number[], value: number) => {
    if (arr.length < 2) return { i0: 0, i1: 0, t: 0 };
    if (value <= arr[0]) return { i0: 0, i1: 1, t: 0 };
    const last = arr.length - 1;
    if (value >= arr[last]) return { i0: last - 1, i1: last, t: 1 };
    for (let index = 0; index < last; index += 1) {
      if (value >= arr[index] && value <= arr[index + 1]) {
        const delta = arr[index + 1] - arr[index];
        const t = delta > 1e-9 ? (value - arr[index]) / delta : 0;
        return { i0: index, i1: index + 1, t };
      }
    }
    return { i0: last - 1, i1: last, t: 1 };
  };

  return (x: number, y: number) => {
    const xPos = locate(xs, x);
    const yPos = locate(ys, y);
    const q11 = safeField[yPos.i0]?.[xPos.i0] ?? splField.avg;
    const q21 = safeField[yPos.i0]?.[xPos.i1] ?? splField.avg;
    const q12 = safeField[yPos.i1]?.[xPos.i0] ?? splField.avg;
    const q22 = safeField[yPos.i1]?.[xPos.i1] ?? splField.avg;
    const r1 = q11 + (q21 - q11) * xPos.t;
    const r2 = q12 + (q22 - q12) * xPos.t;
    return r1 + (r2 - r1) * yPos.t;
  };
};

const blendColor = (from: string, to: string, t: number) => {
  const c1 = new THREE.Color(from);
  const c2 = new THREE.Color(to);
  return c1.lerp(c2, Math.max(0, Math.min(1, t)));
};

const splToRequirementColor = (spl: number, target: number, cmin: number, cmax: number) => {
  if (spl >= target) {
    const t = (spl - target) / Math.max(1e-6, cmax - target);
    return blendColor('#ffd7d7', '#7f1d1d', t);
  }
  const t = (target - spl) / Math.max(1e-6, target - cmin);
  return blendColor('#dbeafe', '#0b3a8a', t);
};

const addDimensionAnnotations = (scene: THREE.Scene, room: RoomModel, wallHeight: number) => {
  const lengthLabelY = -0.28;
  const widthLabelX = -0.28;
  const heightLabelX = room.length + 0.3;
  const heightLabelY = room.width + 0.18;

  // 仅显示尺寸数字，不绘制引导线，避免遮挡场景。
  const labelOptions = { color: '#1e293b', background: 'rgba(255,255,255,0.95)', fontSize: 52 };
  const l = makeTextSprite(`L=${room.length.toFixed(1)}m`, labelOptions);
  const w = makeTextSprite(`W=${room.width.toFixed(1)}m`, labelOptions);
  const h = makeTextSprite(`H=${room.height.toFixed(1)}m`, labelOptions);
  if (l) {
    l.position.set(room.length / 2, lengthLabelY, 0.24);
    scene.add(l);
  }
  if (w) {
    w.position.set(widthLabelX, room.width / 2, 0.24);
    scene.add(w);
  }
  if (h) {
    h.position.set(heightLabelX, heightLabelY, wallHeight / 2);
    scene.add(h);
  }
};

const addSplFloorMesh = (
  scene: THREE.Scene,
  room: RoomModel,
  sampleSpl: (x: number, y: number) => number,
  targetSpl: number,
  cmin: number,
  cmax: number,
): THREE.Mesh => {
  const segX = 40;
  const segY = 28;
  const geometry = new THREE.PlaneGeometry(room.length - 0.12, room.width - 0.12, segX, segY);
  const colors: number[] = [];
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const vx = positions.getX(index) + room.length / 2;
    const vy = positions.getY(index) + room.width / 2;
    const spl = sampleSpl(vx, vy);
    const color = splToRequirementColor(spl, targetSpl, cmin, cmax);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, transparent: true, opacity: 0.85 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(room.length / 2, room.width / 2, 0.03);
  scene.add(mesh);
  return mesh;
};

const getWallOccludedConeLength = (
  room: RoomModel,
  position: [number, number, number],
  forward: THREE.Vector3,
) => {
  const tValues: number[] = [];
  if (forward.x > 1e-6) tValues.push((room.length - position[0]) / forward.x);
  if (forward.x < -1e-6) tValues.push((0 - position[0]) / forward.x);
  if (forward.y > 1e-6) tValues.push((room.width - position[1]) / forward.y);
  if (forward.y < -1e-6) tValues.push((0 - position[1]) / forward.y);
  if (forward.z > 1e-6) tValues.push((room.height - position[2]) / forward.z);
  if (forward.z < -1e-6) tValues.push((0 - position[2]) / forward.z);

  const hit = tValues.filter((t) => Number.isFinite(t) && t > 0);
  if (hit.length === 0) return Math.max(room.length, room.width, room.height);
  return Math.max(0.45, Math.min(...hit) - 0.02);
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const buildSplLegendGradientStops = (targetBottomPercent: number) => {
  const boundary = clamp01(targetBottomPercent / 100);
  const coolMid = clamp01(boundary * 0.62);
  const warmMid = clamp01(boundary + (1 - boundary) * 0.34);
  return { boundary, coolMid, warmMid };
};

const drawSplLegendOnCanvas = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: {
    cmin: number;
    cmax: number;
    minSplTarget: number;
    targetBottomPercent: number;
  }
) => {
  const panelX = Math.round(Math.max(14, width * 0.02));
  const panelY = Math.round(Math.max(14, height * 0.03));
  const panelW = 168;
  const panelH = 286;
  const barX = panelX + 16;
  const barY = panelY + 34;
  const barW = 18;
  const barH = 228;
  const targetY = barY + barH * (1 - Math.max(0, Math.min(100, params.targetBottomPercent)) / 100);
  const gradientStops = buildSplLegendGradientStops(params.targetBottomPercent);

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  const gradient = ctx.createLinearGradient(0, barY + barH, 0, barY);
  gradient.addColorStop(0, '#0a2d6d');
  gradient.addColorStop(gradientStops.coolMid, '#2563eb');
  gradient.addColorStop(gradientStops.boundary, '#9ec5ff');
  gradient.addColorStop(gradientStops.boundary, '#ffe2c7');
  gradient.addColorStop(gradientStops.warmMid, '#f97316');
  gradient.addColorStop(1, '#7f1d1d');
  ctx.fillStyle = gradient;
  ctx.fillRect(barX, barY, barW, barH);
  ctx.strokeStyle = '#cbd5e1';
  ctx.strokeRect(barX, barY, barW, barH);

  ctx.font = '800 14px sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText('SPL dB', panelX + 12, panelY + 22);

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(panelX + 4, targetY);
  ctx.lineTo(panelX + 94, targetY);
  ctx.stroke();

  const targetText = `场景要求 ${params.minSplTarget.toFixed(0)} dB`;
  ctx.font = '800 11px sans-serif';
  const textW = Math.ceil(ctx.measureText(targetText).width);
  const textX = panelX + 96;
  const textY = Math.round(targetY - 9);
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fillRect(textX - 3, textY - 10, textW + 6, 16);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  ctx.strokeRect(textX - 3, textY - 10, textW + 6, 16);
  ctx.fillStyle = '#334155';
  ctx.fillText(targetText, textX, textY + 2);

  ctx.font = '800 12px sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText(params.cmax.toFixed(0), barX + barW + 10, barY + 4);
  ctx.fillText(params.cmin.toFixed(0), barX + barW + 10, barY + barH + 4);
  ctx.restore();
};

const createSpeakerWhiteModel = (
  speaker: DemoSpeaker,
  sizeScale: number,
  _color: THREE.Color,
) => {
  const group = new THREE.Group();
  const whiteMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.85, metalness: 0 });

  const width = 0.34 * sizeScale;
  const depth = 0.22 * sizeScale;
  const height = 0.46 * sizeScale;

  const body = new THREE.Mesh(new THREE.BoxGeometry(width, depth, height), whiteMat);
  body.position.set(0, 0, 0);
  group.add(body);

  const grille = new THREE.Mesh(new THREE.BoxGeometry(width * 0.84, depth * 0.08, height * 0.7), darkMat);
  grille.position.set(0, depth * 0.47, 0.01);
  group.add(grille);

  const horn = new THREE.Mesh(
    new THREE.CylinderGeometry(width * 0.1, width * 0.18, depth * 0.24, 18, 1, true),
    darkMat
  );
  horn.rotation.x = Math.PI / 2;
  horn.position.set(0, depth * 0.5, height * 0.2);
  group.add(horn);

  const standHeight = Math.max(0.4, speaker.position[2] - height * 0.55);
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(width * 0.04, width * 0.05, standHeight, 14),
    darkMat
  );
  stand.position.set(0, 0, -height * 0.52 - standHeight / 2 + speaker.position[2]);
  group.add(stand);

  return group;
};

const disposeSceneResources = (scene: THREE.Scene) => {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach((mat) => mat.dispose());
    } else if (material) {
      material.dispose();
    }
  });
};

const AcousticSimulationDemo: React.FC<AcousticSimulationDemoProps> = ({ params, scenario, items = [], layoutItems = [], solutionId, onApplyLayout }) => {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const scenePanelRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const dragHandlesRef = useRef<THREE.Object3D[]>([]);
  const speakerMeshesRef = useRef<THREE.Object3D[]>([]);
  const splFloorRef = useRef<THREE.Mesh | null>(null);
  const speakerLabelsRef = useRef<THREE.Sprite[]>([]);
  const coverageMeshesRef = useRef<THREE.Mesh[]>([]);
  const [plotError, setPlotError] = useState('');
  const [plotReady, setPlotReady] = useState(false);
  const [simulationData, setSimulationData] = useState<SimulationResult | null>(null);
  const [simulationError, setSimulationError] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [optimizationStep, setOptimizationStep] = useState(0);
  const [optimizationRound, setOptimizationRound] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showCoverage, setShowCoverage] = useState(true);
  const showCoverageRef = useRef(showCoverage);
  const [isSceneFullscreen, setIsSceneFullscreen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const editModeRef = useRef(false);
  const [selectedSpeakerIndex, setSelectedSpeakerIndex] = useState<number | null>(null);
  const [editedSpeakers, setEditedSpeakers] = useState<DemoSpeaker[] | null>(null);
  const speakerItems = useMemo(() => items.filter(isSimulationSpeakerItem), [items]);
  const simulationTargets = useMemo(() => getSimulationTargets(scenario), [scenario]);
  const requestSignatures = useMemo(
    () => buildSimulationCacheSignatures(solutionId, scenario, params, items, layoutItems, simulationTargets),
    [items, layoutItems, params, scenario, solutionId, simulationTargets],
  );

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

  const fallbackSpeakers = useMemo(() => buildDemoSpeakers(fallbackRoom, items, layoutItems, scenario), [items, layoutItems, fallbackRoom, scenario]);
  const baseSpeakers = useMemo(() => {
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
  // 如果用户拖拽编辑过，用 editedSpeakers 覆盖原始位置
  const speakers = useMemo(() => {
    if (editedSpeakers && editedSpeakers.length > 0) return editedSpeakers;
    return baseSpeakers;
  }, [baseSpeakers, editedSpeakers]);

  const fallbackSplField = useMemo(() => buildSplField(fallbackRoom, fallbackSpeakers), [fallbackRoom, fallbackSpeakers]);
  const editedSplField = useMemo(() => {
    if (!editedSpeakers || editedSpeakers.length === 0) return null;
    return buildSplField(room, editedSpeakers);
  }, [room, editedSpeakers]);
  const splField = useMemo(() => {
    if (editedSplField) return editedSplField;
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
  }, [editedSplField, fallbackSplField, simulationData]);
  const minSplTarget = Number(simulationData?.config?.targets?.min_spl_db || simulationTargets.minSpl);
  const { cmin, cmax } = useMemo(() => {
    const lower = Math.min(splField.min, minSplTarget - 3);
    const upper = Math.max(splField.max, minSplTarget + 3);
    return {
      cmin: Math.floor(Math.min(80, lower - 2)),
      cmax: Math.ceil(Math.max(105, upper + 2)),
    };
  }, [minSplTarget, splField.max, splField.min]);
  const colorbarTargetBottomPercent = Math.max(0, Math.min(100, ((minSplTarget - cmin) / Math.max(1, cmax - cmin)) * 100));
  const splLegendGradient = useMemo(() => {
    const stops = buildSplLegendGradientStops(colorbarTargetBottomPercent);
    return `linear-gradient(to top, #0a2d6d 0%, #2563eb ${(stops.coolMid * 100).toFixed(2)}%, #9ec5ff ${(stops.boundary * 100).toFixed(2)}%, #ffe2c7 ${(stops.boundary * 100).toFixed(2)}%, #f97316 ${(stops.warmMid * 100).toFixed(2)}%, #7f1d1d 100%)`;
  }, [colorbarTargetBottomPercent]);

  const standardRows = useMemo(() => {
    const uniformityTarget = Number(simulationData?.config?.targets?.max_nonuniformity_db ?? simulationTargets.maxUniformity);
    const headroomTarget = Number(simulationData?.config?.targets?.min_headroom_db ?? simulationTargets.minHeadroom);
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
  }, [minSplTarget, simulationData, splField.max, splField.min, simulationTargets]);

  useEffect(() => {
    abortRef.current?.abort();
    const cached = readSimulationResultCache(requestSignatures);
    setSimulationError('');
    // 仅在命中缓存时恢复仿真数据；未命中时保留当前仿真结果不消失
    // 用户点击“启动方案设计”后组件卸载，仿真结果自然清除
    if (cached) {
      setSimulationData(cached);
      setIsSimulating(false);
      setOptimizationStep(0);
      setOptimizationRound(0);
      setElapsedSeconds(0);
      // 从缓存恢复后立即持久化到 window（不依赖 Three.js 渲染）
      try {
        const best = (cached.best || {}) as any;
        const cfg = (cached.config || {}) as any;
        window.__acousticSimulationLatestPayload = {
          solutionId: String(solutionId || ''),
          payload: {
            generatedAt: new Date().toISOString(),
            scenario,
            room: { length: cfg.room?.length_m || 0, width: cfg.room?.width_m || 0, height: cfg.room?.height_m || 0 },
            images: {},
            metrics: {
              feasible: Boolean(best.feasible),
              minSpl: Number((best.minSpl || 0).toFixed(2)),
              avgSpl: Number((best.avgSpl || 0).toFixed(2)),
              maxSpl: Number((best.maxSpl || 0).toFixed(2)),
              minSplTarget: Number((cfg.targets?.min_spl_db || 95).toFixed(2)),
              nonuniformity: Number((best.nonuniformity || 0).toFixed(2)),
              nonuniformityTarget: Number((cfg.targets?.max_nonuniformity_db || 8).toFixed(2)),
              headroom: Number((best.headroom || 0).toFixed(2)),
              headroomTarget: Number((cfg.targets?.min_headroom_db || 3).toFixed(2)),
            },
            standards: [
              { name: '最大声压级', standard: `≥${cfg.targets?.min_spl_db || 95}dB (GB 50371-2006一级)`, value: `${(best.maxSpl || 0).toFixed(1)}dB`, pass: (best.maxSpl || 0) >= (cfg.targets?.min_spl_db || 95) },
              { name: '声场不均匀度', standard: `≤${cfg.targets?.max_nonuniformity_db || 8}dB (GB 50371-2006一级)`, value: `${(best.nonuniformity || 0).toFixed(1)}dB`, pass: (best.nonuniformity || 99) <= (cfg.targets?.max_nonuniformity_db || 8) },
              { name: '最低点声压余量', standard: `≥${cfg.targets?.min_headroom_db || 3}dB`, value: `${(best.headroom || 0).toFixed(1)}dB`, pass: (best.headroom || 0) >= (cfg.targets?.min_headroom_db || 3) },
            ],
            speakers: (best.speakers || []).map((s: any, i: number) => ({
              index: i + 1,
              label: s.sourceLabel || s.sourceName || `${s.model || '音箱'} #${i + 1}`,
              model: s.model || '',
              role: s.role || '',
              position: s.position || [],
              pitch: Number(s.aim?.[0] || 0),
              yaw: Number(s.aim?.[1] || 0),
              gainDb: Number(s.gainDb || 0),
              coverageH: Number(s.coverageH || 0),
              coverageV: Number(s.coverageV || 0),
            })),
          }
        };
        console.log('[SIM_PERSIST] ✅ 从缓存恢复后已持久化到 window');
      } catch (e) { console.warn('[SIM_PERSIST] 缓存恢复持久化失败:', e); }
    }
  }, [requestSignatures]);

  useEffect(() => {
    showCoverageRef.current = showCoverage;
  }, [showCoverage]);

  // Sync edit mode state
  useEffect(() => {
    editModeRef.current = editMode;
    if (!editMode) setSelectedSpeakerIndex(null);
  }, [editMode]);

  // Sync speakers/splField changes to existing 3D scene objects (no full rebuild)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const currentSpeakers = editedSpeakers ?? baseSpeakers;

    // Update speaker group positions and label positions
    const meshes = speakerMeshesRef.current;
    const labels = speakerLabelsRef.current;
    const handles = dragHandlesRef.current;
    currentSpeakers.forEach((speaker, i) => {
      const g = meshes[i];
      if (g) g.position.set(speaker.position[0], speaker.position[1], speaker.position[2]);
      const l = labels[i];
      if (l) l.position.set(speaker.position[0], speaker.position[1], speaker.position[2] + 0.45);
      const h = handles[i];
      if (h) h.position.set(speaker.position[0], speaker.position[1], speaker.position[2]);
    });

    // Update SPL floor vertex colors
    const floorMesh = splFloorRef.current;
    if (floorMesh && simulationData) {
      const sampleSpl = buildSplSampler(splField);
      const geometry = floorMesh.geometry;
      const positions = geometry.attributes.position;
      const colors: number[] = [];
      for (let i = 0; i < positions.count; i += 1) {
        const vx = positions.getX(i) + room.length / 2;
        const vy = positions.getY(i) + room.width / 2;
        const spl = sampleSpl(vx, vy);
        const color = splToRequirementColor(spl, minSplTarget, cmin, cmax);
        colors.push(color.r, color.g, color.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.attributes.color.needsUpdate = true;
    }
  }, [baseSpeakers, editedSpeakers, speakers, splField, minSplTarget, cmin, cmax, room, simulationData]);

  const handleApplyLayout = useCallback(() => {
    if (!onApplyLayout) return;
    const currentSpeakers = editedSpeakers ?? speakers;
    const applied: SolutionLayoutItem[] = currentSpeakers.map((s) => ({
      id: s.sourceItemId || '',
      function: s.role,
      name: s.sourceName || '',
      model: s.model,
      x: s.position[0],
      y: s.position[1],
      z: s.position[2],
      pitch: s.aim[0],
      yaw: s.aim[1],
    }));
    onApplyLayout(applied);
  }, [editedSpeakers, onApplyLayout, speakers]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsSceneFullscreen(document.fullscreenElement === scenePanelRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  const toggleSceneFullscreen = async () => {
    const panel = scenePanelRef.current;
    if (!panel) return;
    try {
      if (document.fullscreenElement === panel) {
        await document.exitFullscreen();
        return;
      }
      await panel.requestFullscreen();
    } catch (error) {
      console.error('❌ Toggle fullscreen failed:', error);
    }
  };

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
    postSimulationRun(
      {
        params,
        items,
        layoutItems,
        targets: simulationTargets,
        listener: {
          frontMargin: scenario === Scenario.LECTURE_HALL
            ? Math.max(3, (Number(params.stageDepth) || 2) + (Number(params.stageToNearAudience) || 2))
            : 1.2,
          rearMargin: 0.8,
          sideMargin: 0.7,
          earHeight: 1.2,
        },
      },
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        writeSimulationResultCache(requestSignatures, data);
        setSimulationData(data);
        setOptimizationStep(3);
        // 立即持久化仿真数据到 window（不依赖 Three.js 渲染）
        try {
          const best = (data?.best || {}) as any;
          const cfg = (data?.config || {}) as any;
          const spks = (data?.best?.speakers || []).map((s: any, i: number) => ({
            index: i + 1,
            label: s.sourceLabel || s.sourceName || `${s.model || '音箱'} #${i + 1}`,
            model: s.model || '',
            role: s.role || '',
            position: s.position || [],
            pitch: Number(s.aim?.[0] || 0),
            yaw: Number(s.aim?.[1] || 0),
            gainDb: Number(s.gainDb || 0),
            coverageH: Number(s.coverageH || 0),
            coverageV: Number(s.coverageV || 0),
          }));
          window.__acousticSimulationLatestPayload = {
            solutionId: String(solutionId || ''),
            payload: {
              generatedAt: new Date().toISOString(),
              scenario,
              room: { length: cfg.room?.length_m || 0, width: cfg.room?.width_m || 0, height: cfg.room?.height_m || 0 },
              images: {}, // 图片由后续 useEffect 补填
              metrics: {
                feasible: Boolean(best.feasible),
                minSpl: Number((best.minSpl || 0).toFixed(2)),
                avgSpl: Number((best.avgSpl || 0).toFixed(2)),
                maxSpl: Number((best.maxSpl || 0).toFixed(2)),
                minSplTarget: Number((cfg.targets?.min_spl_db || 95).toFixed(2)),
                nonuniformity: Number((best.nonuniformity || 0).toFixed(2)),
                nonuniformityTarget: Number((cfg.targets?.max_nonuniformity_db || 8).toFixed(2)),
                headroom: Number((best.headroom || 0).toFixed(2)),
                headroomTarget: Number((cfg.targets?.min_headroom_db || 3).toFixed(2)),
              },
              standards:
                [
                  { name: '最大声压级', standard: `≥${cfg.targets?.min_spl_db || 95}dB (GB 50371-2006一级)`, value: `${(best.maxSpl || 0).toFixed(1)}dB`, pass: (best.maxSpl || 0) >= (cfg.targets?.min_spl_db || 95) },
                  { name: '声场不均匀度', standard: `≤${cfg.targets?.max_nonuniformity_db || 8}dB (GB 50371-2006一级)`, value: `${(best.nonuniformity || 0).toFixed(1)}dB`, pass: (best.nonuniformity || 99) <= (cfg.targets?.max_nonuniformity_db || 8) },
                  { name: '最低点声压余量', standard: `≥${cfg.targets?.min_headroom_db || 3}dB`, value: `${(best.headroom || 0).toFixed(1)}dB`, pass: (best.headroom || 0) >= (cfg.targets?.min_headroom_db || 3) },
                ],
              speakers: spks,
            }
          };
          console.log('[SIM_PERSIST] ✅ 仿真结果已立即持久化，solutionId=' + solutionId);
        } catch (e) { console.warn('[SIM_PERSIST] 持久化失败:', e); }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSimulationData(null);
        setSimulationError(toDisplaySimulationError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsSimulating(false);
      });
  };

  const exportTopViewPng = useCallback(async (fileName?: string) => {
    const captureSimulationSnapshot = async (view: SimulationSnapshotView) => {
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      const controls = controlsRef.current;
      if (!scene || !camera || !renderer || !simulationData) return '';

      const prevPosition = camera.position.clone();
      const prevQuaternion = camera.quaternion.clone();
      const prevUp = camera.up.clone();
      const prevZoom = camera.zoom;
      const prevTarget = controls?.target.clone();
      const coneStates: Array<{ object: THREE.Object3D; visible: boolean }> = [];

      try {
        // Both side and top views: hide coverage cones for clean rendering
        scene.traverse((object) => {
          if (object.userData?.coverageCone) {
            coneStates.push({ object, visible: object.visible });
            object.visible = false;
          }
        });

        if (view === 'top') {
          camera.up.set(0, 1, 0);
          camera.position.set(room.length * 0.5, room.width * 0.5, room.height + Math.max(4, Math.max(room.length, room.width) * 0.65));
          camera.lookAt(room.length * 0.5, room.width * 0.5, 0.2);
          camera.zoom = prevZoom * 1.2;
          camera.updateProjectionMatrix();

          if (controls) {
            controls.target.set(room.length * 0.5, room.width * 0.5, 0.2);
            controls.update();
          }

          renderer.render(scene, camera);
          const composedCanvas = document.createElement('canvas');
          composedCanvas.width = renderer.domElement.width;
          composedCanvas.height = renderer.domElement.height;
          const composedCtx = composedCanvas.getContext('2d');
          if (!composedCtx) return '';

          composedCtx.drawImage(renderer.domElement, 0, 0);
          drawSplLegendOnCanvas(composedCtx, composedCanvas.width, composedCanvas.height, {
            cmin,
            cmax,
            minSplTarget,
            targetBottomPercent: colorbarTargetBottomPercent,
          });

          return composedCanvas.toDataURL('image/png');
        }

        // Side view: 45° isometric from top-left, zoomed in
        camera.up.set(0, 0, 1);
        const isoDist = Math.max(room.length, room.width) * 0.42;
        const a45 = Math.PI / 4;
        camera.position.set(room.length * 0.5 - isoDist * Math.cos(a45), room.width * 0.5 - isoDist * Math.sin(a45), room.height * 0.38);
        camera.lookAt(room.length * 0.5, room.width * 0.5, room.height * 0.22);
        camera.zoom = prevZoom * 1.25;
        camera.updateProjectionMatrix();
        if (controls) {
          controls.target.set(room.length * 0.5, room.width * 0.5, room.height * 0.3);
          controls.update();
        }
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
      } catch (error) {
        console.error('❌ Capture simulation snapshot failed:', error);
        return '';
      } finally {
        coneStates.forEach(({ object, visible }) => {
          object.visible = visible;
        });
        camera.position.copy(prevPosition);
        camera.quaternion.copy(prevQuaternion);
        camera.up.copy(prevUp);
        camera.zoom = prevZoom;
        camera.updateProjectionMatrix();
        if (controls && prevTarget) {
          controls.target.copy(prevTarget);
          controls.update();
        }
        renderer.render(scene, camera);
      }
    };

    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!scene || !camera || !renderer || !simulationData) return false;

    try {
      const url = await captureSimulationSnapshot('top');
      if (!url) return false;
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${fileName || '逆向设计俯视图'}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    } catch (error) {
      console.error('❌ Export inverse-design top view failed:', error);
      return false;
    }
  }, [cmax, cmin, colorbarTargetBottomPercent, minSplTarget, room.length, room.width, room.height, simulationData]);

  const buildSimulationReportPayload = useCallback(async () => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!scene || !camera || !renderer || !simulationData) return null;

    const captureSimulationSnapshot = async (view: SimulationSnapshotView) => {
      const controls = controlsRef.current;
      const prevPosition = camera.position.clone();
      const prevQuaternion = camera.quaternion.clone();
      const prevUp = camera.up.clone();
      const prevZoom = camera.zoom;
      const prevTarget = controls?.target.clone();
      const coneStates: Array<{ object: THREE.Object3D; visible: boolean }> = [];

      try {
        // Always hide coverage cones for clean rendering
        scene.traverse((object) => {
          if (object.userData?.coverageCone) {
            coneStates.push({ object, visible: object.visible });
            object.visible = false;
          }
        });

        if (view === 'top') {
          camera.up.set(0, 1, 0);
          camera.position.set(room.length * 0.5, room.width * 0.5, room.height + Math.max(4, Math.max(room.length, room.width) * 0.65));
          camera.lookAt(room.length * 0.5, room.width * 0.5, 0.2);
          camera.zoom = prevZoom * 1.2;
          camera.updateProjectionMatrix();

          if (controls) {
            controls.target.set(room.length * 0.5, room.width * 0.5, 0.2);
            controls.update();
          }

          renderer.render(scene, camera);
          const composedCanvas = document.createElement('canvas');
          composedCanvas.width = renderer.domElement.width;
          composedCanvas.height = renderer.domElement.height;
          const composedCtx = composedCanvas.getContext('2d');
          if (!composedCtx) return '';

          composedCtx.drawImage(renderer.domElement, 0, 0);
          drawSplLegendOnCanvas(composedCtx, composedCanvas.width, composedCanvas.height, {
            cmin,
            cmax,
            minSplTarget,
            targetBottomPercent: colorbarTargetBottomPercent,
          });

          return composedCanvas.toDataURL('image/png');
        }

        // Side view: 45° isometric from top-left, zoomed in
        camera.up.set(0, 0, 1);
        const isoDist = Math.max(room.length, room.width) * 0.38;
        const a45 = Math.PI / 4;
        camera.position.set(room.length * 0.5 - isoDist * Math.cos(a45), room.width * 0.5 - isoDist * Math.sin(a45), room.height * 0.35);
        camera.lookAt(room.length * 0.5, room.width * 0.5, room.height * 0.2);
        camera.zoom = prevZoom * 1.3;
        camera.updateProjectionMatrix();
        if (controls) {
          controls.target.set(room.length * 0.5, room.width * 0.5, room.height * 0.28);
          controls.update();
        }
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
      } catch (error) {
        console.error('❌ Capture simulation snapshot failed:', error);
        return '';
      } finally {
        coneStates.forEach(({ object, visible }) => {
          object.visible = visible;
        });
        camera.position.copy(prevPosition);
        camera.quaternion.copy(prevQuaternion);
        camera.up.copy(prevUp);
        camera.zoom = prevZoom;
        camera.updateProjectionMatrix();
        if (controls && prevTarget) {
          controls.target.copy(prevTarget);
          controls.update();
        }
        renderer.render(scene, camera);
      }
    };

    // 只获取俯视图（侧视图在3.2.2设计效果中使用，仿真章节不需要）
    const topImage = await captureSimulationSnapshot('top');
    const sideImage = await captureSimulationSnapshot('side');

    const uniformityTarget = Number(simulationData?.config?.targets?.max_nonuniformity_db ?? simulationTargets.maxUniformity);
    const headroomTarget = Number(simulationData?.config?.targets?.min_headroom_db ?? simulationTargets.minHeadroom);
    const nonuniformity = Number(simulationData?.best?.nonuniformity || (splField.max - splField.min));
    const headroom = Number(simulationData?.best?.headroom ?? (splField.min - minSplTarget));

    return {
      generatedAt: new Date().toISOString(),
      scenario,
      room: {
        length: room.length,
        width: room.width,
        height: room.height,
      },
      images: {
        side: sideImage,
        top: topImage,
      },
      metrics: {
        feasible: Boolean(simulationData?.best?.feasible),
        minSpl: Number(splField.min.toFixed(2)),
        avgSpl: Number(splField.avg.toFixed(2)),
        maxSpl: Number(splField.max.toFixed(2)),
        minSplTarget: Number(minSplTarget.toFixed(2)),
        nonuniformity: Number(nonuniformity.toFixed(2)),
        nonuniformityTarget: Number(uniformityTarget.toFixed(2)),
        headroom: Number(headroom.toFixed(2)),
        headroomTarget: Number(headroomTarget.toFixed(2)),
      },
      standards: standardRows.map((row) => ({
        name: row.name,
        standard: row.standard,
        value: row.value,
        pass: row.pass,
      })),
      speakers: speakers.map((speaker, index) => ({
        index: index + 1,
        label: speaker.sourceLabel || speaker.sourceName || `${speaker.model || '音箱'} #${index + 1}`,
        model: speaker.model || '',
        role: speaker.role || '',
        position: speaker.position,
        pitch: Number(speaker.aim?.[0] || 0),
        yaw: Number(speaker.aim?.[1] || 0),
        gainDb: Number(speaker.gainDb || 0),
        coverageH: Number(speaker.coverageH || 0),
        coverageV: Number(speaker.coverageV || 0),
      })),
    };
  }, [cmax, cmin, colorbarTargetBottomPercent, minSplTarget, room.height, room.length, room.width, scenario, simulationData, speakers, splField.avg, splField.max, splField.min, standardRows]);

  const standardsPass = useMemo(
    () => Boolean(simulationData) && standardRows.every((row) => row.pass),
    [simulationData, standardRows],
  );

  useEffect(() => {
    window.__acousticSimulationDownloadPng = exportTopViewPng;
    return () => {
      if (window.__acousticSimulationDownloadPng === exportTopViewPng) {
        delete window.__acousticSimulationDownloadPng;
      }
    };
  }, [exportTopViewPng]);

  // 仿真数据一就绪立刻持久化到 window，确保离开仿真页面后仍可用于报告生成
  // 触发时机: 1) 新仿真完成 (step=3)  2) 从缓存恢复旧仿真 (mount 时 setSimulationData)
  const lastPersistedDataRef = useRef<any>(null);
  useEffect(() => {
    if (!simulationData) return;
    // 避免对同一份数据重复持久化
    const dataFingerprint = JSON.stringify(simulationData.best || {}).slice(0, 100);
    if (dataFingerprint === lastPersistedDataRef.current) return;
    lastPersistedDataRef.current = dataFingerprint;

    let cancelled = false;
    const savePayload = async () => {
      // 延迟 2s 等 Three.js 场景渲染完毕，补填仿真截图
      await new Promise(r => setTimeout(r, 2000));
      if (cancelled) return;
      const payload = await buildSimulationReportPayload();
      if (!cancelled && payload && typeof payload === 'object') {
        // 合并到已有 payload（保留立即持久化的 metrics/standards/speakers）
        const existing = window.__acousticSimulationLatestPayload;
        window.__acousticSimulationLatestPayload = {
          solutionId: String(solutionId || existing?.solutionId || ''),
          payload: {
            ...(existing?.payload || {}),
            images: payload.images || existing?.payload?.images || {},
          }
        };
        console.log('[SIM_PERSIST] ✅ 仿真截图已补填');
      }
    };
    savePayload();
    return () => { cancelled = true; };
  }, [simulationData, buildSimulationReportPayload, solutionId]);

  useEffect(() => {
    const reportProvider = async (requestedSolutionId?: string) => {
      const requested = String(requestedSolutionId || '').trim();
      const currentSolutionId = String(solutionId || '').trim();
      if (requested && currentSolutionId && requested !== currentSolutionId) {
        return null;
      }
      const payload = await buildSimulationReportPayload();
      if (payload && typeof payload === 'object') {
        // 持久化到 window，即使组件卸载也能被报告生成读取
        window.__acousticSimulationLatestPayload = { solutionId: currentSolutionId, payload };
      }
      return payload || null;
    };

    window.__acousticSimulationGetReportPayload = reportProvider;
    return () => {
      // 组件卸载时保留 __acousticSimulationLatestPayload 供报告生成使用
      // 只清理 __acousticSimulationGetReportPayload（动态数据采集函数）
      if (window.__acousticSimulationGetReportPayload === reportProvider) {
        delete window.__acousticSimulationGetReportPayload;
      }
    };
  }, [buildSimulationReportPayload, solutionId]);

  useEffect(() => {
    const mount = plotRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let frameId = 0;

    mount.innerHTML = '';
    setPlotError('');
    setPlotReady(false);

    if (!simulationData) {
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      setPlotReady(true);
      return;
    }

    try {
      const width = Math.max(320, mount.clientWidth || 320);
      const height = Math.max(320, mount.clientHeight || 320);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#e8e8e8');

      const maxDim = Math.max(room.length, room.width, room.height);
      const frustum = maxDim * 0.72;
      const aspect = width / height;
      const camera = new THREE.OrthographicCamera(
        -frustum * aspect, frustum * aspect, frustum, -frustum, 0.1, 600,
      );
      camera.up.set(0, 0, 1);
      camera.position.set(room.length * 1.22, -room.width * 1.3, room.height * 1.22);
      camera.lookAt(room.length * 0.5, room.width * 0.5, room.height * 0.48);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(width, height);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.localClippingEnabled = true;
      mount.appendChild(renderer.domElement);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(room.length * 0.5, room.width * 0.52, room.height * 0.45);
      controls.minZoom = 0.42;
      controls.maxZoom = 4.5;

      sceneRef.current = scene;
      cameraRef.current = camera;
      rendererRef.current = renderer;
      controlsRef.current = controls;

      // Soft even skylight for white model look
      scene.add(new THREE.AmbientLight('#ffffff', 0.85));
      const hemi = new THREE.HemisphereLight('#ffffff', '#d0d0d0', 0.5);
      hemi.position.set(0, 0, 35);
      scene.add(hemi);
      const key = new THREE.DirectionalLight('#ffffff', 0.4);
      key.position.set(room.length * 0.3, -room.width * 0.5, room.height * 2);
      scene.add(key);

      const coverageMeshes: THREE.Mesh[] = [];
      const savedSpeakerMeshes: THREE.Object3D[] = [];
      const savedSpeakerLabels: THREE.Sprite[] = [];
      const wallThickness = 0.14;
      const wallHeight = room.height + Math.max(0.45, room.height * 0.08);

      // 房间裁剪平面——用于裁掉音响锥形超出包围盒的部分
      // THREE.Plane(normal, constant): 满足 normal·point + constant < 0 的部分被裁掉
      const pad = 0.06;
      const roomClipPlanes = [
        new THREE.Plane(new THREE.Vector3( 1,  0,  0), -pad),                 // 裁掉 x < pad → 保留 x >= pad
        new THREE.Plane(new THREE.Vector3(-1,  0,  0), room.length - pad),    // 裁掉 x > room.length - pad
        new THREE.Plane(new THREE.Vector3( 0,  1,  0), -pad),                 // 裁掉 y < pad
        new THREE.Plane(new THREE.Vector3( 0, -1,  0), room.width - pad),     // 裁掉 y > room.width - pad
        new THREE.Plane(new THREE.Vector3( 0,  0,  1), -pad),                 // 裁掉 z < pad
        new THREE.Plane(new THREE.Vector3( 0,  0, -1), room.height - pad),    // 裁掉 z > room.height - pad
      ];

      // White floor
      const floorMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.length + 0.22, room.width + 0.22), floorMat);
      floor.position.set(room.length / 2, room.width / 2, 0);
      scene.add(floor);

      // Pure white matte wall material
      const wallMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });
      // Transparent glass (fully see-through)
      const glassMat = new THREE.MeshStandardMaterial({ color: '#dce8f4', roughness: 0.02, metalness: 0.02, transparent: true, opacity: 0.22, depthWrite: false });
      // Trim: slightly darker white for depth
      const trimMat = new THREE.MeshStandardMaterial({ color: '#f0f0f0', roughness: 0.85, metalness: 0 });

      const addBox = (sz: [number, number, number], pos: [number, number, number], mat: THREE.Material) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sz[0], sz[1], sz[2]), mat);
        m.position.set(pos[0], pos[1], pos[2]); scene.add(m); return m;
      };

      const sampleSpl = buildSplSampler(splField);
      // 存储 SPL 地板引用，用于后续更新色温
      const splFloor = addSplFloorMesh(scene, room, sampleSpl, minSplTarget, cmin, cmax);
      splFloorRef.current = splFloor;

      const wSill = Math.min(1.0, room.height * 0.28);
      const wTop = Math.min(2.2, wallHeight - 0.5);
      const wH = Math.max(0.8, wTop - wSill);
      const wW = Math.min(2.2, Math.max(1.2, room.length * 0.17));
      const windowCenters = [room.length * 0.33, room.length * 0.68];

      const addBackWallBand = (x0: number, x1: number, z0: number, z1: number) => {
        const width = x1 - x0;
        const height = z1 - z0;
        if (width <= 0.02 || height <= 0.02) return;
        addBox([width, wallThickness, height], [(x0 + x1) * 0.5, room.width, (z0 + z1) * 0.5], wallMat);
      };

      const openingIntervals = windowCenters
        .map((center) => [Math.max(0, center - wW * 0.5), Math.min(room.length, center + wW * 0.5)] as [number, number])
        .filter(([start, end]) => end - start > 0.08)
        .sort((a, b) => a[0] - b[0]);
      const mergedOpenings: Array<[number, number]> = [];
      openingIntervals.forEach(([start, end]) => {
        const last = mergedOpenings[mergedOpenings.length - 1];
        if (!last || start > last[1] + 0.04) {
          mergedOpenings.push([start, end]);
          return;
        }
        last[1] = Math.max(last[1], end);
      });

      // Front and side walls keep full geometry; back wall is cut with real window openings.
      addBox([room.length, wallThickness, wallHeight], [room.length / 2, 0, wallHeight / 2], wallMat);
      addBox([wallThickness, room.width, wallHeight], [0, room.width / 2, wallHeight / 2], wallMat);
      addBox([wallThickness, room.width, wallHeight], [room.length, room.width / 2, wallHeight / 2], wallMat);

      let cursorX = 0;
      mergedOpenings.forEach(([start, end]) => {
        addBackWallBand(cursorX, start, 0, wallHeight);
        addBackWallBand(start, end, 0, wSill);
        addBackWallBand(start, end, wSill + wH, wallHeight);
        cursorX = end;
      });
      addBackWallBand(cursorX, room.length, 0, wallHeight);

      // Door with frame + panel + handle
      const dW = Math.min(1.0, Math.max(0.85, room.length * 0.06));
      const dH = Math.min(2.1, wallHeight - 0.4);
      const dX = room.length * 0.12;
      const doorGroup = new THREE.Group();
      doorGroup.position.set(dX, wallThickness * 0.25, 0);
      // Frame
      const fw = 0.06;
      addBox([fw, wallThickness * 0.5, dH + fw * 2], [dX, wallThickness * 0.3, dH / 2], trimMat);
      addBox([dW + fw, wallThickness * 0.5, fw], [dX, wallThickness * 0.3, dH + fw / 2], trimMat);
      // Panel
      addBox([dW, wallThickness * 0.35, dH], [dX, wallThickness * 0.35, dH / 2], wallMat);
      // Handle
      addBox([0.06, wallThickness * 0.15, 0.14], [dX + dW * 0.4, wallThickness * 0.5, dH * 0.55], trimMat);

      // Windows (transparent glass embedded in wall openings)
      const frameDepth = wallThickness * 0.86;
      const glassDepth = wallThickness * 0.34;
      const backWallInnerY = room.width - wallThickness * 0.06;
      mergedOpenings.forEach(([start, end]) => {
        const wX = (start + end) * 0.5;
        const openingW = end - start;
        if (openingW <= 0.08) return;
        addBox([openingW + 0.04, frameDepth, wH + 0.04], [wX, backWallInnerY, wSill + wH / 2], trimMat);
        addBox([openingW - 0.02, glassDepth, wH - 0.02], [wX, backWallInnerY, wSill + wH / 2], glassMat);
      });

      // White model base materials with SPL color blending
      const makeSplBlendMat = (x: number, y: number, baseColor: string = '#ffffff', roughness: number = 0.85, blend: number = 0.14) => {
        const spl = sampleSpl(x, y);
        const splColor = splToRequirementColor(spl, minSplTarget, cmin, cmax);
        const color = splColor.clone().lerp(new THREE.Color(baseColor), blend);
        return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
      };
      const wmLight = new THREE.MeshStandardMaterial({ color: '#f0f0f0', roughness: 0.82, metalness: 0 });
      const wmDark  = new THREE.MeshStandardMaterial({ color: '#e0e0e0', roughness: 0.78, metalness: 0 });

      const addChair = (
        center: [number, number, number],
        target: [number, number, number],
        seatW: number, seatD: number, seatH: number,
        backH: number,
      ) => {
        const g = new THREE.Group();
        g.position.set(center[0], center[1], 0);
        const angle = Math.atan2(target[1] - center[1], target[0] - center[0]) - Math.PI / 2;
        g.rotation.z = angle;

        // Seat cushion with SPL color
        const seatMat = makeSplBlendMat(center[0], center[1], '#ffffff', 0.8, 0.22);
        const seat = new THREE.Mesh(new THREE.CylinderGeometry(seatW * 0.4, seatW * 0.42, seatH, 24), seatMat);
        seat.rotation.x = Math.PI / 2;
        seat.position.set(0, 0, 0.44);
        g.add(seat);

        // Backrest
        const back = new THREE.Mesh(new THREE.BoxGeometry(seatW * 0.88, 0.04, backH), wmLight);
        back.position.set(0, -seatD * 0.42, 0.44 + backH * 0.5);
        g.add(back);

        // Armrests
        [-1, 1].forEach(side => {
          const armPad = new THREE.Mesh(new THREE.BoxGeometry(0.06, seatD * 0.7, 0.04), wmLight);
          armPad.position.set(side * seatW * 0.35, 0, 0.44 + seatH * 0.5);
          g.add(armPad);
          const armSupport = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.25, 12), wmDark);
          armSupport.position.set(side * seatW * 0.35, -seatD * 0.15, 0.32);
          g.add(armSupport);
        });

        // Legs
        const legOffsets: Array<[number, number]> = [[0.3, 0.28], [-0.3, 0.28], [0.3, -0.28], [-0.3, -0.28]];
        legOffsets.forEach(([ox, oy]) => {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.38, 12), wmDark);
          leg.position.set(ox * seatW, oy * seatD, 0.22);
          g.add(leg);
        });

        // Base plate
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.03, 16), wmDark);
        base.position.set(0, 0, 0.04);
        g.add(base);

        scene.add(g);
      };

      if (scenario === Scenario.MEETING_ROOM) {
        const isLongRoom = room.length > 10;

        if (isLongRoom) {
          // Long room: lectern at front, rows of chairs facing front
          const lecternX = room.length * 0.5;
          const lecternY = room.width * 0.22;
          // Lectern body with SPL color
          const lecternMat = makeSplBlendMat(lecternX, lecternY, '#ffffff', 0.85, 0.24);
          addBox([0.5, 0.4, 1.1], [lecternX, lecternY, 0.6], lecternMat);
          // Lectern top
          addBox([0.56, 0.46, 0.06], [lecternX, lecternY - 0.02, 1.14], new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.8, metalness: 0 }));

          // Rows of chairs facing forward (all facing y=0)
          const frontY = room.width * 0.38;
          const rowSpan = Math.max(2, room.width * 0.48);
          const rowCount = Math.min(12, Math.max(4, Math.floor(rowSpan / 0.9)));
          const rowYs = linspace(frontY, frontY + rowSpan, rowCount);
          const seatSpan = Math.max(2.5, room.length * 0.7);
          const seatsPerRow = Math.max(4, Math.min(16, Math.floor(seatSpan / 0.62)));
          const seatXs = linspace(room.length * 0.5 - seatSpan * 0.5, room.length * 0.5 + seatSpan * 0.5, seatsPerRow);

          rowYs.forEach(rowY => {
            seatXs.forEach(seatX => {
              addChair([seatX, rowY, 0], [seatX, 0, 0], 0.48, 0.44, 0.09, 0.55);
            });
          });
        } else {
          // Standard room: conference table + chairs
          const tableCenter: [number, number, number] = [room.length * 0.52, room.width * 0.55, 0.77];
          const tableLength = Math.min(6.2, Math.max(2.8, room.length * 0.34));
          const tableWidth = Math.min(2.2, Math.max(1.15, room.width * 0.18));
          const tableMat = makeSplBlendMat(tableCenter[0], tableCenter[1], '#ffffff', 0.8, 0.22);
          addBox([tableLength, tableWidth, 0.1], tableCenter, tableMat);
          const tableLegs = [[-0.45, -0.42], [0.45, -0.42], [-0.45, 0.42], [0.45, 0.42]];
          tableLegs.forEach(([ox, oy]) => {
            addBox([0.08, 0.08, 0.68], [tableCenter[0] + ox * tableLength * 0.5, tableCenter[1] + oy * tableWidth * 0.5, 0.38], new THREE.MeshStandardMaterial({ color: '#f0f0f0', roughness: 0.85, metalness: 0 }));
          });

          const chairsPerRow = 5;
          const rowOffset = Math.max(0.72, tableWidth * 0.64);
          const spanX = Math.max(2.3, tableLength * 0.84);
          const chairXs = linspace(tableCenter[0] - spanX * 0.5, tableCenter[0] + spanX * 0.5, chairsPerRow);
          const frontRowY = Math.max(0.6, tableCenter[1] - rowOffset);
          const backRowY = Math.min(room.width - 0.6, tableCenter[1] + rowOffset);

          chairXs.forEach((x) => {
            addChair([x, frontRowY, 0], [x, tableCenter[1], 0], 0.48, 0.46, 0.09, 0.55);
            addChair([x, backRowY, 0], [x, tableCenter[1], 0], 0.48, 0.46, 0.09, 0.55);
          });
        }
      }

      if (scenario === Scenario.LECTURE_HALL) {
        const stageHeight = 1;
        const rawStageWidth = Number(params.stageWidth || room.length * 0.42);
        const rawStageDepth = Number(params.stageDepth || room.width * 0.14);
        const stageWidth = Math.max(2.4, Math.min(room.length - 0.8, Number.isFinite(rawStageWidth) ? rawStageWidth : room.length * 0.42));
        const stageDepth = Math.max(1, Math.min(room.width * 0.38, Number.isFinite(rawStageDepth) ? rawStageDepth : room.width * 0.14));
        const stageCenter: [number, number, number] = [room.length * 0.5, stageDepth * 0.5 + 0.08, stageHeight * 0.5];
        const stageMat = makeSplBlendMat(stageCenter[0], stageCenter[1], '#ffffff', 0.75, 0.2);
        addBox([stageWidth, stageDepth, stageHeight], stageCenter, stageMat);
        addBox([stageWidth, 0.08, 0.16], [stageCenter[0], stageCenter[1] + stageDepth * 0.5 - 0.02, 0.08], new THREE.MeshStandardMaterial({ color: '#f0f0f0', roughness: 0.85, metalness: 0 }));

        const stageLabel = makeTextSprite('STAGE', { color: '#1f2937', background: 'rgba(255,255,255,0.9)', fontSize: 32 });
        if (stageLabel) {
          stageLabel.position.set(stageCenter[0], stageCenter[1], stageHeight + 0.2);
          scene.add(stageLabel);
        }

        const nearInput = Number(params.stageToNearAudience);
        const farInput = Number(params.stageToFarAudience);
        const nearOffset = Number.isFinite(nearInput) && nearInput > 0 ? nearInput : Math.max(1.2, room.width * 0.12);
        const fallbackFar = Math.max(nearOffset + 2.4, room.width - stageDepth - 1.2);
        const farOffset = Number.isFinite(farInput) && farInput > nearOffset + 1 ? farInput : fallbackFar;
        const frontRowY = Math.min(room.width - 0.9, stageDepth + nearOffset);
        const backRowY = Math.min(room.width - 0.7, stageDepth + farOffset);
        const rowSpan = Math.max(1.8, backRowY - frontRowY);
        const rowCount = Math.max(3, Math.min(16, Math.floor(rowSpan / 0.95) + 1));
        const rowYs = linspace(frontRowY, frontRowY + rowSpan, rowCount);

        const seatSpanX = Math.max(3.2, Math.min(room.length - 1.2, stageWidth * 1.35));
        const seatsPerRow = Math.max(6, Math.min(24, Math.floor(seatSpanX / 0.62)));
        const seatXs = linspace(room.length * 0.5 - seatSpanX * 0.5, room.length * 0.5 + seatSpanX * 0.5, seatsPerRow);

        rowYs.forEach((rowY) => {
          seatXs.forEach((seatX) => {
            addChair([seatX, rowY, 0], [seatX, stageCenter[1], 0], 0.46, 0.42, 0.09, 0.52);
          });
        });
      }

      speakers.forEach((speaker, index) => {
        const speakerSpl = sampleSpl(speaker.position[0], speaker.position[1]);
        const grilleColor = splToRequirementColor(speakerSpl, minSplTarget, cmin, cmax);
        const speakerGroup = createSpeakerWhiteModel(speaker, 1, grilleColor);
        speakerGroup.userData = { type: 'speaker', speakerIndex: index };
        speakerGroup.position.set(speaker.position[0], speaker.position[1], speaker.position[2]);
        const forward = new THREE.Vector3(
          speaker.aim[0] - speaker.position[0],
          speaker.aim[1] - speaker.position[1],
          speaker.aim[2] - speaker.position[2],
        ).normalize();
        speakerGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);
        scene.add(speakerGroup);
        savedSpeakerMeshes.push(speakerGroup);

        const label = makeTextSprite(
          `${speaker.sourceRowIndex ? `#${speaker.sourceRowIndex}` : '#'}${speaker.sourceUnitIndex ? `-${speaker.sourceUnitIndex}` : index + 1}`,
          { color: '#334155', background: 'rgba(255,255,255,0.9)', fontSize: 34 },
        );
        if (label) {
          label.position.set(speaker.position[0], speaker.position[1], speaker.position[2] + 0.45);
          scene.add(label);
          savedSpeakerLabels.push(label);
        }

        {
          const coneLen = getWallOccludedConeLength(room, speaker.position, forward);
          const coneRadius = coneLen * Math.tan((speaker.coverageH / 2) * Math.PI / 180);
          const initialOpacity = showCoverageRef.current ? 0.12 : 0;
          const coverage = new THREE.Mesh(
            new THREE.ConeGeometry(coneRadius, coneLen, 30, 1, true),
            new THREE.MeshStandardMaterial({ color: '#38bdf8', transparent: true, opacity: initialOpacity, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: roomClipPlanes, clipShadows: true }),
          );
          coverage.userData.coverageCone = true;
          coverage.visible = initialOpacity > 0.002;
          coverage.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward.clone().negate());
          coverage.position.copy(new THREE.Vector3(...speaker.position).add(forward.clone().multiplyScalar(coneLen * 0.5)));
          coverageMeshes.push(coverage);
          scene.add(coverage);
        }
      });

      addDimensionAnnotations(scene, room, wallHeight);

      const handleResize = () => {
        if (!mount || !renderer) return;
        const w = Math.max(320, mount.clientWidth || 320);
        const h = Math.max(320, mount.clientHeight || 320);
        const nextAspect = w / h;
        camera.left = -frustum * nextAspect;
        camera.right = frustum * nextAspect;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(mount);
      }

      const animate = () => {
        if (!renderer || !controls) return;
        const targetCoverageOpacity = showCoverageRef.current ? 0.12 : 0;
        coverageMeshes.forEach((mesh) => {
          const material = mesh.material as THREE.MeshStandardMaterial;
          material.opacity += (targetCoverageOpacity - material.opacity) * 0.18;
          mesh.visible = material.opacity > 0.002;
        });
        controls.update();
        renderer.render(scene, camera);
        frameId = window.requestAnimationFrame(animate);
      };

      // Raycaster for click-to-select in edit mode
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const onClickHandler = (event: MouseEvent) => {
        if (!editModeRef.current) return;
        const rect = renderer!.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const intersects = raycaster.intersectObjects(savedSpeakerMeshes, true);
        if (intersects.length > 0) {
          let obj: THREE.Object3D | null = intersects[0].object;
          while (obj && obj.userData?.type !== 'speaker') obj = obj.parent;
          if (obj && obj.userData?.speakerIndex !== undefined) {
            setSelectedSpeakerIndex(obj.userData.speakerIndex);
            return;
          }
        }
        setSelectedSpeakerIndex(null);
      };
      renderer!.domElement.addEventListener('click', onClickHandler);

      speakerMeshesRef.current = savedSpeakerMeshes;
      speakerLabelsRef.current = savedSpeakerLabels;
      coverageMeshesRef.current = coverageMeshes;
      dragHandlesRef.current = [];

      // Create invisible drag handles for custom pointer drag
      const dragHandles = savedSpeakerMeshes.map((group, index) => {
        const boxSize = 1.2;
        const handleGeo = new THREE.BoxGeometry(boxSize, boxSize * 0.6, boxSize * 0.8);
        const handleMat = new THREE.MeshBasicMaterial({
          visible: false,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        handle.position.copy(group.position);
        handle.userData = { type: 'speaker', speakerIndex: index };
        scene.add(handle);
        return handle;
      });
      dragHandlesRef.current = dragHandles;

      // Track drag positions in ref to avoid React re-render during drag
      const dragPositions: [number, number, number][] = savedSpeakerMeshes.map((m) => [
        m.position.x, m.position.y, m.position.z,
      ]);

      // ---- Custom pointer-based drag (replaces DragControls) ----
      const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const dragOffset = new THREE.Vector3();
      const dragRaycaster2 = new THREE.Raycaster();
      let dragIndex: number | null = null;

      const onPointerDown = (event: PointerEvent) => {
        if (!editModeRef.current || isSimulating) return;
        const rect = renderer!.domElement.getBoundingClientRect();
        const mx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const my = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        dragRaycaster2.setFromCamera(new THREE.Vector2(mx, my), camera);
        const hits = dragRaycaster2.intersectObjects(dragHandles, false);
        if (hits.length === 0) return;

        const hit = hits[0].object;
        const idx = hit.userData.speakerIndex;
        if (idx === undefined) return;

        dragIndex = idx;
        controls!.enabled = false;
        setSelectedSpeakerIndex(idx);

        const spokePos = savedSpeakerMeshes[idx].position;
        dragPlane.constant = -spokePos.z;
        dragRaycaster2.ray.intersectPlane(dragPlane, dragOffset);
        if (dragOffset) dragOffset.sub(spokePos);

        event.preventDefault();
        event.stopPropagation();
      };

      const onPointerMove = (event: PointerEvent) => {
        if (dragIndex === null) return;
        const rect = renderer!.domElement.getBoundingClientRect();
        const mx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const my = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        dragRaycaster2.setFromCamera(new THREE.Vector2(mx, my), camera);
        const pt = new THREE.Vector3();
        if (!dragRaycaster2.ray.intersectPlane(dragPlane, pt)) return;

        pt.sub(dragOffset);
        pt.x = Math.max(0.2, Math.min(room.length - 0.2, pt.x));
        pt.y = Math.max(0.2, Math.min(room.width - 0.2, pt.y));
        pt.z = Math.max(0.4, Math.min(room.height - 0.2, pt.z));

        dragPositions[dragIndex] = [pt.x, pt.y, pt.z];
        savedSpeakerMeshes[dragIndex].position.copy(pt);
        if (dragHandles[dragIndex]) dragHandles[dragIndex].position.copy(pt);
        if (savedSpeakerLabels[dragIndex])
          savedSpeakerLabels[dragIndex].position.set(pt.x, pt.y, pt.z + 0.45);

        event.preventDefault();
      };

      const onPointerUp = () => {
        if (dragIndex === null) return;
        controls!.enabled = true;
        setEditedSpeakers((prev) => {
          const base = prev ?? speakers;
          return base.map((s, i) => ({
            ...s,
            position: dragPositions[i] ?? s.position,
          }));
        });
        dragIndex = null;
      };

      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointermove', onPointerMove);
      renderer.domElement.addEventListener('pointerup', onPointerUp);
      const teardownPointerDrag = () => {
        renderer!.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer!.domElement.removeEventListener('pointermove', onPointerMove);
        renderer!.domElement.removeEventListener('pointerup', onPointerUp);
      };

      setPlotReady(true);
      animate();

      return () => {
        window.cancelAnimationFrame(frameId);
        if (resizeObserver) resizeObserver.disconnect();
        teardownPointerDrag();
        if (controls) controls.dispose();
        renderer!.domElement.removeEventListener('click', onClickHandler);
        speakerMeshesRef.current = [];
        dragHandlesRef.current = [];
        disposeSceneResources(scene);
        if (renderer) renderer.dispose();
        if (sceneRef.current === scene) sceneRef.current = null;
        if (cameraRef.current === camera) cameraRef.current = null;
        if (rendererRef.current === renderer) rendererRef.current = null;
        if (controlsRef.current === controls) controlsRef.current = null;
        mount.innerHTML = '';
      };
    } catch (error) {
      setPlotError(error instanceof Error ? error.message : '三维场景渲染失败');
      setPlotReady(true);
      return () => {
        if (resizeObserver) resizeObserver.disconnect();
        if (controls) controls.dispose();
        if (renderer) renderer.dispose();
        sceneRef.current = null;
        cameraRef.current = null;
        rendererRef.current = null;
        controlsRef.current = null;
        mount.innerHTML = '';
      };
    }
  }, [
    cmax,
    cmin,
    minSplTarget,
    params.stageDepth,
    params.stageToFarAudience,
    params.stageToNearAudience,
    params.stageWidth,
    room,
    scenario,
    simulationData,
  ]);

  return (
    <div className="h-full min-h-[560px] bg-white text-slate-700 flex flex-col overflow-hidden">
      <div className="h-12 px-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
        <div className="min-w-0 flex items-center gap-3">
          <h3 className="text-sm font-black text-slate-900 truncate">逆向设计方案生成</h3>
          <span className={`px-2 py-0.5 rounded-sm text-[11px] font-black border ${standardsPass ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : isSimulating ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
            {isSimulating ? `迭代中 ${elapsedSeconds}s` : simulationData ? standardsPass ? '指标满足' : '需调整清单' : '待生成'}
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
          <button
            type="button"
            onClick={toggleSceneFullscreen}
            className="h-8 px-3 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[12px] font-bold text-slate-600"
          >
            {isSceneFullscreen ? '退出全屏' : '全屏查看'}
          </button>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setEditMode(false)}
              disabled={!simulationData}
              className={`h-7 px-3 rounded-md text-[12px] font-bold transition-all ${!simulationData ? 'text-slate-400' : !editMode ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
            >
              👁 查看
            </button>
            <button
              type="button"
              onClick={() => setEditMode(true)}
              disabled={!simulationData}
              className={`h-7 px-3 rounded-md text-[12px] font-bold transition-all ${!simulationData ? 'text-slate-400' : editMode ? 'bg-white text-blue-700 shadow-sm border border-blue-200' : 'text-slate-500 hover:text-slate-700'}`}
            >
              ✋ 编辑
            </button>
          </div>
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
        <div ref={scenePanelRef} className="relative min-h-[420px] bg-white border-r border-slate-200">
          <div ref={plotRef} className={`absolute inset-0 bg-white ${simulationData ? '' : 'hidden'}`} />
          {simulationData && !plotError && (
            <div className="absolute left-3 top-5 z-10 rounded border border-slate-200/90 bg-white/90 px-2 py-2 shadow-sm backdrop-blur-[1px]">
              <div className="text-[10px] font-black text-slate-500">SPL dB</div>
              <div className="relative mt-1 h-56 w-[72px]">
                <div
                  className="absolute left-0 top-0 h-56 w-5 rounded-sm border border-slate-200"
                  style={{ background: splLegendGradient }}
                />
                <div className="absolute left-0 right-0 -translate-y-1/2 flex items-center gap-0.5" style={{ bottom: `${colorbarTargetBottomPercent}%` }}>
                  <div className="h-[2px] w-5 bg-slate-900" />
                  <div className="whitespace-nowrap rounded-sm border border-slate-300 bg-white/95 px-1 text-[9px] font-black text-slate-700">
                    场景要求 {minSplTarget.toFixed(0)} dB
                  </div>
                </div>
                <div className="absolute left-6 top-0 -translate-y-1/2 text-[9px] font-black text-slate-700">{cmax.toFixed(0)}</div>
                <div className="absolute left-6 bottom-0 translate-y-1/2 text-[9px] font-black text-slate-700">{cmin.toFixed(0)}</div>
              </div>
            </div>
          )}
          {editMode && selectedSpeakerIndex !== null && simulationData && (
            <div className="absolute right-3 top-5 z-10 w-64 rounded border border-blue-200 bg-white/95 shadow-lg backdrop-blur-[1px] p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-black text-slate-800">音箱 #{selectedSpeakerIndex + 1}</span>
                <button type="button" onClick={() => setEditedSpeakers(null)} className="text-[11px] text-slate-400 hover:text-slate-600 underline">还原</button>
              </div>
              <div className="text-[11px] text-slate-500 font-bold mb-2">{speakers[selectedSpeakerIndex]?.model} · {speakers[selectedSpeakerIndex]?.role}</div>
              <div className="space-y-1.5">
                {(['X', 'Y', 'Z'] as const).map((label, ai) => {
                  const val = speakers[selectedSpeakerIndex]?.position[ai] ?? 0;
                  return (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-500 w-4">{label}</span>
                      <input
                        type="number" step="0.1"
                        value={Number(val).toFixed(2)}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          setEditedSpeakers((prev) => {
                            const base = prev ?? speakers;
                            const next = [...base];
                            const pos = [...next[selectedSpeakerIndex].position] as [number, number, number];
                            pos[ai] = Math.max(0.2, Math.min(ai === 2 ? 18 : 50, v));
                            next[selectedSpeakerIndex] = { ...next[selectedSpeakerIndex], position: pos };
                            return next;
                          });
                        }}
                        className="w-20 h-7 rounded border border-slate-200 px-2 text-[12px] font-mono text-slate-700 focus:border-blue-400 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-400">m</span>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[11px] font-bold text-slate-500">增益</span>
                  <input
                    type="number" step="0.5"
                    value={speakers[selectedSpeakerIndex]?.gainDb.toFixed(1) ?? '0.0'}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      setEditedSpeakers((prev) => {
                        const base = prev ?? speakers;
                        const next = [...base];
                        next[selectedSpeakerIndex] = { ...next[selectedSpeakerIndex], gainDb: Math.max(-20, Math.min(20, v)) };
                        return next;
                      });
                    }}
                    className="w-20 h-7 rounded border border-slate-200 px-2 text-[12px] font-mono text-slate-700 focus:border-blue-400 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400">dB</span>
                </div>
              </div>
              {onApplyLayout && (
                <button
                  type="button"
                  onClick={handleApplyLayout}
                  className="mt-3 w-full h-8 rounded bg-blue-600 text-white text-[12px] font-black hover:bg-blue-700 transition-colors"
                >
                  应用到方案
                </button>
              )}
            </div>
          )}
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
                  若提前满足国标约束，求解会直接结束。
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
              <div className="max-h-[300px] overflow-auto rounded border border-slate-200">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-slate-400">
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

            {simulationData?.adjustment?.needed && (
              <section>
                <div className="text-[12px] font-black text-slate-500 mb-2">清单调整建议</div>
                <div className={`rounded border px-3 py-3 text-[12px] leading-relaxed ${simulationData.adjustment.feasible ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-amber-100 bg-amber-50 text-amber-800'}`}>
                  <div className="font-black">
                    {simulationData.adjustment.feasible ? '增补后预估可满足指标' : '当前清单仍未找到满足解'}
                  </div>
                  <div className="mt-1">
                    {simulationData.adjustment.reason}
                  </div>
                  {simulationData.adjustment.added?.length ? (
                    <div className="mt-2 font-mono">
                      建议增补：{simulationData.adjustment.added.map((item) => `${item.model} x ${item.quantity}`).join('、')}
                    </div>
                  ) : null}
                  {simulationData.adjustment.result ? (
                    <div className="mt-2 font-mono">
                      {simulationData.adjustment.feasible ? '增补后预估' : '当前最佳诊断'}：SPL {Number(simulationData.adjustment.result.minSpl || 0).toFixed(1)} / {Number(simulationData.adjustment.result.avgSpl || 0).toFixed(1)} / {Number(simulationData.adjustment.result.maxSpl || 0).toFixed(1)}，
                      不均匀度 {Number(simulationData.adjustment.result.nonuniformity || 0).toFixed(1)} dB，
                      余量 {Number(simulationData.adjustment.result.headroom || 0).toFixed(1)} dB
                    </div>
                  ) : null}
                </div>
              </section>
            )}

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
