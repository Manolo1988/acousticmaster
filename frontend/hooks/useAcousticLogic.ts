import { useState, useMemo, useEffect, useRef } from 'react';
import React from 'react';
import {
  Scenario, Page, SolutionTab, ResultTab, AcousticParams, DesignState,
  EquipmentItem, SolutionResult, User, AuthUser, HistoryRecord, MicConfig,
  TableType, DbInventoryItem, ChatMessage
} from '../types';
import { DEFAULT_PARAMS, MIC_TYPES } from '../constants';
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
const fallbackApiBase = import.meta.env.DEV ? "http://115.231.236.153:3002" : "";
const API_BASE = (rawApiBase || fallbackApiBase).replace(/\/+$/, "");
const resolveBackendLink = (link: string) => {
  if (!link) return '';
  if (/^https?:\/\//i.test(link)) return link;
  if (link.startsWith('/')) return `${API_BASE}${link}`;
  return `${API_BASE}/${link.replace(/^\/+/, '')}`;
};

const buildReportPrintDomId = (resultId: string) => `report-print-${resultId}`;

type ReportChapterConfig = { key: string; title: string };

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

console.log(`🔗 Using API base: ${API_BASE}`);

const SYSTEM_API_BASE = API_BASE;
const AI_CHAT_API_BASE = API_BASE;

const TABLE_NAME_MAP: Record<string, TableType> = {
  固定搭配: TableType.FIXED_COMBINATION,
  音箱: TableType.SPEAKER,
  线阵列配套: TableType.SPEAKER,
  定阻功放: TableType.AMPLIFIER,
  功放: TableType.AMPLIFIER,
  周边设备: TableType.PERIPHERAL,
  固定搭配场景剩余周边设备: TableType.FIXED_SCENE_EXTRA,
  非固定搭配场景剩余周边设备: TableType.NON_FIXED_SCENE_EXTRA,
  其他设备: TableType.FIXED_SCENE_EXTRA,
  中控系统: TableType.FIXED_SCENE_EXTRA,
  矩阵: TableType.FIXED_SCENE_EXTRA,
  视频会议系统: TableType.FIXED_SCENE_EXTRA,
  录播系统: TableType.FIXED_SCENE_EXTRA,
  图片资源管理: TableType.LOCAL_STATIC_RESOURCE,
  本地静态资源: TableType.LOCAL_STATIC_RESOURCE
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
  micHandheld: 'micHandheld',
  micGooseneck: 'micGooseneck',
  micOmni: 'micOmni',
  micLavalier: 'micLavalier',
  micCeiling: 'micCeiling',
  mics: 'mics',
  microphones: 'mics',
  micList: 'mics',
  话筒: 'mics',
  话筒配置: 'mics',
  手持无线话筒: 'micHandheld',
  鹅颈会议话筒: 'micGooseneck',
  全向阵列话筒: 'micOmni',
  领夹话筒: 'micLavalier',
  吊装话筒: 'micCeiling',
  手持话筒: 'micHandheld',
  鹅颈话筒: 'micGooseneck',
  全向话筒: 'micOmni',
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
  录播: 'hasRecording'
};

const MIC_TYPE_ALIASES: Record<string, string> = {
  手持无线: '手持无线话筒',
  手持: '手持无线话筒',
  鹅颈: '鹅颈会议话筒',
  全向阵列: '全向阵列话筒',
  全向: '全向阵列话筒',
  领夹: '领夹话筒',
  吊装: '吊装话筒'
};

const MIC_KEYWORD_TO_PARAM_KEY: Array<{ keywords: string[]; key: keyof AcousticParams }> = [
  { keywords: ['手持', '无线手持', 'ku102', '手领'], key: 'micHandheld' },
  { keywords: ['鹅颈', '会议鹅颈', 'ku204'], key: 'micGooseneck' },
  { keywords: ['全向', '阵列', '全向阵列'], key: 'micOmni' },
  { keywords: ['领夹'], key: 'micLavalier' },
  { keywords: ['吊装', '吊麦', '吊顶'], key: 'micCeiling' }
];

const MIC_TYPE_TO_PARAM_KEY: Record<string, keyof AcousticParams> = {
  手持无线话筒: 'micHandheld',
  鹅颈会议话筒: 'micGooseneck',
  全向阵列话筒: 'micOmni',
  领夹话筒: 'micLavalier',
  吊装话筒: 'micCeiling'
};

const MIC_PARAM_TO_TYPE: Record<string, string> = {
  micHandheld: '手持无线话筒',
  micGooseneck: '鹅颈会议话筒',
  micOmni: '全向阵列话筒',
  micLavalier: '领夹话筒',
  micCeiling: '吊装话筒'
};

const normalizeMicTypeForCount = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return MIC_TYPES[0];
  const alias = MIC_TYPE_ALIASES[trimmed];
  if (alias) return alias;
  const exact = MIC_TYPES.find(t => t === trimmed);
  if (exact) return exact;
  const fuzzy = MIC_TYPES.find(t => t.includes(trimmed) || trimmed.includes(t));
  return fuzzy || trimmed;
};

