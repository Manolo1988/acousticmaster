import { useState, useMemo, useEffect, useRef } from 'react';
import React from 'react';
import {
  Scenario, Page, SolutionTab, ResultTab, AcousticParams, DesignState,
  EquipmentItem, SolutionResult, User, AuthUser, HistoryRecord, MicConfig,
  TableType, DbInventoryItem, ChatMessage, SolutionLayoutItem
} from '../types';
import { DEFAULT_PARAMS } from '../constants';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';

// Type declaration for import.meta.env
declare global {
  interface ImportMetaEnv {
    readonly VITE_API_BASE?: string;
    // add other env variables here if needed
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

const rawApiBase = import.meta.env.VITE_API_BASE ?? "";
const fallbackApiBase = "";
const API_BASE = (rawApiBase || fallbackApiBase).replace(/\/+$/, "");
const resolveBackendLink = (link: string) => {
  if (!link) return '';
  if (/^https?:\/\//i.test(link)) return link;
  if (link.startsWith('/')) return `${API_BASE}${link}`;
  return `${API_BASE}/${link.replace(/^\/+/, '')}`;
};

const buildReportPrintDomId = (resultId: string) => `report-print-${resultId}`;

type ReportChapterConfig = { key: string; title: string };

type AmplifierMatchAnalysisPayload = {
  scenario: Scenario;
  speaker: {
    model?: string;
    name?: string;
    quantity?: number;
    ratedPower?: string | number;
    ratedImpedance?: string | number;
  };
  currentAmplifier?: {
    model?: string;
    name?: string;
  };
  items?: EquipmentItem[];
  amplifierIndex?: number;
};

const REPORT_CHAPTERS: ReportChapterConfig[] = [
  { key: 'project_overview', title: '项目概述' },
  { key: 'design_basis_target', title: '设计依据和目标' },
  { key: 'solution_design', title: '方案设计' },
  { key: 'equipment_intro', title: '设备介绍' },
  { key: 'decoration_suggestion', title: '装修建议' },
  { key: 'environment_requirements', title: '环境要求' }
];

const createInitialReportChapters = () =>
  REPORT_CHAPTERS.map((chapter) => ({
    key: chapter.key,
    title: chapter.title,
    markdown: '',
    status: 'pending' as const,
    error: ''
  }));

const buildPrintWindowStyles = () => {
  const styleTags = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((node) => node.outerHTML)
    .join('\n');

  const printPaginationStyles = `
<style>
@page {
  size: A4;
  margin: 20mm;
}

html, body {
  margin: 0;
  padding: 0;
  background: #fff;
}

.pdf-print-root {
  width: 100%;
}

.pdf-print-section {
  break-inside: avoid-page;
  page-break-inside: avoid;
}

.pdf-print-section + .pdf-print-section {
  break-before: page;
  page-break-before: always;
}

@media print {
  .markdown-report {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .markdown-report h1,
  .markdown-report h2,
  .markdown-report h3,
  .markdown-report h4 {
    break-after: avoid-page;
    page-break-after: avoid;
    break-inside: avoid-page;
    page-break-inside: avoid;
    orphans: 3;
    widows: 3;
  }

  .markdown-report h1 + *,
  .markdown-report h2 + *,
  .markdown-report h3 + *,
  .markdown-report h4 + * {
    break-before: avoid-page;
    page-break-before: avoid;
  }

  .markdown-report p,
  .markdown-report li,
  .markdown-report ul,
  .markdown-report ol,
  .markdown-report table,
  .markdown-report thead,
  .markdown-report tbody,
  .markdown-report tr,
  .markdown-report td,
  .markdown-report th,
  .markdown-report pre,
  .markdown-report blockquote,
  .markdown-report img,
  .markdown-report .katex,
  .markdown-report .katex-display,
  .markdown-report hr {
    break-inside: avoid-page;
    page-break-inside: avoid;
    orphans: 3;
    widows: 3;
  }

  .markdown-report h2::after {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .markdown-report ul + ul,
  .markdown-report ol + ol,
  .markdown-report ul + ol,
  .markdown-report ol + ul {
    break-before: avoid-page;
    page-break-before: avoid;
  }

  .markdown-report .toc-heading {
    break-after: avoid-page;
    page-break-after: avoid;
  }
}
</style>`;

  return `${styleTags}\n${printPaginationStyles}`;
};

const SYSTEM_API_BASE = API_BASE;
const AI_CHAT_API_BASE = API_BASE;

const TABLE_NAME_MAP: Record<string, TableType> = {
  固定搭配: TableType.SPEAKER,
  音箱: TableType.SPEAKER,
  线阵列配套: TableType.LINE_ARRAY_SUPPORT,
  定阻功放: TableType.AMPLIFIER,
  功放: TableType.AMPLIFIER,
  周边设备: TableType.PERIPHERAL,
  子系统: TableType.SUBSYSTEM,
  固定搭配场景剩余周边设备: TableType.SUBSYSTEM,
  非固定搭配场景剩余周边设备: TableType.SUBSYSTEM,
  其他设备: TableType.SUBSYSTEM,
  中控系统: TableType.SUBSYSTEM,
  矩阵: TableType.SUBSYSTEM,
  视频会议系统: TableType.SUBSYSTEM,
  录播系统: TableType.SUBSYSTEM,
  本地静态资源: TableType.LOCAL_STATIC_RESOURCE,
  本地静态资源管理: TableType.LOCAL_STATIC_RESOURCE
};

const normalizeTableName = (type: string): TableType | null => {
  if (!type) return null;
  if (Object.values(TableType).includes(type as TableType)) return type as TableType;
  return TABLE_NAME_MAP[type] || null;
};

const buildEquipmentKey = (table: string, model: string, name: string) => {
  return `${table}::${model || ''}::${name || ''}`;
};

const buildItemsSignature = (items: EquipmentItem[]) => {
  return JSON.stringify(
    items.map(item => ({
      type: item.type,
      name: item.name,
      model: item.model,
      quantity: item.quantity,
      brand: item.brand || '',
      unitPrice: item.unitPrice || 0
    }))
  );
};

const SUBSYSTEM_DEVICE_TYPES = new Set(['中控系统', '矩阵', '视频会议系统', '录播系统']);
const SUBSYSTEM_PARAM_KEYS: Array<keyof AcousticParams> = [
  'hasCentralControl',
  'hasMatrix',
  'hasVideoConf',
  'hasRecording'
];

const PARAM_KEY_ALIASES: Record<string, keyof AcousticParams> = {
  length: 'length',
  width: 'width',
  height: 'height',
  roomLength: 'length',
  roomWidth: 'width',
  roomHeight: 'height',
  room_length: 'length',
  room_width: 'width',
  room_height: 'height',
  长: 'length',
  长度: 'length',
  宽: 'width',
  宽度: 'width',
  高: 'height',
  高度: 'height',
  installHeight: 'height',
  installationHeight: 'height',
  stageToNearAudience: 'stageToNearAudience',
  stageToFarAudience: 'stageToFarAudience',
  stageWidth: 'stageWidth',
  stageDepth: 'stageDepth',
  台口至最近: 'stageToNearAudience',
  台口至最远: 'stageToFarAudience',
  台口宽度: 'stageWidth',
  舞台深度: 'stageDepth',
  mics: 'mics',
  microphones: 'mics',
  micList: 'mics',
  micsUpdate: 'mics',
  话筒: 'mics',
  话筒配置: 'mics',
  话筒列表: 'mics',
  hasCentralControl: 'hasCentralControl',
  hasMatrix: 'hasMatrix',
  hasVideoConf: 'hasVideoConf',
  hasRecording: 'hasRecording',
  中控系统: 'hasCentralControl',
  矩阵系统: 'hasMatrix',
  视频会议: 'hasVideoConf',
  录播系统: 'hasRecording',
  中控: 'hasCentralControl',
  矩阵: 'hasMatrix',
  视讯: 'hasVideoConf',
  录播: 'hasRecording',
  scenarioConfirmed: 'scenarioConfirmed',
  场景已确认: 'scenarioConfirmed',
  roomConfirmed: 'roomConfirmed',
  物理参数已确认: 'roomConfirmed',
  stageConfirmed: 'stageConfirmed',
  舞台参数已确认: 'stageConfirmed',
  micsConfirmed: 'micsConfirmed',
  话筒已确认: 'micsConfirmed',
  subsystemsConfirmed: 'subsystemsConfirmed',
  子系统已确认: 'subsystemsConfirmed',
  extraRequirements: 'extraRequirements',
  otherRequirements: 'extraRequirements',
  其他需求: 'extraRequirements',
  特殊需求: 'extraRequirements',
  extraRequirementsConfirmed: 'extraRequirementsConfirmed',
  其他需求已确认: 'extraRequirementsConfirmed'
};

type MicUpdateMode = 'replace' | 'add' | 'remove';

const normalizeMicUpdateMode = (value: any): MicUpdateMode | null => {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return null;

  if (['replace', 'overwrite', 'reset', 'set', 'full', '全部替换', '覆盖', '替换', '全量'].some((item) => token.includes(item))) {
    return 'replace';
  }
  if (['add', 'append', 'plus', '新增', '增加', '添加', '再加'].some((item) => token.includes(item))) {
    return 'add';
  }
  if (['remove', 'delete', 'minus', '减少', '删除', '去掉', '移除'].some((item) => token.includes(item))) {
    return 'remove';
  }
  return null;
};

const normalizeMicToken = (value: string) =>
  String(value || '')
    .replace(/\s+/g, '')
    .toLowerCase();

const parseScenarioValue = (value: any): Scenario | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const normalized = raw.toUpperCase();
  const hasLecture =
    normalized.includes('LECTURE_HALL') ||
    normalized.includes('REPORT') ||
    raw.includes('报告厅');
  const hasMeeting =
    normalized.includes('MEETING_ROOM') ||
    normalized.includes('MEETING') ||
    raw.includes('会议室');

  // 文本同时出现两个场景时视为未定，避免“会议室还是报告厅”被误判。
  if (hasLecture && hasMeeting) {
    return null;
  }

  if (hasLecture) {
    return Scenario.LECTURE_HALL;
  }
  if (hasMeeting) {
    return Scenario.MEETING_ROOM;
  }
  return null;
};

const parseSubsystemKeyFromText = (value: string): keyof AcousticParams | null => {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return null;

  if (token.includes('hascentralcontrol') || token.includes('中控')) return 'hasCentralControl';
  if (token.includes('hasmatrix') || token.includes('矩阵')) return 'hasMatrix';
  if (token.includes('hasvideoconf') || token.includes('video') || token.includes('视讯') || token.includes('视频会议')) return 'hasVideoConf';
  if (token.includes('hasrecording') || token.includes('录播') || token.includes('录音')) return 'hasRecording';
  return null;
};

const normalizeSubsystemSnapshotValue = (
  value: any
): Partial<Pick<AcousticParams, 'hasCentralControl' | 'hasMatrix' | 'hasVideoConf' | 'hasRecording'>> => {
  const snapshot: Partial<Pick<AcousticParams, 'hasCentralControl' | 'hasMatrix' | 'hasVideoConf' | 'hasRecording'>> = {};

  const setFromToken = (tokenRaw: string, fallbackEnabled = true) => {
    const token = String(tokenRaw || '').trim();
    if (!token) return;
    const key = parseSubsystemKeyFromText(token);
    if (!key) return;
    const disabled = /不需要|无需|不要|关闭|取消|禁用|否|false|0/i.test(token);
    (snapshot as any)[key] = disabled ? false : fallbackEnabled;
  };

  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (typeof entry === 'string') {
        setFromToken(entry, true);
        return;
      }
      if (!entry || typeof entry !== 'object') return;
      Object.entries(entry as Record<string, any>).forEach(([k, v]) => {
        const key = parseSubsystemKeyFromText(k);
        if (!key) return;
        const parsed = parseBooleanLike(v);
        (snapshot as any)[key] = parsed === null ? true : parsed;
      });
    });
    return snapshot;
  }

  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, any>).forEach(([k, v]) => {
      const key = parseSubsystemKeyFromText(k);
      if (!key) return;
      const parsed = parseBooleanLike(v);
      (snapshot as any)[key] = parsed === null ? true : parsed;
    });
    return snapshot;
  }

  if (typeof value === 'string') {
    const text = String(value || '');
    text
      .split(/[、,，;；|/\n]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => setFromToken(part, true));
  }

  return snapshot;
};

const findMicOptionFromDb = (rawType: string, options: string[]): string => {
  const type = String(rawType || '').trim();
  if (!type) return '';

  const normalizedOptions = Array.from(new Set((options || []).map((item) => String(item || '').trim()).filter(Boolean)));
  if (normalizedOptions.includes(type)) return type;

  const token = normalizeMicToken(type);
  if (!token) return '';

  const exactToken = normalizedOptions.find((option) => normalizeMicToken(option) === token);
  if (exactToken) return exactToken;

  const fuzzy = normalizedOptions.find((option) => {
    const optionToken = normalizeMicToken(option);
    return optionToken.includes(token) || token.includes(optionToken);
  });
  return fuzzy || '';
};

const buildScenarioDefaultMics = (scenario: Scenario, options: string[]): MicConfig[] => {
  const normalizedOptions = Array.from(new Set((options || []).map((item) => String(item || '').trim()).filter(Boolean)));
  if (normalizedOptions.length === 0) return [];

  const preferredTypes = scenario === Scenario.LECTURE_HALL
    ? ['一拖二无线手持话筒', '一拖二无线鹅颈麦克风']
    : ['一拖二无线手持话筒'];

  return preferredTypes
    .map((name) => normalizedOptions.find((option) => option === name) || '')
    .filter(Boolean)
    .map((type, index) => ({
      id: `scenario-default-${scenario}-${index}`,
      type,
      count: 2
    }));
};

const normalizeMicDisplayType = (raw: string) => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return trimmed;
};

