import { useState, useMemo, useEffect } from 'react';
import React from 'react';
import {
  Scenario, Page, SolutionTab, ResultTab, AcousticParams, DesignState,
  EquipmentItem, SolutionResult, User, AuthUser, HistoryRecord, MicConfig,
  TableType, DbInventoryItem, ChatMessage
} from '../types';
import { DEFAULT_PARAMS, MIC_TYPES } from '../constants';
import { v4 as uuidv4 } from 'uuid';

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
const API_BASE = rawApiBase.replace(/\/+$/, "");

// 方案3：永远在线的后台守护服务器（监听4000端口）
const SYSTEM_API_BASE = "http://115.231.236.153:4000";
const AI_CHAT_API_BASE = "http://115.231.236.153:3003";

const TABLE_NAME_MAP: Record<string, TableType> = {
  音箱: TableType.SPEAKER,
  线阵列配套: TableType.LINE_ARRAY,
  定阻功放: TableType.AMPLIFIER,
  功放: TableType.AMPLIFIER,
  周边设备: TableType.PERIPHERAL,
  其他设备: TableType.OTHER
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

const normalizeMicType = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return MIC_TYPES[0];
  const alias = MIC_TYPE_ALIASES[trimmed];
  if (alias) return alias;
  const exact = MIC_TYPES.find(t => t === trimmed);
  if (exact) return exact;
  const fuzzy = MIC_TYPES.find(t => t.includes(trimmed) || trimmed.includes(t));
  return fuzzy || trimmed;
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
          : MIC_TYPES[0];
    const countRaw = item?.count ?? item?.qty ?? item?.quantity ?? 1;
    const countNum = typeof countRaw === 'number' ? countRaw : parseInt(String(countRaw), 10);
    return {
      id: typeof item?.id === 'string' ? item.id : `${Date.now()}-${index}`,
      type: normalizeMicType(String(typeRaw)),
      count: Number.isFinite(countNum) ? Math.max(0, countNum) : 1
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
  mics.forEach(mic => {
    const key = MIC_TYPE_TO_PARAM_KEY[mic.type];
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
const submitDesign = async (acousticIntent: any) => {
  try {
    const intentResponse = await fetch(`${API_BASE}/api/acoustic-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acousticIntent })
    });

    if (!intentResponse.ok) {
      throw new Error(`Intent submission failed: ${intentResponse.status}`);
    }

    const difyResponse = await fetch(`${API_BASE}/api/run-dify-chatflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
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

// ========================================
// 新增：本地 LLM 对话支持及自动参数提取
// ========================================
const useAcousticAssistant = (
  params: AcousticParams, 
  setParams: React.Dispatch<React.SetStateAction<AcousticParams>>,
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>
) => {
  const [isAssistantLoading, setIsAssistantLoading] = useState(false);

  const sendMessageToAssistant = async (text: string, history: ChatMessage[], isBackendRunning: boolean | null) => {
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
          currentParams: params
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
              // 流式更新最后一条消息
              setChatHistory(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], text: fullAiText };
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
        const cleanText = fullAiText.replace(/\[UPDATE_PARAM:[\s\S]*?\]/g, "").trim();
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

  const [currentPage, setCurrentPage] = useState<Page>(Page.SOLUTION);
  const [currentSolutionTab, setCurrentSolutionTab] = useState<SolutionTab>(SolutionTab.DESIGN);
  const [currentResultTab, setCurrentResultTab] = useState<ResultTab>(ResultTab.PLAN);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInputValue, setChatInputValue] = useState("");
  const [isProcessingAi, setIsProcessingAi] = useState(false);
  const [isGeneratingDocs, setIsGeneratingDocs] = useState(false);
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
  const [currentUser, setCurrentUser] = useState<AuthUser>({
    id: 0,
    username: '游客',
    phone: '',
    company: '',
    role: '游客',
    isGuest: true
  });
  const defaultProjectName = `声学项目_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_01`;
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
    }
  );

  const wrappedSendMessageToAssistant = (text: string) => {
    return sendMessageToAssistant(text, designState.chatHistory, isAiBackendRunning);
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
      result = result.filter(item => item.品牌.toLowerCase().includes(searchFilters.品牌.toLowerCase()));
    }
    if (searchFilters.产品名称) {
      result = result.filter(item => item.产品名称.toLowerCase().includes(searchFilters.产品名称.toLowerCase()));
    }
    if (searchFilters.用途 && activeTable === TableType.SPEAKER as TableType) {
      result = result.filter(item => Array.isArray(item.用途) ? item.用途.includes(searchFilters.用途) : item.用途 === searchFilters.用途);
    }
    if (searchFilters.场景) {
      result = result.filter(item => {
        const scene = item.场景 || '';
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

  const getCachedEquipmentDetail = (item: EquipmentItem) => {
    const table = normalizeTableName(item.type);
    if (!table) return null;
    const key = buildEquipmentKey(table, item.model, item.name);
    return equipmentDetailCache[key] || null;
  };

  const fetchEquipmentDetail = async (item: EquipmentItem) => {
    const table = normalizeTableName(item.type);
    if (!table) return null;
    const key = buildEquipmentKey(table, item.model, item.name);
    if (equipmentDetailCache[key]) return equipmentDetailCache[key];

    const params = new URLSearchParams();
    if (item.model) params.set('model', item.model);
    if (item.name) params.set('name', item.name);

    try {
      const response = await fetch(`${API_BASE}/api/inventory/${encodeURIComponent(table)}/detail?${params.toString()}`);
      if (!response.ok) return null;
      const detail = await response.json();
      if (detail) {
        setEquipmentDetailCache(prev => ({ ...prev, [key]: detail }));
        return detail as DbInventoryItem;
      }
    } catch (error) {
      console.error('❌ Failed to fetch equipment detail:', error);
    }
    return null;
  };

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
    if (currentUser.role === '管理员') {
      fetchUsers();
    }
    if (currentPage === Page.MANAGEMENT && currentUser.role !== '管理员') {
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
      const list = normalizeMicListValue(value);
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
      const nextMics = [...(prev.params.mics || []), { id: uuidv4(), type: MIC_TYPES[0], count: 1 }];
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
    await sendMessageToAssistant(msg, designState.chatHistory, isAiBackendRunning);
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
    stageToNearAudience,
    stageToFarAudience,
    stageWidth,
    stageDepth,
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

  const acousticIntent = {
    schema_version: "v1",
    intent_type: "acoustic_design",
    inputSignals: {
      scenario: designState.scenario,
      geometry, // ✅ 动态结构
    },
    processingSignals: {
      mics: (designState.params.mics && designState.params.mics.length)
        ? designState.params.mics
        : buildMicListFromCounts(designState.params),
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
  setIsProcessingAi(true);

  try {
    const apiResult = await submitDesign(acousticIntent);
    const rawText = apiResult?.raw_answer ?? apiResult?.answer ?? apiResult?.data?.answer ?? '';

    // 🔑 解析结构化方案
    const parsedResults = parseDifyResponseToResults(rawText);

    setDesignState((prev) => ({
      ...prev,
      isDesigned: true,
      results: parsedResults,
      activeResultIndex: 0,
      chatHistory: [
        ...prev.chatHistory,
        {
          role: 'ai',
          text: rawText || '❌ 方案生成失败，请检查后端日志。',
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
      results: parsedResults.map((res) => ({
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
const handleGenerateReports = (scope: 'CURRENT' | 'ALL') => {
  setIsGeneratingDocs(true);
  setTimeout(() => {
    setDesignState(prev => {
      const newResults = [...prev.results];
      if (scope === 'CURRENT') {
        const current = newResults[prev.activeResultIndex];
        if (current) {
          current.lastReportSignature = buildItemsSignature(current.items);
        }
      } else {
        newResults.forEach(r => {
          r.lastReportSignature = buildItemsSignature(r.items);
        });
      }
      return { ...prev, results: newResults };
    });
    setIsGeneratingDocs(false);
    alert(scope === 'CURRENT' ? "当前方案报告已生成" : "所有方案报告已生成");
  }, 800);
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
// --- 4. 实现 handleDownload (文件下载逻辑) ---
const handleDownload = (type: 'EXCEL' | 'WORD' | 'PNG', scope: 'CURRENT' | 'ALL' = 'CURRENT') => {
  if (type === 'PNG') {
    const fileName = designState.projectName || "声学方案";
    alert(`系统正在准备 ${fileName} 的 ${type} 文件，请稍后...`);
    return;
  }

  const results = scope === 'CURRENT'
    ? [designState.results[designState.activeResultIndex]].filter(Boolean)
    : designState.results;

  const missing: string[] = [];
  results.forEach(res => {
    const link = type === 'WORD' ? res.wordLink : res.excelLink;
    if (link) {
      window.open(link, '_blank');
    } else {
      missing.push(res.title);
    }
  });

  if (missing.length) {
    alert(`${type === 'WORD' ? 'Word' : 'Excel'} 链接缺失：${missing.join('，')}`);
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
  } catch (error) {
    console.error("❌ Create inventory failed:", error);
    alert("设备录入失败，请检查后端日志。");
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
  } catch (error) {
    console.error("❌ Update inventory failed:", error);
    alert("设备更新失败，请检查后端日志。");
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
  } catch (error) {
    console.error("❌ Delete inventory failed:", error);
    alert("设备删除失败，请检查后端日志。");
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
    handleDownload,userNameFilter,setUserNameFilter,addUser,updateUser,users,
    // 补全 image_54f2c6.png 缺失的方法
    handleGenerateReports,
    handleSaveEquipment,
    updateInventoryItem,
    deleteInventoryItem,
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