const normalizeMicDisplayType = (raw: string) => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return trimmed;
};

const resolveMicParamKey = (micType: string): keyof AcousticParams | null => {
  const normalized = normalizeMicTypeForCount(micType);
  const directKey = MIC_TYPE_TO_PARAM_KEY[normalized];
  if (directKey) return directKey;

  const sample = String(micType || '').toLowerCase();
  const matched = MIC_KEYWORD_TO_PARAM_KEY.find(({ keywords }) =>
    keywords.some((keyword) => sample.includes(keyword.toLowerCase()))
  );
  return matched ? matched.key : null;
};

const normalizeMicListValue = (value: any): MicConfig[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const typeRaw = typeof item?.type === 'string'
      ? item.type
      : typeof item?.name === 'string'
        ? item.name
        : typeof item?.label === 'string'
          ? item.label
          : '';
    const countRaw = item?.count ?? item?.qty ?? item?.quantity ?? 1;
    const countNum = typeof countRaw === 'number' ? countRaw : parseInt(String(countRaw), 10);
    return {
      id: typeof item?.id === 'string' ? item.id : `${Date.now()}-${index}`,
      type: normalizeMicDisplayType(String(typeRaw)),
      count: Number.isFinite(countNum) ? Math.max(0, countNum) : 1
    };
  });
};

const normalizeMicsToDbOptions = (mics: MicConfig[], options: string[]): MicConfig[] => {
  const normalizedOptions = Array.from(new Set((options || []).map((item) => String(item || '').trim()).filter(Boolean)));
  if (normalizedOptions.length === 0) {
    return (mics || []).map((mic) => ({ ...mic, type: '' }));
  }

  const optionSet = new Set(normalizedOptions);
  const fallback = normalizedOptions[0];
  return (mics || []).map((mic) => {
    const type = String(mic?.type || '').trim();
    if (optionSet.has(type)) {
      return {
        ...mic,
        type
      };
    }
    return {
      ...mic,
      type: fallback
    };
  });
};

const buildMicCounts = (mics: MicConfig[]) => {
  const base = {
    micHandheld: 0,
    micGooseneck: 0,
    micOmni: 0,
    micLavalier: 0,
    micCeiling: 0
  };
  type MicCountKey = keyof typeof base;
  mics.forEach(mic => {
    const key = resolveMicParamKey(mic.type) as MicCountKey | null;
    if (key) {
      base[key] += Number.isFinite(mic.count) ? mic.count : 0;
    }
  });
  return base;
};