const normalizeMicListValue = (value: any): MicConfig[] => {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const typeRaw = typeof item?.type === 'string'
        ? item.type
        : typeof item?.name === 'string'
          ? item.name
          : typeof item?.label === 'string'
            ? item.label
            : typeof item?.产品名称 === 'string'
              ? item.产品名称
            : '';
      const countRaw = item?.count ?? item?.qty ?? item?.quantity ?? item?.数量 ?? item?.个数 ?? item?.num ?? item?.number ?? 1;
      const countNum = typeof countRaw === 'number' ? countRaw : parseInt(String(countRaw), 10);
      return {
        id: typeof item?.id === 'string' ? item.id : `${Date.now()}-${index}`,
        type: normalizeMicDisplayType(String(typeRaw)),
        count: Number.isFinite(countNum) ? Math.max(0, countNum) : 1
      };
    });
  }

  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([typeKey, countValue], index) => {
        const countNum = typeof countValue === 'number'
          ? countValue
          : parseInt(String(countValue ?? '').replace(/[^\d-]/g, ''), 10);
        return {
          id: `${Date.now()}-obj-${index}`,
          type: normalizeMicDisplayType(String(typeKey || '')),
          count: Number.isFinite(countNum) ? Math.max(0, countNum) : 0
        };
      })
      .filter((item) => !!item.type && item.count >= 0);
  }

  if (typeof value === 'string') {
    const text = String(value || '');
    const micPattern = /([^,，。；;\n:：]{1,50}?(?:话筒|麦克风))[^\d\n]{0,8}(\d+)/g;
    const parsed: MicConfig[] = [];
    let matched: RegExpExecArray | null;

    while ((matched = micPattern.exec(text)) !== null) {
      const type = normalizeMicDisplayType(String(matched[1] || ''));
      const count = Number(matched[2]);
      if (!type || !Number.isFinite(count) || count <= 0) continue;

      parsed.push({
        id: `${Date.now()}-txt-${parsed.length}`,
        type,
        count: Math.max(0, count)
      });
    }
    return parsed;
  }

  return [];
};

const normalizeMicsToDbOptions = (mics: MicConfig[], options: string[]): MicConfig[] => {
  const normalizedOptions = Array.from(new Set((options || []).map((item) => String(item || '').trim()).filter(Boolean)));
  if (normalizedOptions.length === 0) return [];

  const resolved = (mics || []).reduce<MicConfig[]>((acc, mic) => {
    const type = String(mic?.type || '').trim();
    const count = Number.isFinite(mic?.count) ? Math.max(0, Number(mic.count)) : 0;
    if (!type || count <= 0) return acc;

    const normalizedType = findMicOptionFromDb(type, normalizedOptions);

    if (!normalizedType) return acc;

    const existed = acc.find((item) => item.type === normalizedType);
    if (existed) {
      existed.count += count;
      return acc;
    }

    acc.push({
      id: String(mic?.id || uuidv4()),
      type: normalizedType,
      count
    });
    return acc;
  }, []);

  return resolved;
};

const parseBooleanLike = (value: any): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', '是', '启用'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', '否', '禁用'].includes(normalized)) return false;
  }
  return null;
};

const parseMicCountLike = (value: any): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    const direct = Number(normalized);
    if (Number.isFinite(direct)) return direct;
    const matched = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!matched) return null;
    const n = Number(matched[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const buildMicCounts = (mics: MicConfig[]) => {
  return {
    micHandheld: 0,
    micGooseneck: 0,
    micOmni: 0,
    micLavalier: 0,
    micCeiling: 0
  };
};

const buildMicListFromCounts = (params: AcousticParams): MicConfig[] => {
  return normalizeMicListValue((params as any)?.mics);
};

const normalizeAssistantParams = (raw: Record<string, any> | Record<string, any>[]): Partial<AcousticParams> => {
  const normalized: Partial<AcousticParams> = {};
  const implicitMicItems: MicConfig[] = [];
  if (!raw) return normalized;

  // Normalize single object into an array for uniform processing
  const items = Array.isArray(raw) ? raw : [raw];

  items.forEach(item => {
    // Handle both {"key": "length", "value": 20} and {"length": 20} formats
    const pairs: [string, any][] = [];
    if (item.key && item.hasOwnProperty('value')) {
      pairs.push([item.key, item.value]);
    } else {
      pairs.push(...Object.entries(item));
    }

    pairs.forEach(([key, value]) => {
      const keyText = String(key || '').trim();
      const keyLower = keyText.toLowerCase();

      if (['micsaction', 'micaction', 'micsupdatemode', '话筒操作', '话筒更新模式'].includes(keyLower) || keyText === '话筒操作') {
        const mode = normalizeMicUpdateMode(value);
        if (mode) {
          (normalized as any).__micsAction = mode;
        }
        return;
      }

      if (['micsupdate', 'micupdate', '话筒更新'].includes(keyLower) || keyText === '话筒更新') {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const mode = normalizeMicUpdateMode((value as any).mode ?? (value as any).action);
          if (mode) {
            (normalized as any).__micsAction = mode;
          }
          const micsValue =
            (value as any).items ??
            (value as any).mics ??
            (value as any).list ??
            (value as any).value ??
            [];
          const list = normalizeMicListValue(micsValue);
          (normalized as any).mics = list;
          Object.assign(normalized, buildMicCounts(list));
        }
        return;
      }

      if (
        key === 'subsystems' ||
        key === '子系统' ||
        keyLower === 'subsystem' ||
        keyLower === 'subsystems' ||
        keyText === '子系统配置'
      ) {
        const subsystemSnapshot = normalizeSubsystemSnapshotValue(value);
        SUBSYSTEM_PARAM_KEYS.forEach((subKey) => {
          if (!Object.prototype.hasOwnProperty.call(subsystemSnapshot, subKey)) return;
          const parsed = parseBooleanLike((subsystemSnapshot as any)[subKey]);
          if (parsed === null) return;
          (normalized as any)[subKey] = parsed;
        });
        return;
      }

      const aliasedKey = PARAM_KEY_ALIASES[key];
      if (!aliasedKey && /话筒|麦克风/i.test(keyText)) {
        const count = parseMicCountLike(value);
        if (count !== null) {
          implicitMicItems.push({
            id: `${Date.now()}-implicit-${implicitMicItems.length}`,
            type: normalizeMicDisplayType(keyText),
            count: Math.max(0, count)
          });
        }
        return;
      }

      const mappedKey = aliasedKey || (key as keyof AcousticParams);
      if (!mappedKey) return;

      if (mappedKey === 'mics') {
        const list = normalizeMicListValue(value);
        (normalized as any).mics = list;
        Object.assign(normalized, buildMicCounts(list));
        return;
      }

      if (typeof value === 'boolean') {
        (normalized as any)[mappedKey] = value;
        return;
      }

      if (typeof value === 'number') {
        (normalized as any)[mappedKey] = value;
        return;
      }

      if (typeof value === 'string') {
        const lowerVal = value.toLowerCase();
        if (lowerVal === 'true') {
          (normalized as any)[mappedKey] = true;
          return;
        }
        if (lowerVal === 'false') {
          (normalized as any)[mappedKey] = false;
          return;
        }
        const maybeNum = Number(value);
        (normalized as any)[mappedKey] = Number.isFinite(maybeNum) ? maybeNum : value;
        return;
      }

      (normalized as any)[mappedKey] = value;
    });
  });

  if (!Object.prototype.hasOwnProperty.call(normalized, 'mics')) {
    const list = implicitMicItems.filter((item) => item.count > 0 && !!item.type);
    if (list.length) {
      (normalized as any).mics = list;
      Object.assign(normalized, buildMicCounts(list));
    }
  }

  return normalized;
};

const tryParseAssistantPayload = (rawContent: string) => {
  const cleaned = String(rawContent || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  if (!cleaned) return null;

  const findMatchingBraceEnd = (text: string, startIndex: number) => {
    let depth = 0;
    let inString = false;
    let quoteChar = '';
    let escaped = false;
    for (let i = startIndex; i < text.length; i += 1) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === quoteChar) {
          inString = false;
        }
        continue;
      }

      if (ch === '"' || ch === '\'') {
        inString = true;
        quoteChar = ch;
        continue;
      }

      if (ch === '{') {
        depth += 1;
        continue;
      }

      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return i;
        }
      }
    }
    return -1;
  };

  try {
    return JSON.parse(cleaned);
  } catch {
    if (cleaned.includes('},{') || (cleaned.includes('"value":') && !cleaned.startsWith('[') && !cleaned.startsWith('{'))) {
      try {
        return JSON.parse(`[${cleaned}]`);
      } catch {
        // ignore and fallback
      }
    }

    try {
      return JSON.parse(cleaned.replace(/'/g, '"'));
    } catch (error) {
      // 兼容模型偶发输出：{"key":"scenario","value":"REPORT_HALL"}, "roomConfirmed": false
      try {
        const firstBrace = cleaned.indexOf('{');
        if (firstBrace >= 0) {
          const firstObjEnd = findMatchingBraceEnd(cleaned, firstBrace);
          if (firstObjEnd > firstBrace) {
            const firstObjText = cleaned.slice(firstBrace, firstObjEnd + 1).trim();
            const parsedPrimary = JSON.parse(firstObjText);
            const entries: Record<string, any>[] = [];
            if (parsedPrimary && typeof parsedPrimary === 'object') {
              entries.push(parsedPrimary as Record<string, any>);
            }

            const rest = cleaned.slice(firstObjEnd + 1).trim().replace(/^,\s*/, '').trim();
            if (rest) {
              const restAsObj = rest.startsWith('{') ? rest : `{${rest}}`;
              const parsedRest = JSON.parse(restAsObj);
              if (parsedRest && typeof parsedRest === 'object' && !Array.isArray(parsedRest)) {
                Object.entries(parsedRest).forEach(([key, value]) => {
                  entries.push({ key, value });
                });
              }
            }

            if (entries.length > 0) {
              return entries;
            }
          }
        }
      } catch {
        // ignore malformed fallback parse error
      }

      console.warn('Failed to parse [UPDATE_PARAM] block:', cleaned, error);
      return null;
    }
  }
};

const extractAssistantParamPayloads = (text: string): { payloads: Record<string, any>[]; cleanedText: string } => {
  const markerRegex = /\[\s*UPDATE_PARAM\s*[：:]\s*/ig;
  const source = String(text || '');
  const payloads: Record<string, any>[] = [];
  let cleanedParts = '';
  let cursor = 0;

  while (cursor < source.length) {
    markerRegex.lastIndex = cursor;
    const markerMatch = markerRegex.exec(source);
    if (!markerMatch) {
      cleanedParts += source.slice(cursor);
      break;
    }

    const markerStart = markerMatch.index;
    const markerContentStart = markerRegex.lastIndex;

    cleanedParts += source.slice(cursor, markerStart);

    let i = markerContentStart;
    while (i < source.length && /\s/.test(source[i])) i += 1;

    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let quoteChar = '';
    let escaped = false;
    let markerEnd = -1;

    for (; i < source.length; i += 1) {
      const ch = source[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === quoteChar) {
          inString = false;
        }
        continue;
      }

      if (ch === '"' || ch === '\'') {
        inString = true;
        quoteChar = ch;
        continue;
      }

      if (ch === '{') {
        braceDepth += 1;
        continue;
      }
      if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }
      if (ch === '[') {
        bracketDepth += 1;
        continue;
      }
      if (ch === ']') {
        if (braceDepth === 0 && bracketDepth === 0) {
          markerEnd = i;
          break;
        }
        bracketDepth = Math.max(0, bracketDepth - 1);
      }
    }

    if (markerEnd < 0) {
      // 未闭合时尽量保留后续正文，避免“阶段2引导文案”被吞掉。
      const nextLineBreak = source.indexOf('\n', markerStart);
      if (nextLineBreak >= 0 && nextLineBreak + 1 < source.length) {
        cleanedParts += source.slice(nextLineBreak + 1);
      } else {
        cleanedParts += source
          .slice(markerStart)
          .replace(/\[\s*UPDATE_PARAM\s*[：:]\s*/ig, '')
          .trim();
      }
      break;
    }

    const payloadText = source.slice(markerContentStart, markerEnd).trim();
    const parsed = tryParseAssistantPayload(payloadText);
    const normalized = Array.isArray(parsed) ? parsed : [parsed];
    normalized
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .forEach((item) => payloads.push(item as Record<string, any>));

    cursor = markerEnd + 1;
  }

  return {
    payloads,
    cleanedText: cleanedParts
  };
};


// 👇 新增：工具函数
const submitDesign = async (acousticIntent: any, userInfo: { userId: number | null; guestId: string | null; username: string }) => {
  try {
    const difyResponse = await fetch(`${API_BASE}/api/run-dify-chatflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        acousticIntent,
        userId: userInfo.userId,
        guestId: userInfo.guestId,
        username: userInfo.username
      })
    });

    if (!difyResponse.ok) {
      throw new Error(`Dify execution failed: ${difyResponse.status}`);
    }

    const difyResult = await difyResponse.json();
    return difyResult;
  } catch (error) {
    console.error("❌ submitDesign 失败:", error);
    return null;
  }
};

const formatDifyResult = (result: any): string => {
  if (result?.raw_answer) {
    return result.raw_answer;
  }
  if (result?.answer) {
    return result.answer;
  }
  return '❌ 方案生成失败，请检查后端日志。';
};

const stripThinkTags = (text: string) => {
  if (!text) return '';
  let normalized = text;
  const openThinkIdx = normalized.toLowerCase().lastIndexOf('<think>');
  const closeThinkIdx = normalized.toLowerCase().lastIndexOf('</think>');
  if (openThinkIdx > closeThinkIdx) {
    normalized = normalized.slice(0, openThinkIdx);
  }
  const openThinkingIdx = normalized.toLowerCase().lastIndexOf('<thinking>');
  const closeThinkingIdx = normalized.toLowerCase().lastIndexOf('</thinking>');
  if (openThinkingIdx > closeThinkingIdx) {
    normalized = normalized.slice(0, openThinkingIdx);
  }

  return normalized
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/<\/?thinking>/gi, '')
    .replace(/思考过程[:：]?[\s\S]*$/g, '')
    .trim();
};

const stripAssistantDisplayArtifacts = (text: string) => {
  const withoutThink = stripThinkTags(text);
  const { cleanedText } = extractAssistantParamPayloads(withoutThink);
  return cleanedText.trim();
};

const detectScenarioFromAssistant = (
  text: string,
  payloads: Record<string, any>[]
) => {
  for (const entry of payloads) {
    const key = String((entry as any).key || '').trim().toLowerCase();
    if (key === 'scenario' || key === '场景') {
      const parsed = parseScenarioValue((entry as any).value);
      if (parsed) return parsed;
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'scenario')) {
      const parsed = parseScenarioValue((entry as any).scenario);
      if (parsed) return parsed;
    }
  }

  const normalized = stripThinkTags(text);
  if (!normalized) return null;

  if (/[?？]/.test(normalized) && /(会议室.*报告厅|报告厅.*会议室|还是)/.test(normalized)) {
    return null;
  }

  const hasScenarioWord = /(会议室|报告厅|MEETING_ROOM|LECTURE_HALL|REPORT_HALL|REPORT)/i.test(normalized);
  if (!hasScenarioWord) {
    return null;
  }

  if (!/您选择了|选择的是|已选择|确定为|确认为|切换到|切换为|改为|改成|更改为|调整为|变更为|场景为|采用|当前场景|MEETING_ROOM|LECTURE_HALL|REPORT_HALL/i.test(normalized)) {
    return null;
  }

  if (/切换|改为|改成|场景|确定|确认为|判断为|建议采用/.test(normalized)) {
    const parsed = parseScenarioValue(normalized);
    if (parsed) return parsed;
  }
  return null;
};

const buildAssistantCurrentParamsSnapshot = (
  params: AcousticParams,
  scenario: Scenario | null | undefined
) => {
  const snapshot: Record<string, any> = {
    ...params,
    scenario: scenario || undefined
  };

  if (!params.roomConfirmed) {
    delete snapshot.length;
    delete snapshot.width;
    delete snapshot.height;
  }

  if (!params.stageConfirmed) {
    delete snapshot.stageWidth;
    delete snapshot.stageDepth;
    delete snapshot.stageToNearAudience;
    delete snapshot.stageToFarAudience;
  }

  if (!params.micsConfirmed) {
    delete snapshot.mics;
    delete snapshot.micHandheld;
    delete snapshot.micGooseneck;
    delete snapshot.micOmni;
    delete snapshot.micLavalier;
    delete snapshot.micCeiling;
  }

  if (!params.subsystemsConfirmed) {
    delete snapshot.hasCentralControl;
    delete snapshot.hasMatrix;
    delete snapshot.hasVideoConf;
    delete snapshot.hasRecording;
  }

  if (!params.extraRequirementsConfirmed) {
    delete snapshot.extraRequirements;
  }

  return snapshot;
};

const detectMicUpdateModeFromPayloads = (
  payloads: Record<string, any>[],
  normalizedParams: Partial<AcousticParams>
): MicUpdateMode => {
  const fromNormalized = normalizeMicUpdateMode((normalizedParams as any)?.__micsAction);
  if (fromNormalized) return fromNormalized;

  for (const payload of payloads) {
    const key = String((payload as any)?.key || '').trim().toLowerCase();
    if (key === 'micsaction' || key === 'micsupdatemode') {
      const mode = normalizeMicUpdateMode((payload as any)?.value);
      if (mode) return mode;
    }

    const directMode =
      normalizeMicUpdateMode((payload as any)?.micsAction) ||
      normalizeMicUpdateMode((payload as any)?.micsUpdateMode) ||
      normalizeMicUpdateMode((payload as any)?.micsUpdate?.mode) ||
      normalizeMicUpdateMode((payload as any)?.话筒操作);
    if (directMode) return directMode;
  }

  return 'replace';
};

const hasExplicitMicModeFromPayloads = (payloads: Record<string, any>[]) => {
  return payloads.some((payload) => {
    const key = String((payload as any)?.key || '').trim().toLowerCase();
    if (key === 'micsaction' || key === 'micsupdatemode' || key === '话筒操作') return true;
    return Boolean(
      (payload as any)?.micsAction ||
      (payload as any)?.micsUpdateMode ||
      (payload as any)?.micsUpdate?.mode ||
      (payload as any)?.话筒操作
    );
  });
};

const inferMicUpdateModeFromUserText = (text: string): MicUpdateMode | null => {
  const normalized = String(text || '').trim();
  if (!normalized) return null;

  const hasReplace = /改成|改为|换成|替换|调整为|改用|更新为|变更为/.test(normalized);
  const hasAdd = /新增|再加|增加|添加|加上/.test(normalized);
  const hasRemove = /删除|去掉|减少|取消|移除/.test(normalized);

  if (hasReplace) return 'replace';
  if (hasRemove && !hasAdd) return 'remove';
  if (hasAdd && !hasRemove) return 'add';
  return null;
};

const hasScenarioResetSignalFromPayloads = (payloads: Record<string, any>[]) => {
  const resetKeys = new Set([
    'scenarioconfirmed',
    'roomconfirmed',
    'stageconfirmed',
    'micsconfirmed',
    'subsystemsconfirmed',
    'extrarequirementsconfirmed'
  ]);

  return payloads.some((payload) => {
    const key = String((payload as any)?.key || '').trim().toLowerCase();
    if (resetKeys.has(key)) {
      return parseBooleanLike((payload as any)?.value) === false;
    }

    return Array.from(resetKeys).some((k) => {
      const candidates: Record<string, string> = {
        roomconfirmed: 'roomConfirmed',
        stageconfirmed: 'stageConfirmed',
        micsconfirmed: 'micsConfirmed',
        subsystemsconfirmed: 'subsystemsConfirmed',
        extrarequirementsconfirmed: 'extraRequirementsConfirmed'
      };
      const candidateKey = candidates[k];
      if (!candidateKey || !Object.prototype.hasOwnProperty.call(payload, candidateKey)) return false;
      return parseBooleanLike((payload as any)[candidateKey]) === false;
    });
  });
};

const hasScenarioResetSignalFromText = (text: string) => {
  const normalized = stripThinkTags(text);
  if (!normalized) return false;
  return /(重置|从阶段\s*2\s*开始|重新引导|重新确认|从头确认|回到阶段\s*2)/.test(normalized);
};

const applyMicUpdateByMode = (
  currentMics: MicConfig[],
  incomingMics: MicConfig[],
  mode: MicUpdateMode,
  options: string[]
) => {
  const normalizedCurrent = normalizeMicsToDbOptions(currentMics || [], options);
  const normalizedIncoming = normalizeMicsToDbOptions(incomingMics || [], options);

  if (mode === 'replace') {
    return normalizedIncoming;
  }

  if (mode === 'add') {
    return normalizeMicsToDbOptions([...normalizedCurrent, ...normalizedIncoming], options);
  }

  const removeMap = new Map<string, number>();
  normalizedIncoming.forEach((item) => {
    removeMap.set(item.type, (removeMap.get(item.type) || 0) + (Number.isFinite(item.count) ? item.count : 0));
  });

  const reduced = normalizedCurrent
    .map((item) => ({
      ...item,
      count: Math.max(0, item.count - (removeMap.get(item.type) || 0))
    }))
    .filter((item) => item.count > 0);

  return normalizeMicsToDbOptions(reduced, options);
};

// ========================================
// 新增：本地 LLM 对话支持及自动参数提取
// ========================================
const useAcousticAssistant = (
  params: AcousticParams, 
  setParams: React.Dispatch<React.SetStateAction<AcousticParams>>,
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  onScenarioConfirmed: (scenario: Scenario, forceReset?: boolean) => void,
  assistantScenario: Scenario | null
) => {
  const [isAssistantLoading, setIsAssistantLoading] = useState(false);

  const sendMessageToAssistant = async (
    text: string,
    history: ChatMessage[],
    isBackendRunning: boolean | null,
    assistantContext?: { scenario?: Scenario; micTypeOptions?: string[] }
  ) => {
    if (isBackendRunning === false) {
      setChatHistory(prev => [
        ...prev,
        { role: 'user', text, timestamp: new Date() },
        { role: 'ai', text: "❌ AI 引擎当前处于关闭状态。请点击左上角的“AI 引擎”开关开启后再试。", timestamp: new Date() }
      ]);
      return;
    }
    setIsAssistantLoading(true);
    
    // 1. 立即显示用户消息
    const userMsg: ChatMessage = { role: 'user', text, timestamp: new Date() };
    setChatHistory(prev => [...prev, userMsg]);

    // 2. 创建占位 AI 消息（后续流式更新）
    setChatHistory(prev => [...prev, { role: 'ai', text: "", timestamp: new Date() }]);

    let fullAiText = "";
    try {
      const assistantScenarioValue = assistantContext?.scenario || assistantScenario || undefined;
      const currentParamsSnapshot = buildAssistantCurrentParamsSnapshot(params, assistantScenarioValue);
      const response = await fetch(`${AI_CHAT_API_BASE}/api/chat-assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: history.map(h => ({ role: h.role === 'ai' ? 'assistant' : 'user', content: h.text })),
          currentParams: currentParamsSnapshot
        })
      });

      if (!response.ok) {
        throw new Error(`Assistant request failed: ${response.status}`);
      }

      if (!response.body) throw new Error("No stream content");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
          
          try {
            const data = JSON.parse(line.replace('data: ', ''));
            if (data.content) {
              fullAiText += data.content;
              const safeText = stripAssistantDisplayArtifacts(fullAiText);
              // 流式更新最后一条消息
              setChatHistory(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], text: safeText };
                return updated;
              });
            }
          } catch (e) {
            console.warn("SSE parse error", e);
          }
        }
      }

      // 3. 处理参数提取 [UPDATE_PARAM: {...}]
      const { payloads: extractedPayloads, cleanedText } = extractAssistantParamPayloads(fullAiText);
      const scenarioByAssistant = detectScenarioFromAssistant(fullAiText, extractedPayloads);
      const hasScenarioResetSignal =
        hasScenarioResetSignalFromPayloads(extractedPayloads) || hasScenarioResetSignalFromText(fullAiText);
      if (scenarioByAssistant) {
        onScenarioConfirmed(scenarioByAssistant, hasScenarioResetSignal);
      }
      if (extractedPayloads.length > 0) {
        const combinedNormalized = extractedPayloads.reduce((acc, payload) => {
          const normalized = normalizeAssistantParams(payload);
          return { ...acc, ...normalized };
        }, {} as Partial<AcousticParams>);

        const micUpdateMode = detectMicUpdateModeFromPayloads(extractedPayloads, combinedNormalized);
        const hasExplicitMicMode = hasExplicitMicModeFromPayloads(extractedPayloads);
        const inferredMicUpdateMode = inferMicUpdateModeFromUserText(text);
        delete (combinedNormalized as any).__micsAction;

        const subsystemSnapshot: Partial<Pick<AcousticParams, 'hasCentralControl' | 'hasMatrix' | 'hasVideoConf' | 'hasRecording'>> = {};
        let hasSubsystemUpdate = false;
        SUBSYSTEM_PARAM_KEYS.forEach((key) => {
          if (!Object.prototype.hasOwnProperty.call(combinedNormalized, key)) return;
          const parsed = parseBooleanLike((combinedNormalized as any)[key]);
          if (parsed === null) return;
          hasSubsystemUpdate = true;
          (subsystemSnapshot as any)[key] = parsed;
        });

        const hasMicUpdate = Object.prototype.hasOwnProperty.call(combinedNormalized, 'mics');

        if (Object.keys(combinedNormalized).length > 0) {
          setParams(prev => {
            const next: AcousticParams = { ...prev, ...(combinedNormalized as AcousticParams) };

            if (hasMicUpdate) {
              const micOptions = assistantContext?.micTypeOptions || [];
              const incomingMics = normalizeMicListValue((combinedNormalized as any).mics);
              let resolvedMicMode: MicUpdateMode = micUpdateMode;
              if (inferredMicUpdateMode === 'replace') {
                resolvedMicMode = 'replace';
              } else if (!hasExplicitMicMode && inferredMicUpdateMode) {
                resolvedMicMode = inferredMicUpdateMode;
              }
              const nextMics = applyMicUpdateByMode(prev.mics || [], incomingMics, resolvedMicMode, micOptions);
              next.mics = nextMics;
              Object.assign(next, buildMicCounts(nextMics));
            }

            if (hasSubsystemUpdate) {
              next.hasCentralControl = false;
              next.hasMatrix = false;
              next.hasVideoConf = false;
              next.hasRecording = false;
              SUBSYSTEM_PARAM_KEYS.forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(subsystemSnapshot, key)) {
                  (next as any)[key] = Boolean((subsystemSnapshot as any)[key]);
                }
              });
            }

            return next;
          });
        }

        const cleanText = stripAssistantDisplayArtifacts(cleanedText);
        setChatHistory(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], text: cleanText };
          return updated;
        });
      }

    } catch (err) {
      console.error("Assistant Error:", err);
      setChatHistory(prev => {
        const updated = [...prev];
        // 失败时替换占位 AI 消息，避免出现空白气泡
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          text: "抱歉，我的大脑暂时断网了，请稍后再试。"
        };
        return updated;
      });
    } finally {
      setIsAssistantLoading(false);
    }
  };

  return { sendMessageToAssistant, isAssistantLoading };
};

// ========================================
// 新增：Dify 响应解析器（动态支持任意数量方案）
// ========================================

const TABLE_HEADER_TOKENS = new Set([
  '类型', '产品类型', '设备类型', '产品名称', '名称', '型号', '规格', '数量', 'qty', 'quantity'
]);

const DETAIL_SEARCH_TABLE_ORDER: TableType[] = [
  TableType.SPEAKER,
  TableType.LINE_ARRAY_SUPPORT,
  TableType.AMPLIFIER,
  TableType.PERIPHERAL,
  TableType.SUBSYSTEM
];