const buildMicListFromCounts = (params: AcousticParams): MicConfig[] => {
  const list: MicConfig[] = [];
  Object.entries(MIC_PARAM_TO_TYPE).forEach(([paramKey, type]) => {
    const count = (params as any)[paramKey];
    if (typeof count === 'number' && count > 0) {
      list.push({ id: `${paramKey}-${list.length}`, type, count });
    }
  });
  return list;
};

const normalizeAssistantParams = (raw: Record<string, any> | Record<string, any>[]): Partial<AcousticParams> => {
  const normalized: Partial<AcousticParams> = {};
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
      const mappedKey = PARAM_KEY_ALIASES[key] || (key as keyof AcousticParams);
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
    const list: MicConfig[] = [];
    Object.entries(MIC_PARAM_TO_TYPE).forEach(([paramKey, type]) => {
      const count = (normalized as any)[paramKey];
      if (typeof count === 'number' && count > 0) {
        list.push({ id: `${Date.now()}-${list.length}`, type, count });
      }
    });
    if (list.length) {
      (normalized as any).mics = list;
    }
  }

  return normalized;
};

const extractAssistantParamPayloads = (text: string): (Record<string, any> | Record<string, any>[])[] => {
  // 更加宽容的正则，不强制要求外层有方括号/花括号，只要被 [UPDATE_PARAM: ...] 包裹
  const markerRegex = /\[UPDATE_PARAM:\s*([\s\S]*?)\]/g;
  const matches = [...text.matchAll(markerRegex)];
  
  return matches.map(match => {
    let rawContent = match[1]?.trim();
    if (!rawContent) return null;

    // 1. 尝试清理 Markdown 代码块
    let cleaned = rawContent
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    // 2. 尝试直接解析
    try {
      return JSON.parse(cleaned);
    } catch {
      // 3. 兜底处理：如果 AI 输出了 {"key": "length", "value": 7}, {"key": "width", "value": 4} 这种非标准数组
      // 将其包裹成数组再尝试
      if (cleaned.includes('},{') || (cleaned.includes('"value":') && !cleaned.startsWith('[') && !cleaned.startsWith('{'))) {
        try {
          return JSON.parse(`[${cleaned}]`);
        } catch { /* ignore */ }
      }

      // 4. 再次兜底：处理单引号
      try {
        const singleQuoted = cleaned.replace(/'/g, '"');
        return JSON.parse(singleQuoted);
      } catch (e) {
        console.warn("Failed to parse [UPDATE_PARAM] block:", cleaned, e);
        return null;
      }
    }
  }).flat().filter((p): p is any => p !== null && typeof p === 'object');
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
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/<\/?thinking>/gi, '')
    .replace(/思考过程[:：]?[\s\S]*$/g, '')
    .trim();
};

const detectScenarioFromAssistant = (
  text: string,
  payloads: (Record<string, any> | Record<string, any>[])[]
) => {
  for (const payload of payloads) {
    const list = Array.isArray(payload) ? payload : [payload];
    for (const entry of list) {
      const key = String((entry as any).key || '').toLowerCase();
      const value = String((entry as any).value || (entry as any).scenario || '').toUpperCase();
      if (key === 'scenario' || Object.prototype.hasOwnProperty.call(entry, 'scenario')) {
        if (value.includes('LECTURE_HALL') || value.includes('REPORT') || value.includes('报告厅')) {
          return Scenario.LECTURE_HALL;
        }
        if (value.includes('MEETING_ROOM') || value.includes('MEETING') || value.includes('会议室')) {
          return Scenario.MEETING_ROOM;
        }
      }
    }
  }

  const normalized = stripThinkTags(text);
  if (/确定|确认为|判断为|建议采用/.test(normalized)) {
    if (/报告厅/.test(normalized)) return Scenario.LECTURE_HALL;
    if (/会议室/.test(normalized)) return Scenario.MEETING_ROOM;
  }
  return null;
};