const normalizeColumnToken = (value: string) =>
  String(value || '')
    .replace(/[*`~]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();

const normalizeLookupToken = (value: any) =>
  String(value || '')
    .replace(/[\s\-_/\\|·()（）\[\]【】]/g, '')
    .trim()
    .toLowerCase();

const normalizeEquipmentCell = (value: string) =>
  String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/^[\s\-–—•*\/|]+/, '')
    .replace(/[\s\-–—•*\/|]+$/, '')
    .trim();

const trimPipeColumns = (rawColumns: string[]) => {
  const cols = [...rawColumns];
  if (cols.length > 0 && !String(cols[0] || '').trim()) cols.shift();
  if (cols.length > 0 && !String(cols[cols.length - 1] || '').trim()) cols.pop();
  return cols;
};

const isDividerRowColumns = (cols: string[]) => {
  if (!Array.isArray(cols) || cols.length === 0) return false;
  return cols.every((col) => {
    const token = String(col || '').replace(/\s+/g, '');
    return token.length > 0 && /^[\-:]+$/.test(token) && token.includes('-');
  });
};

const inferTypeByNameOrModel = (name: string, model: string) => {
  const text = `${name} ${model}`;
  if (text.includes('功放')) return '功放';
  if (text.includes('话筒') || text.includes('麦克风')) return '话筒';
  if (text.includes('矩阵')) return '矩阵';
  if (text.includes('中控')) return '中控系统';
  if (text.includes('录播')) return '录播系统';
  if (text.includes('视频会议')) return '视频会议系统';
  if (text.includes('吊挂架') || text.includes('吊架')) return '线阵列音箱吊挂架';
  if (text.includes('次低')) return '次低音箱';
  if (text.includes('线阵列')) return '线阵列音箱';
  if (text.includes('扬声器') || text.includes('吸顶') || text.includes('吊顶') || text.includes('同轴')) return '音箱';
  if (text.includes('音箱')) return '音箱';
  return '';
};

const parseTableLines = (tableText: string): EquipmentItem[] => {
  const items: EquipmentItem[] = [];
  const lines = String(tableText || '').split('\n');

  const resolveHeaderMap = (cols: string[]) => {
    const normalized = cols.map((col) => normalizeColumnToken(col));
    const pick = (tokens: string[]) => {
      const normalizedTokens = tokens.map((token) => normalizeColumnToken(token));
      for (const token of normalizedTokens) {
        const idx = normalized.findIndex((value) => value === token);
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const typeIndex = pick(['类型', '产品类型', '设备类型']);
    const nameIndex = pick(['产品名称', '名称']);
    const modelIndex = pick(['型号', '规格']);
    const quantityIndex = pick(['数量', 'qty', 'quantity']);

    if (nameIndex < 0 || modelIndex < 0) return null;
    return { typeIndex, nameIndex, modelIndex, quantityIndex };
  };

  let headerMap: { typeIndex: number; nameIndex: number; modelIndex: number; quantityIndex: number } | null = null;

  lines.forEach((rawLine) => {
    const line = String(rawLine || '').trim();
    if (!line || !line.includes('|')) return;

    const rawCols = line.split('|').map((col) => col.trim());
    const cols = trimPipeColumns(rawCols);
    if (cols.length < 3) return;

    const dividerLike = isDividerRowColumns(cols);
    if (dividerLike) return;

    const maybeHeaderMap = resolveHeaderMap(cols);
    const normalizedCols = cols.map((col) => normalizeColumnToken(col));
    const headerHitCount = normalizedCols.filter((token) => TABLE_HEADER_TOKENS.has(token)).length;
    if (!headerMap && maybeHeaderMap && headerHitCount >= 2) {
      headerMap = maybeHeaderMap;
      return;
    }

    let type = '';
    let name = '';
    let model = '';
    let qtyStr = '';

    if (headerMap) {
      type = headerMap.typeIndex >= 0 ? cols[headerMap.typeIndex] || '' : '';
      name = cols[headerMap.nameIndex] || '';
      model = cols[headerMap.modelIndex] || '';
      qtyStr = headerMap.quantityIndex >= 0 ? cols[headerMap.quantityIndex] || '' : '';
    } else {
      const firstCol = String(cols[0] || '').trim();
      const firstIsSerial = /^\d+$/.test(firstCol) || normalizeColumnToken(firstCol) === '序号';
      if (firstIsSerial && cols.length >= 5) {
        [, type, name, model, qtyStr] = cols;
      } else if (cols.length >= 4) {
        [type, name, model, qtyStr] = cols;
      } else {
        [name, model, qtyStr] = cols;
      }
    }

    type = normalizeEquipmentCell(type);
    name = normalizeEquipmentCell(name);
    model = normalizeEquipmentCell(model);

    if (!name || !model) return;

    if (!type) {
      type = inferTypeByNameOrModel(name, model);
    }

    const qtyMatch = String(qtyStr || '').match(/\d+/);
    const quantity = qtyMatch ? Math.max(1, Number(qtyMatch[0])) : 1;

    items.push({
      id: `${Math.random().toString(36).slice(2)}-${items.length}`,
      type,
      name,
      model,
      quantity
    });
  });

  return items;
};

const parseLayoutTableLines = (tableText: string): SolutionLayoutItem[] => {
  const rows: SolutionLayoutItem[] = [];
  const lines = String(tableText || '').split('\n');

  lines.forEach((rawLine) => {
    const line = String(rawLine || '').trim();
    if (!line || !line.includes('|')) return;

    const rawCols = line.split('|').map((col) => col.trim());
    const cols = trimPipeColumns(rawCols);
    if (cols.length < 8) return;

    const dividerLike = isDividerRowColumns(cols);
    if (dividerLike) return;

    const [fn, name, model, xText, yText, zText, pitchText, yawText] = cols;

    const headerHitCount = [fn, name, model]
      .map((col) => normalizeColumnToken(col))
      .filter((token) => ['功能', '产品名称', '型号', 'x', 'y', 'z', '俯仰角', '偏航角'].includes(token))
      .length;
    if (headerHitCount >= 2) return;

    const toNumber = (value: string) => {
      const matched = String(value || '').match(/-?\d+(?:\.\d+)?/);
      if (!matched) return 0;
      const n = Number(matched[0]);
      return Number.isFinite(n) ? n : 0;
    };

    rows.push({
      id: `layout-${Math.random().toString(36).slice(2)}-${rows.length}`,
      function: String(fn || '').trim(),
      name: String(name || '').trim(),
      model: String(model || '').trim(),
      x: toNumber(xText),
      y: toNumber(yText),
      z: toNumber(zText),
      pitch: toNumber(pitchText),
      yaw: toNumber(yawText)
    });
  });

  return rows;
};

const parseSectionIndex = (title: string, prefix: '方案' | '布局') => {
  const matched = String(title || '').match(new RegExp(`${prefix}\\s*(\\d+)`));
  if (!matched) return null;
  const n = Number(matched[1]);
  return Number.isFinite(n) ? n : null;
};

const normalizeDifyContentForBlocks = (content: string) => {
  return String(content || '')
    .replace(/<\/font>\s*\|/gi, '</font>\n|')
    .replace(/\|\s*<font/gi, '|\n<font')
    .replace(/<font([^>]*)>\s*(方案\d+)\s*<\/font>/gi, '<font$1>$2</font>')
    .replace(/<font([^>]*)>\s*(布局\d+)\s*<\/font>/gi, '<font$1>$2</font>');
};

const normalizeRawText = (text: string) => {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r\n/g, '\n');
};

const normalizeSchemeTitle = (value: string) => value.replace(/\s+/g, '');

const extractDocLinksFromSegment = (segment: string) => {
  const wordMatch = segment.match(/https?:\/\/[^\s"']+\.docx/);
  const excelMatch = segment.match(/https?:\/\/[^\s"']+\.xlsx/);
  return {
    word: wordMatch ? wordMatch[0] : '',
    excel: excelMatch ? excelMatch[0] : ''
  };
};

const collectLinkPairs = (text: string) => {
  const pairs: Array<{ word: string; excel: string; key: string }> = [];
  const blocks = [...text.matchAll(/\{[^{}]*\}/g)].map(match => match[0]);
  blocks.forEach(block => {
    const links = extractDocLinksFromSegment(block);
    if (links.word || links.excel) {
      const key = `${links.word}||${links.excel}`;
      pairs.push({ ...links, key });
    }
  });
  return pairs;
};

const extractTableBlocks = (text: string) => {
  const lines = text.split('\n');
  const blocks: Array<{ title: string; tableText: string }> = [];
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx];
    const nextLine = lines[idx + 1] || '';
    const looksLikeTableHeader = line.includes('|') && nextLine.includes('|') && /-+|:-:|:--|--:/g.test(nextLine);

    if (looksLikeTableHeader) {
      let end = idx + 2;
      while (end < lines.length && lines[end].includes('|')) {
        end += 1;
      }
      const tableText = lines.slice(idx, end).join('\n');
      let title = '';
      for (let back = idx - 1; back >= 0 && back >= idx - 6; back -= 1) {
        const candidate = lines[back].trim();
        if (!candidate || candidate.includes('|')) continue;
        title = candidate;
        if (candidate.includes('方案')) break;
      }
      if (!title) {
        title = `方案${blocks.length + 1}`;
      }
      blocks.push({ title, tableText });
      idx = end;
      continue;
    }
    idx += 1;
  }

  return blocks;
};

const parseDifyResponseToResults = (rawText: string): SolutionResult[] => {
  const normalizedText = normalizeRawText(rawText || '');
  const resultStartKeyword = '生成完毕，最终结果如下：';
  const resultStartIndex = normalizedText.indexOf(resultStartKeyword);

  let content = resultStartIndex === -1
    ? normalizedText
    : normalizedText.slice(resultStartIndex + resultStartKeyword.length);
  const docStartIndex = content.indexOf('请耐心等待');
  if (docStartIndex !== -1) {
    content = content.slice(0, docStartIndex);
  }

  const normalizedContent = normalizeDifyContentForBlocks(content);

  // 按 <font size=5> 分割段落（方案/布局）
  const blocks = normalizedContent.split(/<font[^>]*size\s*=\s*["']?5["']?[^>]*>/)
    .map(b => b.replace(/<\/font>/gi, '').trim())
    .filter(b => b);

  const results: SolutionResult[] = [];
  const layoutsByScheme = new Map<number, { items: SolutionLayoutItem[]; raw: string }>();
  for (const block of blocks) {
    const firstLineEnd = block.search(/[\n|]/);
    const title = firstLineEnd > 0 
      ? block.substring(0, firstLineEnd).trim()
      : `方案${results.length + 1}`;
    
    const tablePart = firstLineEnd > 0 
      ? block.substring(firstLineEnd).trim()
      : block;

    if (title.includes('布局')) {
      const layoutItems = parseLayoutTableLines(tablePart);
      const schemeIndex = parseSectionIndex(title, '布局');
      if (schemeIndex !== null) {
        layoutsByScheme.set(schemeIndex, { items: layoutItems, raw: tablePart });
      }
      continue;
    }

    if (!title.includes('方案')) {
      continue;
    }

    const items = parseTableLines(tablePart);
    if (items.length > 0) {
      const schemeIndex = parseSectionIndex(title, '方案');
      const layout = schemeIndex !== null ? layoutsByScheme.get(schemeIndex) : null;
      results.push({
        id: `res-${Date.now()}-${results.length}`,
        title,
        items,
        layoutItems: layout?.items || [],
        layoutRaw: layout?.raw || '',
        wordLink: '',
        excelLink: ''
      });
    }
  }

  if (results.length === 0) {
    const tableBlocks = extractTableBlocks(normalizedContent);
    tableBlocks.forEach(block => {
      if (block.title.includes('布局')) {
        const idx = parseSectionIndex(block.title, '布局');
        if (idx !== null) {
          layoutsByScheme.set(idx, {
            items: parseLayoutTableLines(block.tableText),
            raw: block.tableText
          });
        }
        return;
      }

      if (!block.title.includes('方案')) return;

      const items = parseTableLines(block.tableText);
      if (items.length === 0) return;

      const schemeIndex = parseSectionIndex(block.title, '方案');
      const layout = schemeIndex !== null ? layoutsByScheme.get(schemeIndex) : null;
      results.push({
        id: `res-${Date.now()}-${results.length}`,
        title: block.title,
        items,
        layoutItems: layout?.items || [],
        layoutRaw: layout?.raw || '',
        wordLink: '',
        excelLink: ''
      });
    });
  }

  // 兜底：布局段落可能在方案段落之后出现，二次回填
  results.forEach((res) => {
    if ((res.layoutItems || []).length > 0) return;
    const schemeIndex = parseSectionIndex(res.title, '方案');
    if (schemeIndex === null) return;
    const layout = layoutsByScheme.get(schemeIndex);
    if (!layout) return;
    res.layoutItems = layout.items;
    res.layoutRaw = layout.raw;
  });

  const docSectionIndex = normalizedText.indexOf('请耐心等待');
  const docText = docSectionIndex >= 0 ? normalizedText.slice(docSectionIndex) : normalizedText;

  // 尝试关联文档链接（按标题优先，再按顺序兜底）
  const schemeAnchors = [...docText.matchAll(/方案\s*(\d+)/g)].map(match => ({
    index: match.index ?? 0,
    title: `方案${match[1]}`
  }));

  const collectedPairs = collectLinkPairs(docText);
  const usedPairs = new Set<string>();

  if (schemeAnchors.length > 0) {
    for (let i = 0; i < schemeAnchors.length; i += 1) {
      const start = schemeAnchors[i].index;
      const end = i + 1 < schemeAnchors.length ? schemeAnchors[i + 1].index : docText.length;
      const segment = docText.slice(start, end);
      const links = extractDocLinksFromSegment(segment);
      if (!links.word && !links.excel) continue;

      const target = results.find(r => normalizeSchemeTitle(r.title) === normalizeSchemeTitle(schemeAnchors[i].title));
      if (target) {
        target.wordLink = target.wordLink || links.word;
        target.excelLink = target.excelLink || links.excel;
        usedPairs.add(`${links.word}||${links.excel}`);
      }
    }
  }

  // 兜底：按出现顺序绑定未使用的链接对，不重复复用
  let pairCursor = 0;
  results.forEach((res) => {
    if (res.wordLink && res.excelLink) return;
    while (pairCursor < collectedPairs.length && usedPairs.has(collectedPairs[pairCursor].key)) {
      pairCursor += 1;
    }
    if (pairCursor >= collectedPairs.length) return;
    const pair = collectedPairs[pairCursor];
    res.wordLink = res.wordLink || pair.word;
    res.excelLink = res.excelLink || pair.excel;
    usedPairs.add(pair.key);
    pairCursor += 1;
  });

  return results;
};



// ========================================
// Hook 主体
// ========================================


export const useAcousticLogic = () => {
  // --- 基础页面与 UI 状态 ---
  const [isAiBackendRunning, setIsAiBackendRunning] = useState<boolean | null>(null);
  const aiAutoStartAttemptedRef = useRef(false);

  const checkAiStatus = async () => {
    try {
      // 访问 4000 端口（即便 3003 挂了，4000 照常响应）
      const res = await fetch(`${SYSTEM_API_BASE}/api/system/ai-status`);
      const data = await res.json();
      console.log("Check AI Status (via 4000):", data);
      setIsAiBackendRunning(data.isRunning === true); 
    } catch {
      setIsAiBackendRunning(false);
    }
  };

  const toggleAiBackend = async (action: 'start' | 'stop') => {
    try {
      // 通过 4000 端口的守护进程去执行脚本动作
      const res = await fetch(`${SYSTEM_API_BASE}/api/system/ai-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        // 守护进程有 400ms-1000ms 的拉起耗时，延迟检查
        setTimeout(checkAiStatus, 1000);
        setTimeout(checkAiStatus, 3000); 
      }
    } catch (err) {
      console.error("AI Toggle via Daemon failed:", err);
    }
  };

  useEffect(() => {
    checkAiStatus();
    const timer = setInterval(checkAiStatus, 5000); // 5秒轮询一次状态
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isAiBackendRunning === false && !aiAutoStartAttemptedRef.current) {
      aiAutoStartAttemptedRef.current = true;
      toggleAiBackend('start');
    }
  }, [isAiBackendRunning]);

  const [currentPage, setCurrentPage] = useState<Page>(Page.SOLUTION);
  const [currentSolutionTab, setCurrentSolutionTab] = useState<SolutionTab>(SolutionTab.DESIGN);
  const [currentResultTab, setCurrentResultTab] = useState<ResultTab>(ResultTab.PLAN);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInputValue, setChatInputValue] = useState("");
  const [isProcessingAi, setIsProcessingAi] = useState(false);
  const [isGeneratingDocs, setIsGeneratingDocs] = useState(false);
  const reportGenerationLockRef = useRef(false);
  const [editingItem, setEditingItem] = useState<{ resIdx: number, itemIdx: number, item: EquipmentItem } | null>(null);
  const [previewHistoryItem, setPreviewHistoryItem] = useState<HistoryRecord | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [userRoleFilter, setUserRoleFilter] = useState<string>('ALL');  // --- 方案设计核心状态 ---
  const [userNameFilter, setUserNameFilter] = useState("");
  const [searchFilters, setSearchFilters] = useState({
    品牌: '',
    产品类型: '',
    市场价最小值: '',
    市场价最大值: '',
    产品名称: '',
    用途: '',
    场景: ''
  });
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  // --- 资源管理状态 (对应 MySQL 数据库) ---
  const [activeTable, setActiveTable] = useState<TableType>(TableType.SPEAKER as TableType);
  const [inventory, setInventory] = useState<DbInventoryItem[]>([]);
  const [equipmentDetailCache, setEquipmentDetailCache] = useState<Record<string, DbInventoryItem>>({});
  const [inventoryOptionsByTable, setInventoryOptionsByTable] = useState<Record<string, DbInventoryItem[]>>({});
  const inventoryOptionsLoadingRef = useRef<Record<string, Promise<DbInventoryItem[]>>>({});
  const [speakerProductTypeOptions, setSpeakerProductTypeOptions] = useState<string[]>([]);
  const [speakerFunctionOptions, setSpeakerFunctionOptions] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [micTypeOptions, setMicTypeOptions] = useState<string[]>([]);
  const [planChapterOptions, setPlanChapterOptions] = useState<string[]>(REPORT_CHAPTERS.map((chapter) => chapter.title));
  const [assistantScenario, setAssistantScenario] = useState<Scenario | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser>({
    id: 0,
    username: '游客',
    phone: '',
    company: '',
    role: '游客',
    isGuest: true
  });
  const defaultProjectName = `声学项目_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_01`;
  const isAdminUser = (user: AuthUser) => {
    const role = String(user?.role || '').trim().toLowerCase();
    return role === '管理员' || role === 'admin';
  };
  const [designState, setDesignState] = useState<DesignState>({
    projectName: defaultProjectName,
    scenario: Scenario.MEETING_ROOM,
    params: { ...DEFAULT_PARAMS },
    blueprint: null,
    isDesigned: false,
    chatHistory: [{ role: 'ai', text: '您好，协助您进行声学方案设计的专家已就绪，您可以自主选择在左方进行手动填写或向我提问，我将引导你进行补充。请描述您的场景是会议室还是报告厅（左上方可以进行场景切换便于显示参数）？', timestamp: new Date() }],
    results: [],
    activeResultIndex: 0
  });

  // --- 注入本地 LLM 助理逻辑 ---
  const { sendMessageToAssistant, isAssistantLoading } = useAcousticAssistant(
    designState.params,
    (updater: any) => {
      setDesignState(prev => ({
        ...prev,
        params: typeof updater === 'function' ? updater(prev.params) : { ...prev.params, ...updater }
      }));
    },
    (updater: any) => {
      setDesignState(prev => ({
        ...prev,
        chatHistory: typeof updater === 'function' ? updater(prev.chatHistory) : updater
      }));
    },
    (scenario: Scenario, forceReset = false) => {
      setAssistantScenario(scenario);
      setDesignState(prev => {
        const shouldReset = forceReset || prev.scenario !== scenario;
        if (!shouldReset) {
          return { ...prev, scenario };
        }
        return {
          ...prev,
          scenario,
          params: buildParamsForScenarioReset(prev.params, scenario)
        };
      });
    },
    assistantScenario
  );

  const wrappedSendMessageToAssistant = (text: string) => {
    return sendMessageToAssistant(text, designState.chatHistory, isAiBackendRunning, {
      scenario: designState.scenario,
      micTypeOptions
    });
  };

  // --- [核心修改] 多表切换与主子表关联逻辑 ---
  const displayInventory = useMemo(() => {
    let result = [...inventory];
    // 处理“音箱”分类：需要将主音箱与“线阵列配套”通过 main_id 关联并染色
    if (activeTable === TableType.SPEAKER as TableType) {
      const speakers = inventory.filter(item => !item.main_id || item.main_id === 0);
      const children = inventory.filter(item => item.main_id && item.main_id > 0);
      
      const sortedResult: DbInventoryItem[] = [];
      speakers.forEach(s => {
        sortedResult.push(s);
        // 寻找该音箱关联的配套子项并标记 isChild
        const matchedChildren = children.filter(c => c.main_id === s.id);
        matchedChildren.forEach(c => {
          sortedResult.push({ ...c, isChild: true });
        });
      });
      result = sortedResult;
    }
    if (searchFilters.品牌) {
      const keyword = String(searchFilters.品牌 || '').trim().toLowerCase();
      result = result.filter(item => String(item.品牌 || '').toLowerCase().includes(keyword));
    }

    if (searchFilters.产品类型) {
      const keyword = String(searchFilters.产品类型 || '').trim().toLowerCase();
      result = result.filter(item => {
        const productType = String((item as any).产品类型 || item.类型 || '').toLowerCase();
        return productType.includes(keyword);
      });
    }

    const minPriceRaw = String(searchFilters.市场价最小值 || '').trim();
    const maxPriceRaw = String(searchFilters.市场价最大值 || '').trim();
    const minPrice = Number(minPriceRaw);
    const maxPrice = Number(maxPriceRaw);
    const hasMin = minPriceRaw !== '' && Number.isFinite(minPrice);
    const hasMax = maxPriceRaw !== '' && Number.isFinite(maxPrice);
    if (hasMin || hasMax) {
      result = result.filter(item => {
        const price = Number((item as any).市场价);
        if (!Number.isFinite(price)) return false;
        if (hasMin && price < minPrice) return false;
        if (hasMax && price > maxPrice) return false;
        return true;
      });
    }

    // 3. 排序逻辑
    if (sortConfig) {
      result.sort((a: any, b: any) => {
        const valA = a[sortConfig.key];
        const valB = b[sortConfig.key];
        if (typeof valA === 'string' || typeof valB === 'string') {
          const aStr = (valA || '').toString();
          const bStr = (valB || '').toString();
          return sortConfig.direction === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
        }
        const aNum = Number(valA || 0);
        const bNum = Number(valB || 0);
        return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
      });
    }
    return result;

    // 处理其他分类 (功放、周边设备、其他设备等)
    //return inventory.filter(item => item.类型 === activeTable || (activeTable === TableType.OTHER && !item.类型));
  }, [inventory, searchFilters, sortConfig, activeTable]);

  useEffect(() => {
    const storedUser = localStorage.getItem('acousticUser');
    const storedGuestId = localStorage.getItem('acousticGuestId');
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser) as AuthUser;
        setCurrentUser(parsed);
        return;
      } catch (error) {
        console.warn('Failed to parse stored user:', error);
      }
    }
    const guestId = storedGuestId || uuidv4();
    localStorage.setItem('acousticGuestId', guestId);
    setCurrentUser({
      id: 0,
      username: '游客',
      phone: '',
      company: '',
      role: '游客',
      isGuest: true,
      guestId
    });
  }, []);

  const fetchInventoryByTable = async (table: TableType) => {
    try {
      const response = await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(table)}`);
      if (!response.ok) throw new Error(`Fetch inventory failed: ${response.status}`);
      const data = await response.json();
      setInventory(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("❌ Failed to fetch inventory:", error);
      setInventory([]);
    }
  };

  const fetchSpeakerMetadata = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/inventory/speaker-metadata`);
      if (!response.ok) throw new Error(`Fetch speaker metadata failed: ${response.status}`);
      const data = await response.json().catch(() => ({}));
      const productTypes = Array.isArray(data?.productTypeOptions)
        ? data.productTypeOptions.map((value: any) => String(value || '').trim()).filter(Boolean)
        : [];
      const functions = Array.isArray(data?.functionOptions)
        ? data.functionOptions.map((value: any) => String(value || '').trim()).filter(Boolean)
        : [];
      setSpeakerProductTypeOptions(productTypes);
      setSpeakerFunctionOptions(functions);
    } catch (error) {
      console.error('❌ Failed to fetch speaker metadata:', error);
      setSpeakerProductTypeOptions(['全频音箱', '线阵列音箱', '台唇音箱', '拉声像音箱', '返听音箱', '超低音箱']);
      setSpeakerFunctionOptions(['主扩声', '返听', '辅助扩声', '次低频补偿', '吊装', '壁挂', '吸顶', '舞台监听']);
    }
  };

  const resolveDetailTableCandidates = (item: EquipmentItem): TableType[] => {
    const type = String(item?.type || '').trim();
    const modelKey = normalizeLookupToken(item?.model);
    const nameKey = normalizeLookupToken(item?.name);
    const candidates: TableType[] = [];

    const pushCandidate = (table: TableType) => {
      if (!candidates.includes(table)) {
        candidates.push(table);
      }
    };

    if (type === TableType.SPEAKER) {
      pushCandidate(TableType.SPEAKER);
      pushCandidate(TableType.LINE_ARRAY_SUPPORT);
    }
    if (type === TableType.LINE_ARRAY_SUPPORT) {
      pushCandidate(TableType.LINE_ARRAY_SUPPORT);
      pushCandidate(TableType.SPEAKER);
    }
    if (type === TableType.AMPLIFIER || type === '功放') pushCandidate(TableType.AMPLIFIER);
    if (type === TableType.PERIPHERAL) pushCandidate(TableType.PERIPHERAL);
    if (type === TableType.SUBSYSTEM) pushCandidate(TableType.SUBSYSTEM);
    if (SUBSYSTEM_DEVICE_TYPES.has(type)) {
      pushCandidate(TableType.SUBSYSTEM);
    }
    if (type.includes('定阻功放') || type.includes('功放')) {
      pushCandidate(TableType.AMPLIFIER);
    }
    if (type.includes('音箱') || type.includes('线阵列') || type.includes('扬声器') || type.includes('吸顶') || type.includes('同轴')) {
      pushCandidate(TableType.SPEAKER);
      pushCandidate(TableType.LINE_ARRAY_SUPPORT);
    }
    if (['中控系统', '矩阵', '视频会议系统', '录播系统', '子系统'].some((keyword) => type.includes(keyword))) {
      pushCandidate(TableType.SUBSYSTEM);
    }

    DETAIL_SEARCH_TABLE_ORDER.forEach((table) => {
      const rows = inventoryOptionsByTable[table] || [];
      const hasMatched = rows.some((row) => {
        const rowModel = normalizeLookupToken(row?.型号);
        const rowName = normalizeLookupToken(row?.产品名称);
        const modelMatched = !!modelKey && !!rowModel && (rowModel === modelKey || rowModel.includes(modelKey) || modelKey.includes(rowModel));
        const nameMatched = !!nameKey && !!rowName && (rowName === nameKey || rowName.includes(nameKey) || nameKey.includes(rowName));
        return modelMatched || nameMatched;
      });
      if (hasMatched) pushCandidate(table);
    });

    DETAIL_SEARCH_TABLE_ORDER.forEach(pushCandidate);

    return candidates.length > 0 ? candidates : [TableType.PERIPHERAL];
  };

  const getCachedEquipmentDetail = (item: EquipmentItem) => {
    const tables = resolveDetailTableCandidates(item);
    for (const table of tables) {
      const key = buildEquipmentKey(table, item.model, item.name);
      if (equipmentDetailCache[key]) return equipmentDetailCache[key];
    }
    return null;
  };

  const findInventoryOptionMatch = (rows: DbInventoryItem[], item: EquipmentItem) => {
    const modelKey = normalizeLookupToken(item?.model);
    const nameKey = normalizeLookupToken(item?.name);
    if ((!modelKey && !nameKey) || !Array.isArray(rows) || rows.length === 0) return null;

    const isMatch = (row: DbInventoryItem) => {
      const rowModel = normalizeLookupToken(row?.型号);
      const rowName = normalizeLookupToken(row?.产品名称);

      const modelMatched = !!modelKey && !!rowModel && (rowModel === modelKey || rowModel.includes(modelKey) || modelKey.includes(rowModel));
      const nameMatched = !!nameKey && !!rowName && (rowName === nameKey || rowName.includes(nameKey) || nameKey.includes(rowName));

      if (modelKey && nameKey) return modelMatched || nameMatched;
      if (modelKey) return modelMatched;
      return nameMatched;
    };

    return rows.find(isMatch) || null;
  };

  const fetchEquipmentDetail = async (item: EquipmentItem) => {
    const tables = resolveDetailTableCandidates(item);
    for (const table of tables) {
      const key = buildEquipmentKey(table, item.model, item.name);
      if (equipmentDetailCache[key]) return equipmentDetailCache[key];

      const localOptions = await ensureInventoryOptions(table);
      const localMatched = findInventoryOptionMatch(localOptions, item);
      if (localMatched) {
        setEquipmentDetailCache(prev => ({ ...prev, [key]: localMatched }));
        return localMatched;
      }

      const params = new URLSearchParams();
      if (item.model) {
        params.set('model', item.model);
      }
      if (item.name) {
        params.set('name', item.name);
      }
      if (!params.toString()) {
        continue;
      }

      try {
        const response = await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(table)}/detail?${params.toString()}`);
        if (!response.ok) continue;
        const detail = await response.json();
        if (detail) {
          setEquipmentDetailCache(prev => ({ ...prev, [key]: detail }));
          return detail as DbInventoryItem;
        }
      } catch (error) {
        console.error('❌ Failed to fetch equipment detail:', error);
      }
    }
    return null;
  };

  const analyzeAmplifierMatch = async (payload: AmplifierMatchAnalysisPayload) => {
    const response = await fetch(`${API_BASE}/api/plan/amplifier-match-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(data?.message || data?.error || `Amplifier match analysis failed: ${response.status}`));
    }
    return data;
  };

  const fetchMicTypeOptions = async () => {
    const normalizeOptionList = (values: any[]): string[] => {
      return Array.from(new Set(
        (Array.isArray(values) ? values : [])
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      ));
    };

    const extractMicOptionsFromPeripheralRows = (rows: any[]): string[] => {
      if (!Array.isArray(rows)) return [];

      const options = rows
        .map((row) => {
          if (!row || typeof row !== 'object') return '';

          const entries = Object.entries(row as Record<string, any>);
          const typeEntry = entries.find(([rawKey]) => String(rawKey || '').trim() === '类型');
          const nameEntry = entries.find(([rawKey]) => String(rawKey || '').trim() === '产品名称');

          const typeValue = String(typeEntry?.[1] ?? '').trim();
          if (typeValue !== '话筒') return '';

          return String(nameEntry?.[1] ?? '').trim();
        })
        .filter(Boolean);

      return normalizeOptionList(options);
    };

    try {
      const response = await fetch(`${API_BASE}/api/inventory/microphone-types`);
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        const options = normalizeOptionList(Array.isArray(data?.options) ? data.options : []);
        if (options.length > 0) {
          setMicTypeOptions(options);
          return;
        }
      } else {
        console.warn('⚠️ /api/inventory/microphone-types unavailable, fallback to peripheral table. status=', response.status);
      }
    } catch (error) {
      console.warn('⚠️ Fetch mic types failed, fallback to peripheral table:', error);
    }

    try {
      const fallbackResponse = await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(TableType.PERIPHERAL)}`);
      if (!fallbackResponse.ok) throw new Error(`Fallback mic types failed: ${fallbackResponse.status}`);

      const fallbackData = await fallbackResponse.json().catch(() => []);
      const rows = Array.isArray(fallbackData)
        ? fallbackData
        : Array.isArray((fallbackData as any)?.items)
          ? (fallbackData as any).items
          : [];
      setMicTypeOptions(extractMicOptionsFromPeripheralRows(rows));
    } catch (fallbackError) {
      console.error('❌ Failed to fetch mic types from fallback endpoint:', fallbackError);
      setMicTypeOptions([]);
    }
  };

  const fetchPlanChapterOptions = async (scenario: Scenario) => {
    try {
      const params = new URLSearchParams();
      params.set('scenario', scenario);
      const response = await fetch(`${API_BASE}/api/plan/chapter-options?${params.toString()}`);
      if (!response.ok) throw new Error(`Fetch chapter options failed: ${response.status}`);
      const data = await response.json();
      const chapters = Array.isArray(data?.chapters)
        ? data.chapters.map((title: any) => String(title || '').trim()).filter(Boolean)
        : [];
      if (chapters.length > 0) {
        setPlanChapterOptions(chapters);
      } else {
        setPlanChapterOptions(REPORT_CHAPTERS.map((chapter) => chapter.title));
      }
    } catch (error) {
      console.error('❌ Failed to fetch chapter options:', error);
      setPlanChapterOptions(REPORT_CHAPTERS.map((chapter) => chapter.title));
    }
  };

  useEffect(() => {
    setDesignState((prev) => {
      const currentMics = prev.params.mics || [];
      if (currentMics.length === 0) {
        const defaultMics = buildScenarioDefaultMics(prev.scenario, micTypeOptions);
        if (defaultMics.length === 0) return prev;
        return {
          ...prev,
          params: {
            ...prev.params,
            mics: defaultMics,
            ...buildMicCounts(defaultMics)
          }
        };
      }

      const normalizedMics = normalizeMicsToDbOptions(currentMics, micTypeOptions);
      const hasChanged = normalizedMics.some((mic, index) => {
        const before = currentMics[index];
        return !before || mic.type !== before.type || mic.count !== before.count || mic.id !== before.id;
      });

      if (!hasChanged) return prev;

      return {
        ...prev,
        params: {
          ...prev.params,
          mics: normalizedMics,
          ...buildMicCounts(normalizedMics)
        }
      };
    });
  }, [micTypeOptions]);

  const ensureInventoryOptions = async (table: TableType) => {
    if (Object.prototype.hasOwnProperty.call(inventoryOptionsByTable, table)) {
      return inventoryOptionsByTable[table] || [];
    }

    const pending = inventoryOptionsLoadingRef.current[table];
    if (pending) {
      return pending;
    }

    const loadingPromise = (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(table)}`);
        if (!response.ok) throw new Error(`Fetch inventory options failed: ${response.status}`);
        const data = await response.json();
        const normalized = Array.isArray(data) ? data : [];
        setInventoryOptionsByTable(prev => ({ ...prev, [table]: normalized }));
        return normalized;
      } catch (error) {
        console.error('❌ Failed to fetch inventory options:', error);
        setInventoryOptionsByTable(prev => ({ ...prev, [table]: [] }));
        return [];
      }
    })();

    inventoryOptionsLoadingRef.current[table] = loadingPromise;

    try {
      return await loadingPromise;
    } finally {
      delete inventoryOptionsLoadingRef.current[table];
    }
  };

  const getInventoryOptions = (table: TableType) => inventoryOptionsByTable[table] || [];

  const replacePlanItem = (resIdx: number, itemIdx: number, detail: DbInventoryItem) => {
    setDesignState(prev => {
      const newResults = [...prev.results];
      const currentItem = newResults[resIdx]?.items[itemIdx];
      if (!currentItem) return prev;

      const nextItem: EquipmentItem = {
        ...currentItem,
        name: detail.产品名称 || currentItem.name,
        model: detail.型号 || currentItem.model,
        brand: detail.品牌 || currentItem.brand,
        unitPrice: Number(detail.市场价) || currentItem.unitPrice || 0,
        inventoryMatched: true,
        inventoryMatchNote: '',
        recentlyUpdated: true
      };

      newResults[resIdx] = {
        ...newResults[resIdx],
        items: newResults[resIdx].items.map((item, idx) => (idx === itemIdx ? nextItem : item))
      };
      return { ...prev, results: newResults };
    });
  };

  useEffect(() => {
    fetchInventoryByTable(activeTable);
  }, [activeTable]);

  useEffect(() => {
    fetchSpeakerMetadata();
  }, []);

  useEffect(() => {
    fetchMicTypeOptions();
  }, []);

  useEffect(() => {
    fetchPlanChapterOptions(designState.scenario);
  }, [designState.scenario]);

  const fetchUsers = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/users`);
      if (!response.ok) throw new Error(`Fetch users failed: ${response.status}`);
      const data = await response.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('❌ Failed to fetch users:', error);
      setUsers([]);
    }
  };

  const fetchHistory = async (user: AuthUser) => {
    try {
      const params = new URLSearchParams();
      if (!user.isGuest && user.id) params.set('userId', String(user.id));
      if (user.isGuest && user.guestId) params.set('guestId', user.guestId);
      const response = await fetch(`${API_BASE}/api/history?${params.toString()}`);
      if (!response.ok) throw new Error(`Fetch history failed: ${response.status}`);
      const data = await response.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('❌ Failed to fetch history:', error);
      setHistory([]);
    }
  };

  useEffect(() => {
    fetchHistory(currentUser);
    if (isAdminUser(currentUser)) {
      fetchUsers();
    }
    if ((currentPage === Page.MANAGEMENT || currentPage === Page.USERS) && !isAdminUser(currentUser)) {
      setCurrentPage(Page.SOLUTION);
    }
  }, [currentUser]);

  const clearConfirmFlagsByParamChange = (
    params: AcousticParams,
    changedKey: keyof AcousticParams | 'scenario'
  ): AcousticParams => {
    const next = { ...params };

    if (changedKey === 'scenario') {
      next.scenarioConfirmed = false;
      next.roomConfirmed = false;
      next.stageConfirmed = false;
      next.micsConfirmed = false;
      next.subsystemsConfirmed = false;
      next.extraRequirementsConfirmed = false;
      return next;
    }

    if (['length', 'width', 'height'].includes(String(changedKey))) {
      next.roomConfirmed = false;
    }

    if (['stageToNearAudience', 'stageToFarAudience', 'stageWidth', 'stageDepth'].includes(String(changedKey))) {
      next.stageConfirmed = false;
    }

    if (
      ['mics', 'micHandheld', 'micGooseneck', 'micOmni', 'micLavalier', 'micCeiling'].includes(String(changedKey))
    ) {
      next.micsConfirmed = false;
    }

    if (SUBSYSTEM_PARAM_KEYS.includes(changedKey as keyof AcousticParams)) {
      next.subsystemsConfirmed = false;
    }

    if (changedKey === 'extraRequirements') {
      next.extraRequirementsConfirmed = false;
    }

    return next;
  };

  const buildParamsForScenarioReset = (prevParams: AcousticParams, scenarioValue: Scenario): AcousticParams => {
    const nextMics = buildScenarioDefaultMics(scenarioValue, micTypeOptions);
    return {
      ...prevParams,
      length: DEFAULT_PARAMS.length,
      width: DEFAULT_PARAMS.width,
      height: DEFAULT_PARAMS.height,
      stageToNearAudience: 0,
      stageToFarAudience: 0,
      stageWidth: 0,
      stageDepth: 0,
      hasCentralControl: DEFAULT_PARAMS.hasCentralControl,
      hasMatrix: DEFAULT_PARAMS.hasMatrix,
      hasVideoConf: DEFAULT_PARAMS.hasVideoConf,
      hasRecording: DEFAULT_PARAMS.hasRecording,
      mics: nextMics,
      ...buildMicCounts(nextMics),
      extraRequirements: '',
      scenarioConfirmed: false,
      roomConfirmed: false,
      stageConfirmed: false,
      micsConfirmed: false,
      subsystemsConfirmed: false,
      extraRequirementsConfirmed: false
    };
  };

  // --- 方案参数处理 ---
  const handleParamChange = (key: keyof AcousticParams | 'scenario', value: any) => {
    if (key === 'scenario') {
      const scenarioValue = value as Scenario;
      setDesignState(prev => ({
        ...prev,
        scenario: scenarioValue,
        params: buildParamsForScenarioReset(prev.params, scenarioValue)
      }));
      setAssistantScenario(scenarioValue);
      return;
    }
    if (key === 'mics') {
      const list = normalizeMicsToDbOptions(normalizeMicListValue(value), micTypeOptions);
      setDesignState(prev => ({
        ...prev,
        params: clearConfirmFlagsByParamChange({
          ...prev.params,
          mics: list,
          ...buildMicCounts(list)
        }, 'mics')
      }));
      return;
    }
    setDesignState(prev => ({
      ...prev,
      params: clearConfirmFlagsByParamChange({ ...prev.params, [key]: value } as AcousticParams, key)
    }));
  };

  const addMic = () => {
    setDesignState(prev => {
      const defaultMicType = String(micTypeOptions[0] || '').trim();
      if (!defaultMicType) return prev;
      const nextMics = [...(prev.params.mics || []), { id: uuidv4(), type: defaultMicType, count: 1 }];
      return {
        ...prev,
        params: clearConfirmFlagsByParamChange({
          ...prev.params,
          mics: nextMics,
          ...buildMicCounts(nextMics)
        }, 'mics')
      };
    });
  };

  const removeMic = (id: string) => {
    setDesignState(prev => {
      const nextMics = (prev.params.mics || []).filter(mic => mic.id !== id);
      return {
        ...prev,
        params: clearConfirmFlagsByParamChange({
          ...prev.params,
          mics: nextMics,
          ...buildMicCounts(nextMics)
        }, 'mics')
      };
    });
  };

  const handleMicChange = (id: string, count: number) => {
    const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
    setDesignState(prev => {
      const nextMics = (prev.params.mics || []).map(mic =>
        mic.id === id ? { ...mic, count: safeCount } : mic
      );
      return {
        ...prev,
        params: clearConfirmFlagsByParamChange({
          ...prev.params,
          mics: nextMics,
          ...buildMicCounts(nextMics)
        }, 'mics')
      };
    });
  };

  const handleUpdateProjectName = (name: string) => {
    setDesignState(prev => ({ ...prev, projectName: name }));
  };

  // --- 交互与设计逻辑 ---
  const handleSendMessage = async () => {
    if (!chatInputValue.trim() || isAssistantLoading) return;
    const msg = chatInputValue;
    setChatInputValue("");
    await sendMessageToAssistant(msg, designState.chatHistory, isAiBackendRunning, {
      scenario: designState.scenario,
      micTypeOptions
    });
  };




 // new_startDesign
const startDesign = async () => {
  setDesignState((prev) => ({
    ...prev,
    isDesigned: false
  }));

  // ✅ 参数校验：基础尺寸必须 > 0
  if (
    designState.params.length <= 0 ||
    designState.params.width <= 0 ||
    designState.params.height <= 0
  ) {
    alert('❌ 房间长、宽、安装高度必须大于 0');
    setIsProcessingAi(false);
    return;
  }

  // ✅ 报告厅额外校验
if (designState.scenario === Scenario.LECTURE_HALL) {
  const {
    length,
    width,
    stageToNearAudience = 0,
    stageToFarAudience = 0,
    stageWidth = 0,
    stageDepth = 0,
  } = designState.params;

  // 1. 四个报告厅参数必须 > 0
  if (
    stageToNearAudience <= 0 ||
    stageToFarAudience <= 0 ||
    stageWidth <= 0 ||
    stageDepth <= 0
  ) {
    alert('❌ 报告厅参数：台口至最近、台口至最远、台口宽度、舞台深度必须大于 0');
    setIsProcessingAi(false);
    return;
  }

  // 2. 最近距离必须小于最远距离
  if (stageToNearAudience >= stageToFarAudience) {
    alert('❌ “台口至最近” 必须小于 “台口至最远”');
    setIsProcessingAi(false);
    return;
  }

  // 3. 台口宽度不能超过房间宽度
  if (stageWidth > width) {
    alert('❌ 台口宽度不能大于房间宽度');
    setIsProcessingAi(false);
    return;
  }

  // 4. 舞台深度不能超过房间长度
  if (stageDepth > length) {
    alert('❌ 舞台深度不能大于房间长度');
    setIsProcessingAi(false);
    return;
  }

  // 5. 最远观众距离不应明显超过房间对角线（防止误输极大值）
  const roomDiagonal = Math.sqrt(length * length + width * width);
  if (stageToFarAudience > roomDiagonal + 10) {
    alert(`❌ “台口至最远观众距离”过大（${stageToFarAudience}m），建议不超过房间对角线（约 ${roomDiagonal.toFixed(1)}m）`);
    setIsProcessingAi(false);
    return;
  }
}

  // 👇 构造 geometry：基础参数始终存在
  const baseGeometry = {
    length: designState.params.length,
    width: designState.params.width,
    height: designState.params.height,
  };

  // 👇 报告厅场景：扩展四个新字段（字段名与 UI 完全一致）
  const geometry =
    designState.scenario === Scenario.LECTURE_HALL
      ? {
          ...baseGeometry,
          stageToNearAudience: designState.params.stageToNearAudience,
          stageToFarAudience: designState.params.stageToFarAudience,
          stageWidth: designState.params.stageWidth,
          stageDepth: designState.params.stageDepth,
        }
      : baseGeometry;

  const difyMics = ((designState.params.mics && designState.params.mics.length)
    ? designState.params.mics
    : buildMicListFromCounts(designState.params)
  ).map((mic) => ({
    id: mic.id,
    type: normalizeMicDisplayType(mic.type),
    count: Number.isFinite(mic.count) ? Math.max(0, mic.count) : 0
  })).filter((mic) => mic.count > 0);

  const acousticIntent = {
    schema_version: "v1",
    intent_type: "acoustic_design",
    inputSignals: {
      scenario: designState.scenario,
      geometry, // ✅ 动态结构
    },
    processingSignals: {
      mics: difyMics,
      subsystems: {
        hasCentralControl: designState.params.hasCentralControl,
        hasMatrix: designState.params.hasMatrix,
        hasVideoConf: designState.params.hasVideoConf,
        hasRecording: designState.params.hasRecording,
      },
    },
    outputSignals: {
      target: "acoustic_design_plan",
    },
    timestamp: new Date().toISOString(),
  };

  console.log("🎯 Acoustic Intent:", acousticIntent);
  setDesignState(prev => ({
    ...prev,
    chatHistory: [
      ...prev.chatHistory,
      {
        role: 'ai',
        text: '方案制定中，请稍等',
        timestamp: new Date(),
      },
    ],
  }));
  setIsProcessingAi(true);

  try {
    const apiResult = await submitDesign(acousticIntent, {
      userId: currentUser.isGuest ? null : currentUser.id,
      guestId: currentUser.isGuest ? (currentUser.guestId ?? null) : null,
      username: currentUser.username
    });
    const rawText = apiResult?.raw_answer ?? apiResult?.answer ?? apiResult?.data?.answer ?? '';

    // 🔑 解析结构化方案
    const parsedResults = parseDifyResponseToResults(rawText);
    const enrichedResults = await Promise.all(
      parsedResults.map(async (res) => {
        const enrichedItems = await Promise.all(
          res.items.map(async (item) => {
            const detail = await fetchEquipmentDetail(item);
            if (!detail) {
              return {
                ...item,
                inventoryMatched: false,
                inventoryMatchNote: '未匹配到库存'
              };
            }
            return {
              ...item,
              name: detail.产品名称 || item.name,
              model: detail.型号 || item.model,
              brand: detail.品牌 || item.brand,
              unitPrice: Number(detail.市场价) || item.unitPrice || 0,
              inventoryMatched: true,
              inventoryMatchNote: ''
            };
          })
        );
        return { ...res, items: enrichedItems };
      })
    );

    setDesignState((prev) => ({
      ...prev,
      isDesigned: true,
      results: enrichedResults,
      activeResultIndex: 0,
      chatHistory: [
        ...prev.chatHistory,
        {
          role: 'ai',
          text: enrichedResults.length > 0
            ? '方案已经设计完成请查看列表'
            : '❌ 方案生成失败，请检查后端日志。',
          timestamp: new Date(),
        },
      ],
    }));

    setCurrentResultTab(ResultTab.PLAN);

    const historyPayload = {
      userId: currentUser.isGuest ? null : currentUser.id,
      guestId: currentUser.isGuest ? currentUser.guestId : null,
      username: currentUser.username,
      projectName: designState.projectName,
      scenario: designState.scenario,
      params: designState.params,
      results: enrichedResults.map((res) => ({
        ...res,
        simulationImage: '',
        wordLink: res.wordLink || '',
        excelLink: res.excelLink || ''
      }))
    };

    try {
      const historyResponse = await fetch(`${API_BASE}/api/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(historyPayload)
      });
      if (historyResponse.ok) {
        await fetchHistory(currentUser);
      }
    } catch (error) {
      console.error('❌ Save history failed:', error);
    }
  } catch (error) {
    console.error("startDesign 异常:", error);
    setDesignState((prev) => ({
      ...prev,
      chatHistory: [
        ...prev.chatHistory,
        {
          role: 'ai',
          text: '⚠️ 系统异常，请查看控制台日志。',
          timestamp: new Date(),
        },
      ],
    }));
  } finally {
    setIsProcessingAi(false);
  }
};


  const saveEdit = (
    linkedUpdateOrUpdates?:
      | { resIdx: number; itemIdx: number; itemPatch: Partial<EquipmentItem> }
      | Array<{ resIdx: number; itemIdx: number; itemPatch: Partial<EquipmentItem> }>
      | null
  ) => {
    if (!editingItem) return;

    const linkedUpdates = Array.isArray(linkedUpdateOrUpdates)
      ? linkedUpdateOrUpdates
      : linkedUpdateOrUpdates
        ? [linkedUpdateOrUpdates]
        : [];

    setDesignState(prev => {
      const newResults = [...prev.results];
      const result = newResults[editingItem.resIdx];
      if (!result) return prev;

      const nextItems = [...result.items];
      if (!nextItems[editingItem.itemIdx]) return prev;
      nextItems[editingItem.itemIdx] = {
        ...editingItem.item,
        recentlyUpdated: true
      };

      linkedUpdates.forEach((linkedUpdate) => {
        if (!linkedUpdate || linkedUpdate.resIdx !== editingItem.resIdx) return;
        const linkedItem = nextItems[linkedUpdate.itemIdx];
        if (!linkedItem) return;
        nextItems[linkedUpdate.itemIdx] = {
          ...linkedItem,
          ...linkedUpdate.itemPatch,
          recentlyUpdated: true
        };
      });

      newResults[editingItem.resIdx] = {
        ...result,
        items: nextItems
      };
      return { ...prev, results: newResults };
    });
    setEditingItem(null);
  };

  const handleLogout = () => {
    if (!confirm('确定要退出系统吗？')) return;
    localStorage.removeItem('acousticUser');
    const guestId = localStorage.getItem('acousticGuestId') || uuidv4();
    localStorage.setItem('acousticGuestId', guestId);
    setCurrentUser({
      id: 0,
      username: '游客',
      phone: '',
      company: '',
      role: '游客',
      isGuest: true,
      guestId
    });
  };
// --- 1. 实现 deleteItem (方案明细中的设备删除) ---
const deleteItem = (resIdx: number, itemIdx: number) => {
  setDesignState(prev => {
    const newResults = [...prev.results];
    // 深度拷贝该方案下的 items 数组并执行删除
    newResults[resIdx] = {
      ...newResults[resIdx],
      items: newResults[resIdx].items.filter((_, i) => i !== itemIdx)
    };
    return { ...prev, results: newResults };
  });
};

// --- 2. 实现 handleGenerateReports (生成正式报告) ---
const handleGenerateReports = async (scope: 'CURRENT' | 'ALL') => {
  if (reportGenerationLockRef.current || isGeneratingDocs) {
    console.warn('[PLAN_RENDER_TRACE] duplicate-request-skipped', {
      scope,
      reason: 'generation-in-progress'
    });
    return;
  }

  const rawTargets = scope === 'CURRENT'
    ? [designState.results[designState.activeResultIndex]].filter(Boolean)
    : designState.results;
  const targets = Array.from(new Map(rawTargets.map((item) => [String(item.id), item])).values());

  if (rawTargets.length !== targets.length) {
    console.warn('[PLAN_RENDER_TRACE] duplicate-target-pruned', {
      scope,
      rawTargetCount: rawTargets.length,
      dedupedTargetCount: targets.length
    });
  }

  const clickTs = Date.now();
  console.log('[PLAN_RENDER_TRACE] generate-clicked', {
    at: new Date(clickTs).toISOString(),
    ts: clickTs,
    scope,
    targetCount: targets.length
  });

  if (targets.length === 0) {
    alert('当前没有可生成报告的方案。');
    return;
  }

  reportGenerationLockRef.current = true;

  const targetIdSet = new Set(targets.map((item) => String(item.id)));

  setDesignState((prev) => ({
    ...prev,
    results: prev.results.map((res) => {
      if (!targetIdSet.has(String(res.id))) return res;
      return {
        ...res,
        chapters: [],
        reportGenerationStatus: 'generating',
        reportGenerationError: '',
        markdownRaw: '',
        markdownProcessed: '',
        postProcessReport: undefined
      };
    })
  }));

  setIsGeneratingDocs(true);
  try {
    const requestStartTs = Date.now();
    console.log('[PLAN_RENDER_TRACE] request-start', {
      at: new Date(requestStartTs).toISOString(),
      ts: requestStartTs,
      scope,
      targetCount: targets.length
    });

    const response = await fetch(`${API_BASE}/api/plan/generate-markdowns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName: designState.projectName,
        scenario: designState.scenario,
        params: designState.params,
        plans: targets.map(plan => ({
          id: plan.id,
          title: plan.title,
          items: plan.items
        }))
      })
    });

    const responseData = await response.json().catch(() => ({} as any));
    const responseReceivedTs = Date.now();
    console.log('[PLAN_RENDER_TRACE] response-received', {
      at: new Date(responseReceivedTs).toISOString(),
      ts: responseReceivedTs,
      elapsedMs: responseReceivedTs - requestStartTs,
      status: response.status,
      ok: response.ok,
      backendTrace: responseData?.trace || null
    });

    if (!response.ok) {
      throw new Error(String(responseData?.error || `Generate markdown failed: ${response.status}`));
    }

    const generated = Array.isArray(responseData?.generated) ? responseData.generated : [];
    const failed = Array.isArray(responseData?.failed) ? responseData.failed : [];

    const matchByIdOrTitle = (entry: any, target: SolutionResult) => {
      const entryId = entry?.id != null ? String(entry.id) : '';
      const targetId = String(target.id);
      if (entryId && entryId === targetId) return true;
      const entryTitle = String(entry?.title || '').trim();
      const targetTitle = String(target.title || '').trim();
      return !!entryTitle && !!targetTitle && entryTitle === targetTitle;
    };

    const generatedByTargetId = new Map<string, any>();
    const failedByTargetId = new Map<string, any>();
    targets.forEach((target) => {
      const matchedGenerated = generated.find((item: any) => matchByIdOrTitle(item, target));
      if (matchedGenerated) {
        generatedByTargetId.set(String(target.id), matchedGenerated);
        return;
      }

      const matchedFailed = failed.find((item: any) => matchByIdOrTitle(item, target));
      if (matchedFailed) {
        failedByTargetId.set(String(target.id), matchedFailed);
      }
    });

    const successCount = generatedByTargetId.size;
    const errorCount = Math.max(0, targets.length - successCount);

    const stateUpdateStartTs = Date.now();
    console.log('[PLAN_RENDER_TRACE] state-update-start', {
      at: new Date(stateUpdateStartTs).toISOString(),
      ts: stateUpdateStartTs,
      successCount,
      errorCount
    });

    setDesignState((prev) => ({
      ...prev,
      results: prev.results.map((res) => {
        if (!targetIdSet.has(String(res.id))) return res;

        const matchedGenerated = generatedByTargetId.get(String(res.id));
        if (matchedGenerated) {
          return {
            ...res,
            markdownRaw: String(matchedGenerated.markdownRaw || ''),
            markdownProcessed: String(matchedGenerated.markdownProcessed || ''),
            postProcessReport: matchedGenerated.postProcessReport || undefined,
            wordLink: matchedGenerated.docLink ? resolveBackendLink(String(matchedGenerated.docLink)) : (res.wordLink || ''),
            reportGenerationStatus: 'done',
            reportGenerationError: '',
            chapters: [],
            lastReportSignature: buildItemsSignature(res.items)
          };
        }

        const matchedFailed = failedByTargetId.get(String(res.id));
        return {
          ...res,
          reportGenerationStatus: 'error',
          reportGenerationError: String(matchedFailed?.message || '方案生成失败，请稍后重试。'),
          chapters: []
        };
      })
    }));

    requestAnimationFrame(() => {
      const renderTs = Date.now();
      console.log('[PLAN_RENDER_TRACE] frontend-render-approx', {
        at: new Date(renderTs).toISOString(),
        ts: renderTs,
        elapsedFromStateUpdateMs: renderTs - stateUpdateStartTs,
        elapsedFromResponseMs: renderTs - responseReceivedTs
      });
    });

    if (successCount > 0 && errorCount === 0) {
      alert(scope === 'CURRENT' ? '当前方案生成已完成' : '所有方案生成已完成');
    } else if (successCount > 0) {
      alert('方案生成已结束：部分方案生成失败，请重试。');
    } else {
      alert('方案生成失败，请检查后端日志后重试。');
    }
  } catch (error) {
    console.error('❌ Generate markdowns failed:', error);
    setDesignState((prev) => ({
      ...prev,
      results: prev.results.map((res) => {
        if (!targetIdSet.has(String(res.id))) return res;
        return {
          ...res,
          reportGenerationStatus: 'error',
          reportGenerationError: '方案生成失败，请稍后重试。',
          chapters: []
        };
      })
    }));
    alert('方案生成失败，请检查后端日志。');
  } finally {
    setIsGeneratingDocs(false);
    reportGenerationLockRef.current = false;
  }
};

// --- 3. 实现 deleteUser (用户管理中的删除) ---
const deleteUser = async (id: number) => {
  if (!window.confirm("确定要删除该用户吗？此操作不可恢复。")) return;
  try {
    const response = await fetch(`${API_BASE}/api/users/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Delete user failed: ${response.status}`);
    await fetchUsers();
  } catch (error) {
    console.error('❌ Delete user failed:', error);
    alert('删除用户失败，请检查后端日志。');
  }
};

const addUser = async (user: Omit<User, 'id'> & { password: string }) => {
  try {
    const response = await fetch(`${API_BASE}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user)
    });
    if (!response.ok) throw new Error(`Create user failed: ${response.status}`);
    await fetchUsers();
  } catch (error) {
    console.error('❌ Create user failed:', error);
    alert('新增用户失败，请检查后端日志。');
  }
};