// ========================================
// 新增：本地 LLM 对话支持及自动参数提取
// ========================================
const useAcousticAssistant = (
  params: AcousticParams, 
  setParams: React.Dispatch<React.SetStateAction<AcousticParams>>,
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  onScenarioConfirmed: (scenario: Scenario) => void,
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
    const aiId = Date.now().toString();
    setChatHistory(prev => [...prev, { role: 'ai', text: "", timestamp: new Date() }]);

    let fullAiText = "";
    try {
      const response = await fetch(`${AI_CHAT_API_BASE}/api/chat-assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: history.map(h => ({ role: h.role === 'ai' ? 'assistant' : 'user', content: h.text })),
          currentParams: {
            ...params,
            scenario: assistantScenario || undefined,
            micTypeOptions: assistantContext?.micTypeOptions || []
          }
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
              const safeText = stripThinkTags(fullAiText);
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
      const extractedPayloads = extractAssistantParamPayloads(fullAiText);
      const scenarioByAssistant = detectScenarioFromAssistant(fullAiText, extractedPayloads as any);
      if (scenarioByAssistant) {
        onScenarioConfirmed(scenarioByAssistant);
      }
      if (extractedPayloads.length > 0) {
        // 合并所有提取到的参数
        const combinedNormalized = extractedPayloads.reduce((acc, payload) => {
          const normalized = normalizeAssistantParams(payload);
          return { ...acc, ...normalized };
        }, {});

        if (Object.keys(combinedNormalized).length > 0) {
          setParams(prev => ({ ...prev, ...combinedNormalized }));
        }

        // 静默移除标记，保持 UI 干净
        const cleanText = stripThinkTags(
          fullAiText.replace(/\[UPDATE_PARAM:[\s\S]*?\]/g, "")
        );
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

const parseTableLines = (tableText: string): EquipmentItem[] => {
  const items: EquipmentItem[] = [];
  const lines = tableText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.includes('|:-:') && line.includes('|'));

  for (const line of lines) {
    const cols = line
      .split('|')
      .map(col => col.trim())
      .filter(col => col !== '');

    if (cols.length >= 4) {
      const [type, name, model, qtyStr] = cols;
      // 跳过表头行
      if (['类型', '产品名称', '型号', '数量'].includes(type)) continue;

      const quantity = parseInt(qtyStr, 10) || 1;
      items.push({
        id: `${Math.random().toString(36).slice(2)}-${items.length}`,
        type,
        name,
        model,
        quantity
      });
    }
  }
  return items;
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

  // 按 <font size=5> 分割方案（支持任意数量）
  const blocks = content.split(/<font[^>]*size\s*=\s*["']?5["']?[^>]*>/)
    .map(b => b.replace(/<\/font>/gi, '').trim())
    .filter(b => b);

  const results: SolutionResult[] = [];
  for (const block of blocks) {
    const firstLineEnd = block.search(/[\n|]/);
    const title = firstLineEnd > 0 
      ? block.substring(0, firstLineEnd).trim()
      : `方案${results.length + 1}`;
    
    const tablePart = firstLineEnd > 0 
      ? block.substring(firstLineEnd).trim()
      : block;

    const items = parseTableLines(tablePart);
    if (items.length > 0) {
      results.push({
        id: `res-${Date.now()}-${results.length}`,
        title,
        items,
        wordLink: '',
        excelLink: ''
      });
    }
  }

  if (results.length === 0) {
    const tableBlocks = extractTableBlocks(content);
    tableBlocks.forEach(block => {
      const items = parseTableLines(block.tableText);
      if (items.length === 0) return;
      results.push({
        id: `res-${Date.now()}-${results.length}`,
        title: block.title,
        items,
        wordLink: '',
        excelLink: ''
      });
    });
  }

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
  const [searchFilters, setSearchFilters] = useState({ 品牌: '', 产品名称: '', 用途: '', 场景: '' });
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  // --- 资源管理状态 (对应 MySQL 数据库) ---
  const [activeTable, setActiveTable] = useState<TableType>(TableType.SPEAKER as TableType);
  const [inventory, setInventory] = useState<DbInventoryItem[]>([]);
  const [equipmentDetailCache, setEquipmentDetailCache] = useState<Record<string, DbInventoryItem>>({});
  const [inventoryOptionsByTable, setInventoryOptionsByTable] = useState<Record<string, DbInventoryItem[]>>({});
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
    (scenario: Scenario) => {
      setAssistantScenario(scenario);
      setDesignState(prev => ({ ...prev, scenario }));
    },
    assistantScenario
  );

  const wrappedSendMessageToAssistant = (text: string) => {
    return sendMessageToAssistant(text, designState.chatHistory, isAiBackendRunning, {
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
      result = result.filter(item => String(item.品牌 || '').toLowerCase().includes(searchFilters.品牌.toLowerCase()));
    }
    if (searchFilters.产品名称) {
      const keyword = searchFilters.产品名称.toLowerCase();
      result = result.filter(item => {
        const name = String(item.产品名称 || item.图片名称 || '').toLowerCase();
        return name.includes(keyword);
      });
    }
    if (searchFilters.用途 && activeTable === TableType.SPEAKER as TableType) {
      result = result.filter(item => Array.isArray(item.用途) ? item.用途.includes(searchFilters.用途) : item.用途 === searchFilters.用途);
    }
    if (searchFilters.场景) {
      result = result.filter(item => {
        const scene = item.场景 || item.使用场景 || '';
        const usage = Array.isArray(item.用途) ? item.用途.join(',') : (item.用途 || '');
        return scene.includes(searchFilters.场景) || usage.includes(searchFilters.场景);
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

  const resolveDetailTableCandidates = (type: string): TableType[] => {
    if (!type) return [TableType.PERIPHERAL];
    if (type === TableType.SPEAKER) return [TableType.SPEAKER];
    if (type === TableType.AMPLIFIER || type === '功放') return [TableType.AMPLIFIER];
    if (type === TableType.PERIPHERAL) return [TableType.PERIPHERAL];
    if (type === TableType.FIXED_SCENE_EXTRA) return [TableType.FIXED_SCENE_EXTRA, TableType.NON_FIXED_SCENE_EXTRA];
    if (type === TableType.NON_FIXED_SCENE_EXTRA) return [TableType.NON_FIXED_SCENE_EXTRA, TableType.FIXED_SCENE_EXTRA];
    if (SUBSYSTEM_DEVICE_TYPES.has(type)) {
      return [TableType.FIXED_SCENE_EXTRA, TableType.NON_FIXED_SCENE_EXTRA];
    }
    if (type.includes('定阻功放') || type.includes('功放')) {
      return [TableType.AMPLIFIER];
    }
    if (type.includes('音箱')) {
      return [TableType.SPEAKER];
    }
    return [TableType.PERIPHERAL];
  };

  const getCachedEquipmentDetail = (item: EquipmentItem) => {
    const tables = resolveDetailTableCandidates(item.type);
    for (const table of tables) {
      const key = buildEquipmentKey(table, item.model, item.name);
      if (equipmentDetailCache[key]) return equipmentDetailCache[key];
    }
    return null;
  };

  const fetchEquipmentDetail = async (item: EquipmentItem) => {
    const tables = resolveDetailTableCandidates(item.type);
    for (const table of tables) {
      const key = buildEquipmentKey(table, item.model, item.name);
      if (equipmentDetailCache[key]) return equipmentDetailCache[key];

      const params = new URLSearchParams();
      if (item.model) {
        params.set('model', item.model);
      } else if (item.name) {
        params.set('name', item.name);
      } else {
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

  const fetchMicTypeOptions = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(TableType.PERIPHERAL)}`);
      if (!response.ok) throw new Error(`Fetch mic types failed: ${response.status}`);
      const data = await response.json();
      const rows: DbInventoryItem[] = Array.isArray(data) ? data : [];
      const options = Array.from(new Set(
        rows
          .filter((row) => row.类型 === '话筒' || String(row.产品名称 || '').includes('话筒'))
          .map((row) => String(row.产品名称 || '').trim())
          .filter(Boolean)
      ));
      if (options.length > 0) {
        setMicTypeOptions(options);
      } else {
        setMicTypeOptions([]);
      }
    } catch (error) {
      console.error('❌ Failed to fetch mic types:', error);
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
      if (currentMics.length === 0) return prev;

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
    if (inventoryOptionsByTable[table]?.length) return;
    try {
      const response = await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(table)}`);
      if (!response.ok) throw new Error(`Fetch inventory options failed: ${response.status}`);
      const data = await response.json();
      setInventoryOptionsByTable(prev => ({ ...prev, [table]: Array.isArray(data) ? data : [] }));
    } catch (error) {
      console.error('❌ Failed to fetch inventory options:', error);
      setInventoryOptionsByTable(prev => ({ ...prev, [table]: [] }));
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
        unitPrice: Number(detail.市场价) || currentItem.unitPrice || 0
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

  // --- 方案参数处理 ---
  const handleParamChange = (key: keyof AcousticParams | 'scenario', value: any) => {
    if (key === 'scenario') {
      setDesignState(prev => ({ ...prev, scenario: value }));
      return;
    }
    if (key === 'mics') {
      const list = normalizeMicsToDbOptions(normalizeMicListValue(value), micTypeOptions);
      setDesignState(prev => ({
        ...prev,
        params: {
          ...prev.params,
          mics: list,
          ...buildMicCounts(list)
        }
      }));
      return;
    }
    setDesignState(prev => ({ ...prev, params: { ...prev.params, [key]: value } }));
  };

  const addMic = () => {
    setDesignState(prev => {
      const defaultMicType = micTypeOptions[0] || '';
      if (!defaultMicType) return prev;
      const nextMics = [...(prev.params.mics || []), { id: uuidv4(), type: defaultMicType, count: 1 }];
      return {
        ...prev,
        params: {
          ...prev.params,
          mics: nextMics,
          ...buildMicCounts(nextMics)
        }
      };
    });
  };

  const removeMic = (id: string) => {
    setDesignState(prev => {
      const nextMics = (prev.params.mics || []).filter(mic => mic.id !== id);
      return {
        ...prev,
        params: {
          ...prev.params,
          mics: nextMics,
          ...buildMicCounts(nextMics)
        }
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
        params: {
          ...prev.params,
          mics: nextMics,
          ...buildMicCounts(nextMics)
        }
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
            if (!detail) return item;
            return {
              ...item,
              name: detail.产品名称 || item.name,
              model: detail.型号 || item.model,
              brand: detail.品牌 || item.brand,
              unitPrice: Number(detail.市场价) || item.unitPrice || 0
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


  const saveEdit = () => {
    if (!editingItem) return;
    const newResults = [...designState.results];
    newResults[editingItem.resIdx].items[editingItem.itemIdx] = editingItem.item;
    setDesignState(prev => ({ ...prev, results: newResults }));
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
    updateInventoryItem,
    deleteInventoryItem,
    deleteInventoryItemsBatch,
    updateHistoryRecord,
    deleteHistoryRecord,
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
    addMic,
    removeMic,
    handleMicChange,
    handleParamChange,
    handleUpdateProjectName, handleSendMessage, startDesign, saveEdit, handleLogout,
    fetchEquipmentDetail,
    getCachedEquipmentDetail,
    ensureInventoryOptions,
    getInventoryOptions,
    replacePlanItem,
    buildItemsSignature,
    isAiBackendRunning, toggleAiBackend, checkAiStatus,
    closeHistoryPreview: () => setPreviewHistoryItem(null)
  };
};