const updateUser = async (user: User & { password?: string }) => {
  try {
    const response = await fetch(`${API_BASE}/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user)
    });
    if (!response.ok) throw new Error(`Update user failed: ${response.status}`);
    await fetchUsers();
  } catch (error) {
    console.error('❌ Update user failed:', error);
    alert('更新用户失败，请检查后端日志。');
  }
};

const login = async (username: string, password: string) => {
  try {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!response.ok) throw new Error(`Login failed: ${response.status}`);
    const data = await response.json();
    const user: AuthUser = { ...data, isGuest: false };
    setCurrentUser(user);
    localStorage.setItem('acousticUser', JSON.stringify(user));
    return true;
  } catch (error) {
    console.error('❌ Login failed:', error);
    return false;
  }
};

const updateProfile = async (updates: Partial<User> & { password?: string }) => {
  if (currentUser.isGuest || !currentUser.id) return false;
  try {
    const response = await fetch(`${API_BASE}/api/users/${currentUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...currentUser, ...updates })
    });
    if (!response.ok) throw new Error(`Update profile failed: ${response.status}`);
    const nextUser = { ...currentUser, ...updates } as AuthUser;
    setCurrentUser(nextUser);
    localStorage.setItem('acousticUser', JSON.stringify(nextUser));
    return true;
  } catch (error) {
    console.error('❌ Update profile failed:', error);
    return false;
  }
};
const exportPdfFromDomIds = async (domIds: string[], outputTitle: string) => {
  const uniqueIds = Array.from(new Set((domIds || []).filter(Boolean)));
  const sections = uniqueIds
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => !!el)
    .map((el) => `<section class="pdf-print-section">${el.outerHTML}</section>`)
    .join('\n');

  if (!sections) {
    alert('未找到可导出的报告内容，请先生成正式报告。');
    return false;
  }

  const styles = buildPrintWindowStyles();
  const safeTitle = `${outputTitle || '声学方案'}_PDF`;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
  const frameWin = iframe.contentWindow;
  if (!frameDoc || !frameWin) {
    iframe.remove();
    alert('导出初始化失败，请重试。');
    return false;
  }

  frameDoc.open();
  frameDoc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  ${styles}
</head>
<body>
  <main class="pdf-print-root">${sections}</main>
</body>
</html>`);
  frameDoc.close();

  await new Promise<void>((resolve) => {
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      frameWin.onafterprint = null;
      iframe.remove();
      resolve();
    };

    const runPrint = () => {
      try {
        frameWin.focus();
        frameWin.print();
      } finally {
        // 部分浏览器不触发 onafterprint，兜底清理
        window.setTimeout(cleanup, 8000);
      }
    };

    frameWin.onafterprint = cleanup;

    if (frameDoc.readyState === 'complete') {
      setTimeout(runPrint, 200);
    } else {
      iframe.onload = () => setTimeout(runPrint, 200);
    }
  });

  return true;
};

const copyMarkdown = async (scope: 'CURRENT' | 'ALL' = 'CURRENT') => {
  const targets = scope === 'CURRENT'
    ? [designState.results[designState.activeResultIndex]].filter(Boolean)
    : designState.results;

  const markdownText = targets
    .map((res) => {
      const body = res.markdownProcessed || res.markdownRaw || '';
      if (!body) return '';
      return `# ${res.title}\n\n${body}`;
    })
    .filter(Boolean)
    .join('\n\n---\n\n');

  if (!markdownText) {
    alert('当前没有可复制的 Markdown 内容，请先生成正式报告。');
    return;
  }

  try {
    await navigator.clipboard.writeText(markdownText);
    alert(scope === 'CURRENT' ? '当前方案 Markdown 已复制' : '所有方案 Markdown 已复制');
  } catch (error) {
    console.error('❌ Copy markdown failed:', error);
    alert('复制失败，请检查浏览器剪贴板权限。');
  }
};

// --- 4. 实现 handleDownload (文件下载逻辑) ---
const handleDownload = async (type: 'EXCEL' | 'PDF' | 'PNG', scope: 'CURRENT' | 'ALL' = 'CURRENT') => {
  if (type === 'PNG') {
    const fileName = designState.projectName || "声学方案";
    alert(`系统正在准备 ${fileName} 的 ${type} 文件，请稍后...`);
    return;
  }

  const results = scope === 'CURRENT'
    ? [designState.results[designState.activeResultIndex]].filter(Boolean)
    : designState.results;

  if (type === 'EXCEL') {
    const rows: Array<Record<string, string | number>> = [];
    results.forEach((res) => {
      res.items.forEach((item) => {
        const unitPrice = Number(item.unitPrice || 0);
        const qty = Number(item.quantity || 0);
        rows.push({
          方案: res.title,
          设备分类: item.type || '',
          品牌: item.brand || '',
          产品名称: item.name || '',
          型号: item.model || '',
          数量: qty,
          单价: unitPrice,
          小计: unitPrice * qty
        });
      });
    });
    if (rows.length === 0) {
      alert('当前没有可导出的设备数据。');
      return;
    }
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '设备清单');
    const fileName = `${designState.projectName || '声学方案'}_${scope === 'CURRENT' ? '当前方案' : '全部方案'}_设备清单.xlsx`;
    XLSX.writeFile(workbook, fileName);
    return;
  }

  if (type === 'PDF') {
    const hasPending = results.some((res) => res.reportGenerationStatus === 'generating');
    if (hasPending) {
      alert('方案仍在生成中，请等待完成后再导出。');
      return;
    }
    const domIds = results.map((res) => buildReportPrintDomId(String(res.id)));
    await exportPdfFromDomIds(domIds, `${designState.projectName || '声学方案'}_${scope === 'CURRENT' ? '当前方案' : '全部方案'}`);
    return;
  }
};
const handleBlueprintUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (upload) => {
      setDesignState(prev => ({ ...prev, blueprint: upload.target?.result as string }));
    };
    reader.readAsDataURL(file);
  }
};
const handleSaveEquipment = async (table: TableType, item: Partial<DbInventoryItem>) => {
  try {
    const response = await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(table)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item)
    });
    if (!response.ok) {
      throw new Error(`Create inventory failed: ${response.status}`);
    }
    await fetchInventoryByTable(table);
    alert("设备录入成功！");
    return true;
  } catch (error) {
    console.error("❌ Create inventory failed:", error);
    alert("设备录入失败，请检查后端日志。");
    return false;
  }
};

const parseInventoryBatch = async (params: {
  table: TableType;
  inputType: 'text' | 'image' | 'excel' | 'chat';
  text?: string;
  imageData?: string;
  items?: Array<Record<string, any>>;
}) => {
  try {
    const response = await fetch(`${API_BASE}/api/inventory/parse-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        items: [] as Array<{ id: number; payload: Partial<DbInventoryItem>; errors: string[]; complete: boolean }>,
        error: String(data?.details || data?.error || '批量解析失败')
      };
    }

    return {
      ok: true,
      items: Array.isArray(data?.items) ? data.items : [],
      error: ''
    };
  } catch (error: any) {
    console.error('❌ Parse inventory batch failed:', error);
    return {
      ok: false,
      items: [] as Array<{ id: number; payload: Partial<DbInventoryItem>; errors: string[]; complete: boolean }>,
      error: String(error?.message || '批量解析失败')
    };
  }
};

const updateInventoryItem = async (table: TableType, id: number, updates: Partial<DbInventoryItem>) => {
  try {
    const response = await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(table)}/${id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      }
    );
    if (!response.ok) {
      throw new Error(`Update inventory failed: ${response.status}`);
    }
    await fetchInventoryByTable(table);
    alert("设备更新成功！");
    return true;
  } catch (error) {
    console.error("❌ Update inventory failed:", error);
    alert("设备更新失败，请检查后端日志。");
    return false;
  }
};

const deleteInventoryItem = async (table: TableType, id: number) => {
  try {
    const response = await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(table)}/${id}`,
      {
        method: "DELETE"
      }
    );
    if (!response.ok) {
      throw new Error(`Delete inventory failed: ${response.status}`);
    }
    await fetchInventoryByTable(table);
    return true;
  } catch (error) {
    console.error("❌ Delete inventory failed:", error);
    alert("设备删除失败，请检查后端日志。");
    return false;
  }
};

const deleteInventoryItemsBatch = async (table: TableType, ids: number[]) => {
  const validIds = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );

  if (validIds.length === 0) {
    return { ok: false, deleted: 0, requested: 0 };
  }

  try {
    const response = await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(table)}/batch-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: validIds })
    });

    if (!response.ok) {
      throw new Error(`Batch delete inventory failed: ${response.status}`);
    }

    const data = await response.json().catch(() => ({}));
    await fetchInventoryByTable(table);
    return {
      ok: true,
      deleted: Number(data?.affectedRows || 0),
      requested: validIds.length
    };
  } catch (error) {
    console.error("❌ Batch delete inventory failed:", error);
    alert("批量删除失败，请检查后端日志。");
    return { ok: false, deleted: 0, requested: validIds.length };
  }
};

const updateHistoryRecord = async (id: number, updates: Partial<HistoryRecord>) => {
  try {
    const response = await fetch(`${API_BASE}/api/history/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!response.ok) throw new Error(`Update history failed: ${response.status}`);
    await fetchHistory(currentUser);
  } catch (error) {
    console.error('❌ Update history failed:', error);
    alert('历史记录更新失败，请检查后端日志。');
  }
};

const deleteHistoryRecord = async (id: number) => {
  if (!window.confirm('确定要删除该历史记录吗？此操作不可恢复。')) return;
  try {
    const response = await fetch(`${API_BASE}/api/history/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Delete history failed: ${response.status}`);
    await fetchHistory(currentUser);
  } catch (error) {
    console.error('❌ Delete history failed:', error);
    alert('历史记录删除失败，请检查后端日志。');
  }
};

const deleteHistoryRecordsBatch = async (ids: number[]) => {
  const validIds = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );

  if (validIds.length === 0) {
    return { ok: false, deleted: 0, requested: 0 };
  }

  try {
    const response = await fetch(`${API_BASE}/api/history/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: validIds })
    });

    if (!response.ok) throw new Error(`Batch delete history failed: ${response.status}`);

    const data = await response.json().catch(() => ({}));
    await fetchHistory(currentUser);
    return {
      ok: true,
      deleted: Number(data?.affectedRows || 0),
      requested: validIds.length
    };
  } catch (error) {
    console.error('❌ Batch delete history failed:', error);
    alert('历史记录批量删除失败，请检查后端日志。');
    return { ok: false, deleted: 0, requested: validIds.length };
  }
};

const filteredInventory = useMemo(() => displayInventory, [displayInventory]);
  return {
    searchFilters, setSearchFilters,
    sortConfig, setSortConfig,
    handleBlueprintUpload,
    currentPage, setCurrentPage,
    currentSolutionTab, setCurrentSolutionTab,
    currentResultTab, setCurrentResultTab,
    isChatOpen, setIsChatOpen,
    chatInputValue, setChatInputValue,
    designState, setDesignState,
    isProcessingAi, isGeneratingDocs,
    editingItem, setEditingItem,
    previewHistoryItem, setPreviewHistoryItem,
    activeTable, setActiveTable,
    inventory: filteredInventory, displayInventory,deleteItem,
    handleDownload, copyMarkdown, exportPdfFromDomIds, userNameFilter,setUserNameFilter,addUser,updateUser,users,
    // 补全 image_54f2c6.png 缺失的方法
    handleGenerateReports,
    handleSaveEquipment,
    parseInventoryBatch,
    updateInventoryItem,
    deleteInventoryItem,
    deleteInventoryItemsBatch,
    updateHistoryRecord,
    deleteHistoryRecord,
    deleteHistoryRecordsBatch,
    deleteUser,
    login,
    updateProfile,
    userRoleFilter,
    setUserRoleFilter,
    setInventory,
    currentUser,
    history,
    setHistory,
    micTypeOptions,
    planChapterOptions,
    speakerProductTypeOptions,
    speakerFunctionOptions,
    addMic,
    removeMic,
    handleMicChange,
    handleParamChange,
    handleUpdateProjectName, handleSendMessage, startDesign, saveEdit, handleLogout,
    fetchEquipmentDetail,
    analyzeAmplifierMatch,
    getCachedEquipmentDetail,
    ensureInventoryOptions,
    getInventoryOptions,
    replacePlanItem,
    buildItemsSignature,
    isAiBackendRunning, toggleAiBackend, checkAiStatus,
    closeHistoryPreview: () => setPreviewHistoryItem(null)
  };
};