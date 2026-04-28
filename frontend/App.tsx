
import React, { useRef, useEffect, useState, useMemo, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Scenario, Page, SolutionTab, ResultTab, User, TableType, DbInventoryItem, HistoryRecord, EquipmentItem, AcousticParams, SolutionResult } from './types';
import { SCENARIO_THEMES, VERIFY_THEME } from './constants';
import Visualization from './components/Visualization';
import { useAcousticLogic } from './hooks/useAcousticLogic';
import * as XLSX from 'xlsx';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'lottie-player': any;
    }
  }
}

type ResultView = 'TABLE' | 'WORD';

type LinkedPlanUpdate = {
  resIdx: number;
  itemIdx: number;
  itemPatch: Partial<EquipmentItem>;
};

type AmplifierRecommendationPrompt = {
  message: string;
  recommendation: {
    name: string;
    model: string;
    brand?: string;
    unitPrice?: number;
    requiredQuantity: number;
    mode?: string;
  };
  applyUpdates: LinkedPlanUpdate[];
  rejectUpdates: LinkedPlanUpdate[];
};

const markdownReportStyles = `
.markdown-report {
  color: #0f172a;
  font-size: 15px;
  line-height: 1.9;
  font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif;
  word-break: break-word;
}

.markdown-report h1,
.markdown-report h2,
.markdown-report h3,
.markdown-report h4,
.markdown-report h5,
.markdown-report h6 {
  color: #0b2545;
  font-family: "Noto Sans SC", "Source Han Sans SC", "PingFang SC", sans-serif;
  letter-spacing: 0.01em;
  line-height: 1.55;
}

.markdown-report h1 { font-size: 30px; margin: 0 0 18px; }
.markdown-report h2 {
  font-size: 24px;
  margin: 28px 0 14px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 6px;
}
.markdown-report h3 { font-size: 20px; margin: 24px 0 10px; }
.markdown-report h4 { font-size: 18px; margin: 20px 0 8px; }

.markdown-report .toc-heading {
  text-align: center;
}

.markdown-report .toc-heading + ul,
.markdown-report .toc-heading + ol {
  margin-left: 0;
  padding-left: 0;
  list-style-position: inside;
}

.markdown-report p {
  margin: 10px 0;
  color: #1e293b;
  text-indent: 2em;
}

.markdown-report ul,
.markdown-report ol {
  margin: 10px 0 10px 24px;
}

.markdown-report li {
  margin: 6px 0;
}

.markdown-report blockquote {
  border-left: 4px solid #0ea5e9;
  background: #f0f9ff;
  color: #0c4a6e;
  margin: 14px 0;
  padding: 10px 14px;
  border-radius: 8px;
}

.markdown-report table {
  width: 100%;
  border-collapse: collapse;
  margin: 14px 0;
  font-size: 14px;
}

.markdown-report th,
.markdown-report td {
  border: 1px solid #dbe4ef;
  padding: 8px 10px;
  vertical-align: top;
}

.markdown-report th {
  background: #f8fafc;
  font-weight: 700;
}

.markdown-report code {
  background: #f1f5f9;
  color: #0f172a;
  padding: 2px 6px;
  border-radius: 5px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 13px;
}

.markdown-report pre {
  background: #0f172a;
  color: #e2e8f0;
  padding: 14px;
  border-radius: 10px;
  overflow: auto;
  margin: 14px 0;
}

.markdown-report pre code {
  background: transparent;
  color: inherit;
  padding: 0;
}

.markdown-report img {
  display: block;
  max-width: min(100%, 820px);
  width: auto;
  height: auto;
  border-radius: 10px;
  margin: 14px auto;
}

.markdown-report hr {
  border: 0;
  border-top: 1px dashed #cbd5e1;
  margin: 20px 0;
}

.markdown-report a {
  color: #0369a1;
  text-decoration: none;
}

.markdown-report .toc-heading + ul a,
.markdown-report .toc-heading + ol a {
  text-decoration: none;
}

.markdown-report .katex {
  font-size: 1.02em;
}

.markdown-report .katex-display {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 6px 2px;
  text-align: center;
}

.glass-btn {
  color: rgba(var(--glass-text-rgb, 30, 64, 175), 0.9);
  border: 1px solid rgba(var(--glass-border-rgb, 96, 165, 250), 0.34);
  background: linear-gradient(
    140deg,
    rgba(var(--glass-rgb, 37, 99, 235), 0.11),
    rgba(var(--glass-rgb-2, 14, 165, 233), 0.08),
    rgba(255, 255, 255, 0.2)
  );
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  backdrop-filter: blur(20px) saturate(150%);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
}

.glass-btn:hover {
  color: rgba(var(--glass-text-rgb, 30, 64, 175), 0.98);
  border-color: rgba(var(--glass-border-rgb, 96, 165, 250), 0.5);
  background: linear-gradient(
    140deg,
    rgba(var(--glass-rgb, 37, 99, 235), 0.17),
    rgba(var(--glass-rgb-2, 14, 165, 233), 0.12),
    rgba(255, 255, 255, 0.28)
  );
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.14);
}

.glass-btn-primary {
  color: rgba(var(--glass-primary-text-rgb, 15, 23, 42), 0.95);
  border-color: rgba(var(--glass-border-rgb, 96, 165, 250), 0.5);
  background: linear-gradient(
    140deg,
    rgba(var(--glass-rgb, 37, 99, 235), 0.19),
    rgba(var(--glass-rgb-2, 14, 165, 233), 0.14),
    rgba(255, 255, 255, 0.26)
  );
  box-shadow: 0 12px 30px rgba(var(--glass-rgb, 37, 99, 235), 0.2);
}

.glass-btn-primary:hover {
  border-color: rgba(var(--glass-border-rgb, 96, 165, 250), 0.64);
  background: linear-gradient(
    140deg,
    rgba(var(--glass-rgb, 37, 99, 235), 0.25),
    rgba(var(--glass-rgb-2, 14, 165, 233), 0.2),
    rgba(255, 255, 255, 0.32)
  );
  box-shadow: 0 18px 38px rgba(var(--glass-rgb, 37, 99, 235), 0.28);
}

.glass-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.report-chapter-loading-card {
  border: 1px solid #dbe4ef;
  border-radius: 14px;
  padding: 16px 18px;
  background: linear-gradient(135deg, rgba(248, 250, 252, 0.96), rgba(241, 245, 249, 0.72));
}

.report-chapter-title {
  margin: 0 0 10px;
  color: #0b2545;
  font-size: 20px;
  font-family: "Noto Sans SC", "Source Han Sans SC", "PingFang SC", sans-serif;
  font-weight: 800;
}

.report-chapter-loading-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #0f766e;
  margin-bottom: 10px;
}

.report-chapter-spinner {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid #99f6e4;
  border-top-color: #14b8a6;
  animation: report-spin 1s linear infinite;
}

.report-chapter-loading-text {
  font-size: 13px;
  font-weight: 700;
}

.report-chapter-skeleton {
  height: 9px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(148, 163, 184, 0.18) 25%, rgba(148, 163, 184, 0.38) 50%, rgba(148, 163, 184, 0.18) 75%);
  background-size: 240px 100%;
  margin-bottom: 8px;
  animation: report-skeleton 1.35s ease-in-out infinite;
}

.report-chapter-error {
  font-size: 13px;
  font-weight: 700;
  color: #dc2626;
}

@keyframes report-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes report-skeleton {
  0% { background-position: -240px 0; }
  100% { background-position: 240px 0; }
}

@media (max-width: 768px) {
  .markdown-report {
    font-size: 14px;
    line-height: 1.8;
  }

  .markdown-report h1 { font-size: 24px; }
  .markdown-report h2 { font-size: 20px; }
  .markdown-report h3 { font-size: 18px; }
}

@page {
  size: A4;
  margin: 20mm;
}

@media print {
  html,
  body {
    background: #fff !important;
  }

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
  .markdown-report ul,
  .markdown-report ol,
  .markdown-report li,
  .markdown-report table,
  .markdown-report thead,
  .markdown-report tbody,
  .markdown-report tr,
  .markdown-report th,
  .markdown-report td,
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

  .pdf-print-section {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .pdf-print-section + .pdf-print-section {
    break-before: page;
    page-break-before: always;
  }
}
`;

type FieldType = 'text' | 'number' | 'select' | 'textarea' | 'file' | 'multiselect';
type FieldConfig = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  defaultValue?: string | number;
  accept?: string;
};

type TableColumnPreference = {
  order: string[];
  visible: string[];
};

type ParsedBatchItem = {
  id: number;
  payload: Partial<DbInventoryItem>;
  errors: string[];
  complete: boolean;
  expanded: boolean;
};

const SPEAKER_TYPES = ['全频音箱', '线阵列音箱', '台唇音箱', '拉声像音箱', '返听音箱', '超低音箱'];
const SPEAKER_FUNCTIONS = ['主扩声', '返听', '辅助扩声', '次低频补偿', '吊装', '壁挂', '吸顶', '舞台监听'];
const PERIPHERAL_TYPES = ['调音台', '电源时序器', '音频处理器', '话筒', '天线放大系统'];
const EXTRA_DEVICE_TYPES = ['中控系统', '矩阵', '视频会议系统', '录播系统'];
const REPORT_CHAPTER_OPTIONS = ['项目概述', '设计依据和目标', '方案设计', '设备介绍', '装修建议', '环境要求'];
const MANAGEMENT_TABLES: TableType[] = [
  TableType.SPEAKER,
  TableType.LINE_ARRAY_SUPPORT,
  TableType.AMPLIFIER,
  TableType.PERIPHERAL,
  TableType.SUBSYSTEM,
  TableType.LOCAL_STATIC_RESOURCE
];

const ENTRY_TARGET_TABLES: TableType[] = [
  TableType.SPEAKER,
  TableType.AMPLIFIER,
  TableType.PERIPHERAL,
  TableType.SUBSYSTEM,
  TableType.LOCAL_STATIC_RESOURCE
];

const TABLE_FIELD_CONFIG: Record<TableType, FieldConfig[]> = {
  [TableType.SPEAKER]: [
    { key: '产品类型', label: '产品类型', type: 'select', options: SPEAKER_TYPES, required: true },
    { key: '功能', label: '功能', type: 'multiselect', options: SPEAKER_FUNCTIONS, required: true },
    { key: '品牌', label: '品牌', type: 'text', required: true },
    { key: '产品名称', label: '产品名称', type: 'text', required: true },
    { key: '型号', label: '型号', type: 'text', required: true },
    { key: '市场价', label: '市场价', type: 'number', required: true, defaultValue: 100 },
    { key: '额定阻抗', label: '额定阻抗', type: 'text', required: true, placeholder: '如 8Ω' },
    { key: '额定功率', label: '额定功率', type: 'text', required: true, placeholder: '如 200W' },
    { key: '灵敏度', label: '灵敏度', type: 'text', required: true, placeholder: '如 93dB' },
    { key: '最大声压级', label: '最大声压级', type: 'text', required: true, placeholder: '如 120dB' },
    { key: '水平覆盖角', label: '水平覆盖角', type: 'number', required: true, placeholder: '单位°，如 90' },
    { key: '垂直覆盖角', label: '垂直覆盖角', type: 'number', required: true, placeholder: '单位°，如 60' },
    { key: '面高', label: '面高', type: 'number', required: true, placeholder: '单位米，如 0.4' },
    { key: '设备图片', label: '设备图片', type: 'file', accept: 'image/*' }
  ],
  [TableType.LINE_ARRAY_SUPPORT]: [
    { key: '类型', label: '类型', type: 'text', required: true, placeholder: '如 次低音音箱/线阵列音箱吊挂架' },
    { key: '品牌', label: '品牌', type: 'text' },
    { key: '产品名称', label: '产品名称', type: 'text', required: true },
    { key: '型号', label: '型号', type: 'text', required: true },
    { key: '市场价', label: '市场价', type: 'number', required: true, defaultValue: 100 },
    { key: '额定阻抗', label: '额定阻抗', type: 'text', placeholder: '如 8Ω' },
    { key: '额定功率', label: '额定功率', type: 'text', placeholder: '如 200W' },
    { key: '灵敏度', label: '灵敏度', type: 'text', placeholder: '如 93dB' },
    { key: '最大声压级', label: '最大声压级', type: 'text', placeholder: '如 120dB' },
    { key: '水平覆盖角', label: '水平覆盖角', type: 'number', placeholder: '单位°，如 90' },
    { key: '垂直覆盖角', label: '垂直覆盖角', type: 'number', placeholder: '单位°，如 60' },
    { key: '面高', label: '面高', type: 'number', placeholder: '单位米，如 0.4' },
    { key: '用途', label: '用途', type: 'text', required: true, placeholder: '如 次低音箱 / 挂架' },
    { key: 'main_id', label: '主音箱ID', type: 'number', placeholder: '关联主线阵列音箱ID' },
    { key: '设备图片', label: '设备图片', type: 'file', accept: 'image/*' }
  ],
  [TableType.AMPLIFIER]: [
    { key: '类型', label: '类型', type: 'text', required: true, defaultValue: '定阻功放' },
    { key: '品牌', label: '品牌', type: 'text', required: true },
    { key: '产品名称', label: '产品名称', type: 'text', required: true },
    { key: '型号', label: '型号', type: 'text', required: true },
    { key: '市场价', label: '市场价', type: 'number', required: true, defaultValue: 100 },
    { key: '额定功率', label: '额定功率', type: 'text', required: true },
    { key: '额定阻抗', label: '额定阻抗', type: 'text', required: true },
    { key: '通道数', label: '通道数', type: 'text', required: true },
    { key: '设备图片', label: '设备图片', type: 'file', accept: 'image/*' }
  ],
  [TableType.PERIPHERAL]: [
    { key: '类型', label: '类型', type: 'select', options: PERIPHERAL_TYPES, required: true },
    { key: '品牌', label: '品牌', type: 'text', required: true },
    { key: '产品名称', label: '产品名称', type: 'text', required: true },
    { key: '型号', label: '型号', type: 'text', required: true },
    { key: '输入通道', label: '输入通道', type: 'number' },
    { key: '输出通道', label: '输出通道', type: 'number' },
    { key: '市场价', label: '市场价', type: 'number', required: true, defaultValue: 100 },
    { key: '设备图片', label: '设备图片', type: 'file', accept: 'image/*' }
  ],
  [TableType.SUBSYSTEM]: [
    { key: '类型', label: '类型', type: 'select', options: EXTRA_DEVICE_TYPES, required: true },
    { key: '品牌', label: '品牌', type: 'text', required: true },
    { key: '产品名称', label: '产品名称', type: 'text', required: true },
    { key: '型号', label: '型号', type: 'text', required: true },
    { key: '数量', label: '数量', type: 'number', required: true, defaultValue: 1 },
    { key: '市场价', label: '市场价', type: 'number', required: true, defaultValue: 100 },
    { key: '场景', label: '场景', type: 'select', options: ['通用', '会议室', '报告厅'], required: true, defaultValue: '通用' },
    { key: '设备图片', label: '设备图片', type: 'file', accept: 'image/*' }
  ],
  [TableType.LOCAL_STATIC_RESOURCE]: [
    { key: '图片名称', label: '资源名称', type: 'text', required: true, placeholder: '如：公式说明补充' },
    { key: '资源类型', label: '资源类型', type: 'select', options: ['图片', '文字', '表格'], required: true, defaultValue: '文字' },
    { key: '插入章节', label: '插入章节', type: 'select', options: REPORT_CHAPTER_OPTIONS, required: true },
    { key: '使用场景', label: '使用场景', type: 'select', options: ['会议室', '报告厅', '通用'], required: true, defaultValue: '通用' },
    { key: '图片解释', label: '资源解释', type: 'textarea', placeholder: '资源说明文字，将保留在资源正文之前。' },
    { key: '资源内容', label: '资源内容', type: 'textarea', required: true, placeholder: '图片类型请上传图片；文字和表格类型请填写Markdown内容。' },
    { key: '是否启用', label: '是否启用', type: 'select', options: ['是', '否'], required: true, defaultValue: '是' }
  ]
};

const LINE_ARRAY_SUBWOOFER_FIELDS: Array<{ key: string; label: string; placeholder?: string }> = [
  { key: '类型', label: '类型', placeholder: '如 次低音音箱' },
  { key: '产品名称', label: '产品名称' },
  { key: '型号', label: '型号' },
  { key: '市场价', label: '市场价', placeholder: '数字，单位元' },
  { key: '额定阻抗', label: '额定阻抗', placeholder: '如 8Ω' },
  { key: '额定功率', label: '额定功率', placeholder: '如 300W' },
  { key: '灵敏度', label: '灵敏度', placeholder: '如 98dB' },
  { key: '最大声压级', label: '最大声压级', placeholder: '如 130dB' },
  { key: '水平覆盖角', label: '水平覆盖角', placeholder: '单位°，如 90' },
  { key: '垂直覆盖角', label: '垂直覆盖角', placeholder: '单位°，如 60' },
  { key: '面高', label: '面高', placeholder: '单位米，如 0.5' },
  { key: '品牌', label: '品牌' }
];

const LINE_ARRAY_HANGER_FIELDS: Array<{ key: string; label: string; placeholder?: string }> = [
  { key: '产品名称', label: '产品名称' },
  { key: '型号', label: '型号' },
  { key: '市场价', label: '市场价', placeholder: '数字，单位元' }
];

const App: React.FC = () => {
  const logic = useAcousticLogic();
  const isAdminUser = ['管理员', 'admin'].includes(String(logic.currentUser?.role || '').trim().toLowerCase());
  const [activeResultView, setActiveResultView] = useState<ResultView>('TABLE');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [editingEq, setEditingEq] = useState<DbInventoryItem | null>(null);
  const [isAddingEq, setIsAddingEq] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null);
  const [editingHistory, setEditingHistory] = useState<HistoryRecord | null>(null);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);

  // 用户管理弹窗状态
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isAddingUser, setIsAddingUser] = useState(false);

  // 用户个人资料下拉框状态
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const [showReportDialog, setShowReportDialog] = useState(false);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [exportDialogType, setExportDialogType] = useState<'EXCEL' | 'PDF' | null>(null);
  const [detailDialog, setDetailDialog] = useState<{ resIdx: number; itemIdx: number; item: EquipmentItem; detail: DbInventoryItem | null; table: TableType | null } | null>(null);
  const [replacementId, setReplacementId] = useState<number | ''>('');
  const [editingOptions, setEditingOptions] = useState<DbInventoryItem[]>([]);
  const [isReplacementPickerOpen, setIsReplacementPickerOpen] = useState(false);
  const [pendingLinkedUpdates, setPendingLinkedUpdates] = useState<LinkedPlanUpdate[]>([]);
  const [ampRecommendationPrompt, setAmpRecommendationPrompt] = useState<AmplifierRecommendationPrompt | null>(null);
  const [solutionSidebarWidth, setSolutionSidebarWidth] = useState(360);
  const [isResizingSolutionLayout, setIsResizingSolutionLayout] = useState(false);
  const solutionResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [selectedInventoryIds, setSelectedInventoryIds] = useState<Set<number>>(new Set());
  const selectAllInventoryRef = useRef<HTMLInputElement | null>(null);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<number>>(new Set());
  const selectAllHistoryRef = useRef<HTMLInputElement | null>(null);

  const [tempType, setTempType] = useState<TableType>(logic.activeTable);
  const [newResourceType, setNewResourceType] = useState<'图片' | '文字' | '表格'>('文字');
  const [editResourceType, setEditResourceType] = useState<'图片' | '文字' | '表格'>('文字');
  const [newSpeakerProductType, setNewSpeakerProductType] = useState<string>(SPEAKER_TYPES[0]);
  const [editSpeakerProductType, setEditSpeakerProductType] = useState<string>(SPEAKER_TYPES[0]);
  const [lineArraySubwooferExpanded, setLineArraySubwooferExpanded] = useState(true);
  const [lineArrayHangerExpanded, setLineArrayHangerExpanded] = useState(true);
  const [entryMode, setEntryMode] = useState<'single' | 'batch'>('single');
  const [batchText, setBatchText] = useState('');
  const [batchImageFile, setBatchImageFile] = useState<File | null>(null);
  const [batchSheetFile, setBatchSheetFile] = useState<File | null>(null);
  const [batchParsing, setBatchParsing] = useState(false);
  const [parsedBatchItems, setParsedBatchItems] = useState<ParsedBatchItem[]>([]);
  const [removedImageFieldKeys, setRemovedImageFieldKeys] = useState<Set<string>>(new Set());
  const [isColumnConfigOpen, setIsColumnConfigOpen] = useState(false);
  const [columnPreferences, setColumnPreferences] = useState<Record<string, TableColumnPreference>>(() => {
    try {
      const raw = localStorage.getItem('inventory-column-preferences');
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  });
  const activeResult = logic.designState.results[logic.designState.activeResultIndex];
  const speakerTypeOptions = logic.speakerProductTypeOptions?.length
    ? logic.speakerProductTypeOptions
    : SPEAKER_TYPES;
  const speakerFunctionOptions = logic.speakerFunctionOptions?.length
    ? logic.speakerFunctionOptions
    : SPEAKER_FUNCTIONS;
  const productTypeFilterOptions = useMemo(() => {
    const rowValues = (logic.inventory || [])
      .map((item) => String((item as any).产品类型 || item.类型 || '').trim())
      .filter(Boolean);
    const baseValues = logic.activeTable === TableType.SPEAKER
      ? [...speakerTypeOptions, ...rowValues]
      : rowValues;
    return Array.from(new Set(baseValues));
  }, [logic.inventory, logic.activeTable, speakerTypeOptions]);

  const theme = logic.currentSolutionTab === SolutionTab.VERIFICATION
    ? VERIFY_THEME
    : SCENARIO_THEMES[logic.designState.scenario];

  const themeText = `text-${theme.color}`;
  const themeBg = `bg-${theme.color}`;
  const themeBorder = `border-${theme.color}`;
  const isBlueprintLocked = !!logic.designState.blueprint;
  const isLectureHallManagement = logic.designState.scenario === Scenario.LECTURE_HALL;
  const managementTheme = isLectureHallManagement
    ? {
      activeNav: 'bg-fuchsia-600 text-white border-fuchsia-600 shadow-sm',
      primaryBtn: 'bg-fuchsia-600 hover:bg-fuchsia-700',
      focusRing: 'focus:border-fuchsia-300 focus:ring-fuchsia-100',
      rowHover: 'hover:bg-fuchsia-50/40',
      softBtn: 'border-fuchsia-200 text-fuchsia-700 bg-fuchsia-50 hover:bg-fuchsia-100',
      fileBtn: 'file:bg-fuchsia-50 file:text-fuchsia-700'
    }
    : {
      activeNav: 'bg-blue-600 text-white border-blue-600 shadow-sm',
      primaryBtn: 'bg-blue-600 hover:bg-blue-700',
      focusRing: 'focus:border-blue-300 focus:ring-blue-100',
      rowHover: 'hover:bg-blue-50/40',
      softBtn: 'border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100',
      fileBtn: 'file:bg-blue-50 file:text-blue-700'
    };

  const getItemDetail = (item: EquipmentItem) => logic.getCachedEquipmentDetail(item);
  const getItemBrand = (item: EquipmentItem) => item.brand || getItemDetail(item)?.品牌 || '';
  const inferResourceTypeByContent = (content: string): '图片' | '文字' | '表格' => {
    const normalized = String(content || '').trim().toLowerCase();
    if (!normalized) return '文字';
    if (
      normalized.startsWith('data:image/') ||
      /^!\[[^\]]*\]\([^\)]+\)$/.test(normalized) ||
      /^https?:\/\/[^\s]+\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/.test(normalized)
    ) {
      return '图片';
    }
    const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const hasPipeRow = lines.some((line) => /^\|.+\|$/.test(line));
    const hasDivider = lines.some((line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line));
    if (normalized.includes('<table') || (hasPipeRow && hasDivider)) {
      return '表格';
    }
    return '文字';
  };
  const normalizeResourceType = (value: any, fallback: '图片' | '文字' | '表格' = '文字'): '图片' | '文字' | '表格' => {
    const normalized = String(value || '').trim();
    if (normalized === '图片') return '图片';
    if (normalized === '表格') return '表格';
    if (normalized === '文字') return '文字';
    if (normalized === '文字（表格）') return fallback;
    return fallback;
  };
  const sanitizeMarkdownForDisplay = (value: string) => {
    return String(value || '')
      .replace(/^\s*\n+/, '')
      .trimEnd();
  };

  const buildReplacementOptionLabel = (option: DbInventoryItem) => {
    const parts = [option?.品牌, option?.产品名称, option?.型号]
      .map((part) => String(part || '').trim())
      .filter(Boolean);
    if (parts.length > 0) return parts.join(' / ');
    return `ID ${option?.id ?? '-'}`;
  };

  const getItemUnitPrice = (item: EquipmentItem) => {
    const raw = item.unitPrice ?? getItemDetail(item)?.市场价;
    return raw ? Number(raw) : 0;
  };

  const activeTotalPrice = activeResult?.items.reduce((sum, item) => {
    return sum + getItemUnitPrice(item) * (item.quantity || 0);
  }, 0) || 0;

  const reportUpToDate = !!(activeResult?.lastReportSignature && activeResult.lastReportSignature === logic.buildItemsSignature(activeResult.items));
  const reportMarkdown = sanitizeMarkdownForDisplay(activeResult?.markdownProcessed || activeResult?.markdownRaw || '');
  const reportGenerationStatus = activeResult?.reportGenerationStatus || 'idle';
  const isReportGenerating = reportGenerationStatus === 'generating';
  const canPreviewReport = !!reportMarkdown || isReportGenerating || (activeResult?.chapters?.length || 0) > 0;
  const hasGeneratedReport = reportUpToDate || (!!reportMarkdown && !isReportGenerating);
  const hasPdfExport = hasGeneratedReport;
  const hasExcelExport = logic.designState.results.length > 0;
  const detailOptions = detailDialog?.table ? logic.getInventoryOptions(detailDialog.table) : [];
  const detailTargetType = String(
    detailDialog?.detail?.类型 || detailDialog?.detail?.产品类型 || detailDialog?.item?.type || ''
  ).trim();
  const detailReplacementOptions = detailOptions.filter((opt) => {
    const rowType = String(opt.类型 || opt.产品类型 || '').trim();
    if (!detailTargetType || !rowType) return true;
    const normalizeTypeClass = (value: string) => {
      const text = String(value || '').trim();
      if (!text) return '';
      if (text.includes('功放')) return '功放';
      if (text.includes('话筒') || text.includes('麦克风')) return '话筒';
      if (text.includes('反馈抑制')) return '反馈抑制器';
      if (text.includes('调音台')) return '调音台';
      if (text.includes('音频处理')) return '音频处理器';
      if (text.includes('天线放大')) return '天线放大系统';
      if (text.includes('电源时序')) return '电源时序器';
      if (text.includes('吊挂架') || text.includes('吊架')) return '线阵列吊架';
      if (text.includes('次低')) return '线阵列次低';
      if (text.includes('线阵列音箱')) return '线阵列音箱';
      if (text.includes('超低音箱')) return '超低音箱';
      if (text.includes('音箱')) return '音箱';
      if (text.includes('中控')) return '中控系统';
      if (text.includes('矩阵')) return '矩阵';
      if (text.includes('视频会议')) return '视频会议系统';
      if (text.includes('录播')) return '录播系统';
      return text;
    };
    return normalizeTypeClass(detailTargetType) === normalizeTypeClass(rowType);
  });

  const glassThemePalette = logic.currentSolutionTab === SolutionTab.VERIFICATION
    ? {
        glassRgb: '5, 150, 105',
        glassRgb2: '16, 185, 129',
        glassBorderRgb: '52, 211, 153',
        glassTextRgb: '6, 95, 70',
        glassPrimaryTextRgb: '6, 78, 59'
      }
    : logic.designState.scenario === Scenario.LECTURE_HALL
      ? {
          glassRgb: '168, 85, 247',
          glassRgb2: '217, 70, 239',
          glassBorderRgb: '196, 181, 253',
          glassTextRgb: '107, 33, 168',
          glassPrimaryTextRgb: '76, 29, 149'
        }
      : {
          glassRgb: '37, 99, 235',
          glassRgb2: '14, 165, 233',
          glassBorderRgb: '96, 165, 250',
          glassTextRgb: '30, 64, 175',
          glassPrimaryTextRgb: '30, 58, 138'
        };

  const glassThemeVars = {
    '--glass-rgb': glassThemePalette.glassRgb,
    '--glass-rgb-2': glassThemePalette.glassRgb2,
    '--glass-border-rgb': glassThemePalette.glassBorderRgb,
    '--glass-text-rgb': glassThemePalette.glassTextRgb,
    '--glass-primary-text-rgb': glassThemePalette.glassPrimaryTextRgb
  } as React.CSSProperties;

  const glassButtonClass = 'glass-btn inline-flex items-center justify-center rounded-xl transition-all hover:-translate-y-0.5 active:translate-y-0';
  const glassPrimaryButtonClass = 'glass-btn glass-btn-primary inline-flex items-center justify-center rounded-xl transition-all hover:-translate-y-0.5 active:translate-y-0';

  const flattenNodeText = (node: ReactNode): string => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(flattenNodeText).join('');
    if (!node || typeof node !== 'object') return '';
    const maybeChildren = (node as any).props?.children;
    return flattenNodeText(maybeChildren);
  };

  const markdownComponents = {
    h2: ({ children, ...props }: any) => {
      const headingText = flattenNodeText(children).replace(/\s+/g, '');
      const isToc = headingText === '目录';
      const className = isToc
        ? `toc-heading ${props.className || ''}`.trim()
        : props.className;
      return <h2 {...props} className={className}>{children}</h2>;
    }
  };

  const renderProgressiveReport = (result?: SolutionResult) => {
    if (!result) return null;

    const chapters = result.chapters || [];
    if (chapters.length > 0) {
      return (
        <div className="space-y-5">
          {chapters.map((chapter) => {
            const chapterMarkdown = sanitizeMarkdownForDisplay(chapter.markdown || '');
            if (chapter.status === 'done' && chapterMarkdown.trim()) {
              return (
                <article key={`chapter-${result.id}-${chapter.key}`} className="markdown-report max-w-none text-[13px] leading-7">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>{chapterMarkdown}</ReactMarkdown>
                </article>
              );
            }

            if (chapter.status === 'error') {
              return (
                <section key={`chapter-${result.id}-${chapter.key}`} className="report-chapter-loading-card">
                  <h2 className="report-chapter-title">{chapter.title}</h2>
                  <p className="report-chapter-error">章节生成失败：{chapter.error || '请稍后重试'}</p>
                </section>
              );
            }

            return (
              <section key={`chapter-${result.id}-${chapter.key}`} className="report-chapter-loading-card">
                <h2 className="report-chapter-title">{chapter.title}</h2>
                <div className="report-chapter-loading-row">
                  <span className="report-chapter-spinner" />
                  <span className="report-chapter-loading-text">章节生成中...</span>
                </div>
                <div className="report-chapter-skeleton" />
                <div className="report-chapter-skeleton w-[92%]" />
                <div className="report-chapter-skeleton w-[86%]" />
              </section>
            );
          })}
        </div>
      );
    }

    if (!reportMarkdown) return null;
    return (
      <article className="markdown-report markdown-preview max-w-none text-[13px] leading-7">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>{reportMarkdown}</ReactMarkdown>
      </article>
    );
  };

  const toggleSort = (key: string) => {
    logic.setSortConfig(prev => {
      if (!prev || prev.key !== key) {
        return { key, direction: 'asc' };
      }
      return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
    });
  };

  const renderSortArrow = (key: string) => {
    if (logic.sortConfig?.key !== key) {
      return <span className="ml-1 text-slate-300">▲▼</span>;
    }
    return (
      <span className="ml-1 text-slate-500">
        {logic.sortConfig.direction === 'asc' ? '▲' : '▼'}
      </span>
    );
  };

  const getFieldsByTable = (table: TableType) => TABLE_FIELD_CONFIG[table] || [];
  const getFieldOptions = (field: FieldConfig) => {
    if (field.key === '产品类型') {
      return speakerTypeOptions;
    }
    if (field.key === '功能') {
      return speakerFunctionOptions;
    }
    if (field.key === '插入章节') {
      return logic.planChapterOptions?.length ? logic.planChapterOptions : (field.options || []);
    }
    return field.options || [];
  };

  const getBaseDisplayColumns = (table: TableType, rows: DbInventoryItem[]) => {
    const preferred = getFieldsByTable(table).map((f) => f.key);
    const dynamic = new Set<string>();
    rows.forEach((row) => {
      Object.keys(row || {}).forEach((key) => {
        if (key !== 'id' && key !== 'isChild') {
          dynamic.add(key);
        }
      });
    });
    const merged = [...preferred, ...Array.from(dynamic).filter((k) => !preferred.includes(k))];
    return ['序号', ...merged.filter((key) => key !== '序号')];
  };

  const getDisplayColumns = (table: TableType, rows: DbInventoryItem[]) => {
    const base = getBaseDisplayColumns(table, rows);
    if (!isAdminUser) return base;

    const preference = columnPreferences[table];
    if (!preference) return base;

    const baseWithoutSerial = base.filter((col) => col !== '序号');
    const ordered = [
      ...preference.order.filter((col) => baseWithoutSerial.includes(col)),
      ...baseWithoutSerial.filter((col) => !preference.order.includes(col))
    ];

    const visibleSet = new Set(preference.visible || []);
    const visibleOrdered = ordered.filter((col) => visibleSet.size === 0 || visibleSet.has(col));
    return ['序号', ...visibleOrdered];
  };

  const updateTableColumnPreference = (table: TableType, next: TableColumnPreference) => {
    setColumnPreferences((prev) => ({
      ...prev,
      [table]: {
        order: Array.from(new Set(next.order.filter(Boolean))),
        visible: Array.from(new Set(next.visible.filter(Boolean)))
      }
    }));
  };

  const ensureTableColumnPreference = (table: TableType, columns: string[]) => {
    const current = columnPreferences[table];
    if (current) return current;
    const initialColumns = columns.filter((col) => col !== '序号');
    const initialPreference: TableColumnPreference = {
      order: initialColumns,
      visible: initialColumns
    };
    updateTableColumnPreference(table, initialPreference);
    return initialPreference;
  };

  const getDisplayColumnLabel = (table: TableType, column: string) => {
    if (column === '类型' && (table === TableType.SPEAKER || table === TableType.LINE_ARRAY_SUPPORT)) {
      return '产品类型';
    }
    if (table === TableType.LOCAL_STATIC_RESOURCE) {
      if (column === '图片名称') return '资源名称';
      if (column === '图片解释') return '资源解释';
    }
    return column;
  };

  const readFileAsDataUrl = async (file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
  };

  const parseCoveragePair = (value: any) => {
    const text = String(value || '').trim();
    if (!text) return { horizontal: '', vertical: '' };
    const matched = text.match(/([0-9]+(?:\.[0-9]+)?)\s*°?\s*[x×X＊*]\s*([0-9]+(?:\.[0-9]+)?)\s*°?/);
    if (!matched) return { horizontal: '', vertical: '' };
    return {
      horizontal: matched[1],
      vertical: matched[2]
    };
  };

  const normalizeFeatureValues = (value: any) => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    const text = String(value || '').trim();
    if (!text) return [];
    return text
      .split(/[、,，;；|/]/)
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const validatePayloadByTable = (table: TableType, payload: Record<string, any>) => {
    const errors: string[] = [];
    const requiredError = (label: string) => `${label}为必填项`;

    const isPositiveNumber = (value: any) => {
      const num = Number(value);
      return Number.isFinite(num) && num > 0;
    };

    const matchUnit = (value: any, reg: RegExp) => reg.test(String(value || '').trim());

    if (table === TableType.SPEAKER) {
      const requiredFields = ['类型', '品牌', '产品名称', '型号', '市场价', '额定阻抗', '额定功率', '灵敏度', '最大声压级', '水平覆盖角', '垂直覆盖角', '面高', '功能'];
      requiredFields.forEach((key) => {
        const value = payload[key];
        const isEmpty = Array.isArray(value) ? value.length === 0 : String(value ?? '').trim() === '';
        if (isEmpty) {
          errors.push(requiredError(key === '类型' ? '产品类型' : key));
        }
      });

      const productTypeValue = String(payload['类型'] || payload['产品类型'] || '').trim();
      if (productTypeValue && !speakerTypeOptions.includes(productTypeValue)) {
        errors.push(`产品类型不在音箱表允许值中：${productTypeValue}`);
      }

      if (!isPositiveNumber(payload['市场价'])) errors.push('市场价必须为大于0的数字');
      if (!isPositiveNumber(payload['面高'])) errors.push('面高必须为大于0的数字');
      if (!isPositiveNumber(payload['水平覆盖角']) || !isPositiveNumber(payload['垂直覆盖角'])) {
        errors.push('水平覆盖角和垂直覆盖角必须为大于0的数字');
      }
      if (!matchUnit(payload['额定阻抗'], /^\d+(?:\.\d+)?\s*(?:Ω|ohm|OHM)$/)) errors.push('额定阻抗格式应为数值+Ω');
      if (!matchUnit(payload['额定功率'], /^\d+(?:\.\d+)?\s*[wW]$/)) errors.push('额定功率格式应为数值+W');
      if (!matchUnit(payload['灵敏度'], /^\d+(?:\.\d+)?\s*dB$/i)) errors.push('灵敏度格式应为数值+dB');
      if (!matchUnit(payload['最大声压级'], /^\d+(?:\.\d+)?\s*dB$/i)) errors.push('最大声压级格式应为数值+dB');
      const fnValues = normalizeFeatureValues(payload['功能']);
      if (fnValues.length === 0) {
        errors.push('功能至少选择1项');
      } else {
        const allowed = new Set(speakerFunctionOptions.map((item) => String(item || '').trim()).filter(Boolean));
        const invalid = fnValues.filter((item) => !allowed.has(item));
        if (invalid.length > 0) {
          errors.push(`功能选项不合法：${invalid.join('、')}`);
        }
      }
    }

    if (table === TableType.LINE_ARRAY_SUPPORT) {
      const usage = String(payload['用途'] || '').trim();
      if (usage === '挂架') {
        ['产品名称', '型号', '市场价'].forEach((key) => {
          if (String(payload[key] ?? '').trim() === '') errors.push(requiredError(key));
        });
      }
      if (String(payload['市场价'] ?? '').trim() !== '' && !isPositiveNumber(payload['市场价'])) {
        errors.push('市场价必须为大于0的数字');
      }
    }

    return errors;
  };

  const buildLineArraySupportPayloadFromForm = () => {
    const subwoofer: Record<string, any> = {};
    LINE_ARRAY_SUBWOOFER_FIELDS.forEach((field) => {
      const input = document.getElementById(`new-line-subwoofer-${field.key}`) as HTMLInputElement | null;
      if (!input) return;
      const text = input.value.trim();
      subwoofer[field.key] = field.key === '市场价' && !text ? '100' : text;
    });
    subwoofer['用途'] = '次低音箱';

    const hanger: Record<string, any> = {};
    LINE_ARRAY_HANGER_FIELDS.forEach((field) => {
      const input = document.getElementById(`new-line-hanger-${field.key}`) as HTMLInputElement | null;
      if (!input) return;
      const text = input.value.trim();
      hanger[field.key] = field.key === '市场价' && !text ? '100' : text;
    });
    hanger['用途'] = '挂架';

    return { subwoofer, hanger };
  };

  const buildPayloadFromForm = async (prefix: string, table: TableType) => {
    const payload: Record<string, any> = {};
    const fields = getFieldsByTable(table);

    const getFormResourceType = () => {
      const resourceTypeElement = document.getElementById(`${prefix}-资源类型`) as HTMLSelectElement | null;
      const selected = resourceTypeElement?.value;
      if (table === TableType.LOCAL_STATIC_RESOURCE) {
        if (prefix === 'new') return normalizeResourceType(selected || newResourceType);
        return normalizeResourceType(selected || editResourceType);
      }
      return normalizeResourceType(selected || '文字');
    };

    for (const field of fields) {
      const element = document.getElementById(`${prefix}-${field.key}`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      if (!element && field.type !== 'multiselect') continue;

      if (prefix === 'edit' && field.type === 'file' && removedImageFieldKeys.has(field.key)) {
        payload[field.key] = '';
        continue;
      }

      let value: any = null;

      if (field.type === 'multiselect') {
        const checkedNodes = Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${prefix}-${field.key}"]:checked`));
        value = checkedNodes.map((node) => node.value).filter(Boolean);
      }

      if (table === TableType.LOCAL_STATIC_RESOURCE && field.key === '资源内容') {
        const resourceType = getFormResourceType();
        if (resourceType === '图片') {
          const input = element as HTMLInputElement;
          const selectedFile = input.files?.[0];
          if (selectedFile) {
            value = await readFileAsDataUrl(selectedFile);
          } else if (prefix === 'edit' && editingEq && normalizeResourceType((editingEq as any)?.资源类型) === '图片' && String((editingEq as any)?.资源内容 || '').trim()) {
            value = String((editingEq as any)?.资源内容 || '').trim();
          } else if (field.required) {
            throw new Error('资源类型为“图片”时，资源内容为必填项，请上传图片。');
          }
        } else {
          value = (element as HTMLTextAreaElement).value;
        }
      }

      if (value === null && field.type === 'file') {
        const input = element as HTMLInputElement;
        const selectedFile = input.files?.[0];
        if (selectedFile) {
          value = await readFileAsDataUrl(selectedFile);
        } else if (prefix === 'edit' && editingEq && String((editingEq as any)?.[field.key] || '').trim()) {
          value = String((editingEq as any)?.[field.key] || '').trim();
        } else if (field.required) {
          throw new Error(`${field.label}为必填项，请上传图片。`);
        } else {
          continue;
        }
      } else if (value === null) {
        if (!element) continue;
        value = element.value;
      }

      if (field.type === 'number') {
        value = value === '' ? null : Number(value);
        if (!Number.isFinite(value)) value = null;
      }
      if (typeof value === 'string') value = value.trim();

      if (value === '' || value === null || (Array.isArray(value) && value.length === 0)) {
        if (field.required) {
          throw new Error(`${field.label}为必填项`);
        } else {
          continue;
        }
      }
      payload[field.key] = value;
    }

    if ((table === TableType.SPEAKER || table === TableType.LINE_ARRAY_SUPPORT) && payload['产品类型'] && !payload['类型']) {
      payload['类型'] = payload['产品类型'];
    }

    if ((table === TableType.SPEAKER || table === TableType.LINE_ARRAY_SUPPORT) && payload['水平覆盖角'] && payload['垂直覆盖角']) {
      payload['覆盖角'] = `${String(payload['水平覆盖角']).trim()}°×${String(payload['垂直覆盖角']).trim()}°`;
    }

    if (table === TableType.SPEAKER && payload['功能']) {
      payload['功能'] = normalizeFeatureValues(payload['功能']);
    }

    const formatErrors = validatePayloadByTable(table, payload);
    if (formatErrors.length > 0) {
      throw new Error(formatErrors.join('；'));
    }

    if (table === TableType.SPEAKER && prefix === 'new' && String(payload['类型'] || '').trim() === '线阵列音箱') {
      const lineArraySupport = buildLineArraySupportPayloadFromForm();
      const subwooferPayload = {
        ...lineArraySupport.subwoofer,
        覆盖角: `${lineArraySupport.subwoofer['水平覆盖角'] || ''}°×${lineArraySupport.subwoofer['垂直覆盖角'] || ''}°`
      };
      const hangerPayload = {
        ...lineArraySupport.hanger,
        类型: '线阵列音箱吊挂架'
      };
      const subwooferErrors = validatePayloadByTable(TableType.LINE_ARRAY_SUPPORT, subwooferPayload);
      const hangerErrors = validatePayloadByTable(TableType.LINE_ARRAY_SUPPORT, { ...hangerPayload, 用途: '挂架' });
      if (subwooferErrors.length > 0 || hangerErrors.length > 0) {
        throw new Error([...subwooferErrors, ...hangerErrors].join('；'));
      }

      payload.lineArraySupport = {
        subwoofer: lineArraySupport.subwoofer,
        hanger: lineArraySupport.hanger
      };
    }

    return payload;
  };

  const normalizePayloadForSave = (table: TableType, payload: Record<string, any>) => {
    const next = { ...(payload || {}) };
    if ((table === TableType.SPEAKER || table === TableType.LINE_ARRAY_SUPPORT) && next['产品类型'] && !next['类型']) {
      next['类型'] = String(next['产品类型']).trim();
    }
    if ((table === TableType.SPEAKER || table === TableType.LINE_ARRAY_SUPPORT) && next['水平覆盖角'] && next['垂直覆盖角']) {
      next['覆盖角'] = `${String(next['水平覆盖角']).trim()}°×${String(next['垂直覆盖角']).trim()}°`;
    }
    if (table === TableType.SPEAKER && Object.prototype.hasOwnProperty.call(next, '功能')) {
      next['功能'] = normalizeFeatureValues(next['功能']);
    }
    return next;
  };

  const updateParsedBatchItemField = (id: number, key: string, value: any) => {
    setParsedBatchItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      const payload = { ...(item.payload || {}), [key]: value } as Record<string, any>;
      if (key === '产品类型') {
        payload['类型'] = value;
      }
      const normalizedPayload = normalizePayloadForSave(tempType, payload);
      const errors = validatePayloadByTable(tempType, normalizedPayload);
      return {
        ...item,
        payload: normalizedPayload,
        errors,
        complete: errors.length === 0
      };
    }));
  };

  const imageColumnSet = new Set(['设备图片', '图片文件']);
  const centerColumnSet = new Set(['类型', '产品类型', '资源类型', '场景', '使用场景', '插入章节', '是否启用', '额定功率', '额定阻抗', '输入通道', '输出通道', '通道数', '数量', '面高', '覆盖角', '水平覆盖角', '垂直覆盖角', '功能']);

  const getColumnAlignmentClass = (column: string) => {
    if (column === '序号') return 'text-center';
    if (column.includes('价') || column === '市场价') return 'text-right tabular-nums';
    if (centerColumnSet.has(column)) return 'text-center';
    return 'text-left';
  };

  const visibleInventoryIds = useMemo(
    () => logic.inventory
      .map((item) => Number(item.id))
      .filter((id) => Number.isFinite(id)),
    [logic.inventory]
  );

  const visibleHistoryIds = useMemo(
    () => logic.history
      .map((item) => Number(item.id))
      .filter((id) => Number.isFinite(id)),
    [logic.history]
  );

  const selectedVisibleInventoryCount = useMemo(
    () => visibleInventoryIds.filter((id) => selectedInventoryIds.has(id)).length,
    [visibleInventoryIds, selectedInventoryIds]
  );

  const isAllVisibleInventorySelected =
    visibleInventoryIds.length > 0 && selectedVisibleInventoryCount === visibleInventoryIds.length;
  const isPartialVisibleInventorySelected =
    selectedVisibleInventoryCount > 0 && !isAllVisibleInventorySelected;

  const selectedVisibleHistoryCount = useMemo(
    () => visibleHistoryIds.filter((id) => selectedHistoryIds.has(id)).length,
    [visibleHistoryIds, selectedHistoryIds]
  );

  const isAllVisibleHistorySelected =
    visibleHistoryIds.length > 0 && selectedVisibleHistoryCount === visibleHistoryIds.length;
  const isPartialVisibleHistorySelected =
    selectedVisibleHistoryCount > 0 && !isAllVisibleHistorySelected;

  const toggleInventoryRowSelection = (id: number, checked: boolean) => {
    setSelectedInventoryIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const toggleSelectAllInventoryRows = (checked: boolean) => {
    if (!checked) {
      setSelectedInventoryIds(new Set());
      return;
    }
    setSelectedInventoryIds(new Set(visibleInventoryIds));
  };

  const toggleHistoryRowSelection = (id: number, checked: boolean) => {
    setSelectedHistoryIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const toggleSelectAllHistoryRows = (checked: boolean) => {
    if (!checked) {
      setSelectedHistoryIds(new Set());
      return;
    }
    setSelectedHistoryIds(new Set(visibleHistoryIds));
  };

  const handleBatchDeleteInventory = async () => {
    const targetIds = visibleInventoryIds.filter((id) => selectedInventoryIds.has(id));
    if (targetIds.length === 0) {
      alert('请先勾选要删除的条目。');
      return;
    }

    if (!window.confirm(`确定删除已选中的 ${targetIds.length} 条数据吗？此操作不可恢复。`)) {
      return;
    }

    const result = await logic.deleteInventoryItemsBatch(logic.activeTable, targetIds);
    if (!result?.ok) return;

    setSelectedInventoryIds(new Set());
    alert(`已删除 ${result.deleted} 条数据。`);
  };

  const handleBatchDeleteHistory = async () => {
    const targetIds = visibleHistoryIds.filter((id) => selectedHistoryIds.has(id));
    if (targetIds.length === 0) {
      alert('请先勾选要删除的历史记录。');
      return;
    }

    if (!window.confirm(`确定删除已选中的 ${targetIds.length} 条历史记录吗？此操作不可恢复。`)) {
      return;
    }

    const result = await logic.deleteHistoryRecordsBatch(targetIds);
    if (!result?.ok) return;

    setSelectedHistoryIds(new Set());
    alert(`已删除 ${result.deleted} 条历史记录。`);
  };

  const parseExcelRows = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
    if (!firstSheet) return [];
    return XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, { defval: '' });
  };

  const handleParseBatchInput = async () => {
    if (batchParsing) return;
    try {
      setBatchParsing(true);
      let params: {
        table: TableType;
        inputType: 'chat';
        text?: string;
        imageData?: string;
        items?: Array<Record<string, any>>;
      } = {
        table: tempType,
        inputType: 'chat'
      };

      if (!batchText.trim() && !batchImageFile && !batchSheetFile) {
        throw new Error('请在对话输入框填写文字，或上传图片/Excel/CSV 后再解析');
      }

      if (batchText.trim()) {
        params.text = batchText.trim();
      }

      if (batchImageFile) {
        params.imageData = await readFileAsDataUrl(batchImageFile);
      }

      if (batchSheetFile) {
        params.items = await parseExcelRows(batchSheetFile);
      }

      const result = await logic.parseInventoryBatch(params);
      if (!result.ok) {
        throw new Error(result.error || '批量解析失败');
      }

      const items: ParsedBatchItem[] = (result.items || []).map((item: any, idx: number) => {
        const payload = normalizePayloadForSave(tempType, (item?.payload || {}) as Record<string, any>);
        const errors = validatePayloadByTable(tempType, payload);
        return {
        id: Number(item?.id || idx + 1),
        payload: payload as Partial<DbInventoryItem>,
        errors,
        complete: errors.length === 0,
        expanded: true
      };
      });

      setParsedBatchItems(items);
    } catch (error: any) {
      alert(error?.message || '批量解析失败');
      setParsedBatchItems([]);
    } finally {
      setBatchParsing(false);
    }
  };

  const handleConfirmBatchSave = async () => {
    if (parsedBatchItems.length === 0) {
      alert('请先完成批量解析');
      return;
    }

    const normalizedItems = parsedBatchItems.map((item) => {
      const normalizedPayload = normalizePayloadForSave(tempType, item.payload as Record<string, any>);
      const errors = validatePayloadByTable(tempType, normalizedPayload);
      return {
        ...item,
        payload: normalizedPayload,
        errors,
        complete: errors.length === 0
      };
    });

    setParsedBatchItems(normalizedItems);

    const invalid = normalizedItems.filter((item) => !item.complete || item.errors.length > 0);
    if (invalid.length > 0) {
      alert(`存在 ${invalid.length} 条解析异常数据，请修正后再录入。`);
      return;
    }

    let saved = 0;
    for (const item of normalizedItems) {
      const ok = await logic.handleSaveEquipment(tempType, item.payload);
      if (!ok) {
        alert('批量录入中断，请检查后端日志后重试。');
        return;
      }
      saved += 1;
    }

    alert(`批量录入完成，共录入 ${saved} 条。`);
    setIsAddingEq(false);
  };

  const resolvePlanItemTable = (type: string): TableType | null => {
    if (Object.values(TableType).includes(type as TableType)) return type as TableType;
    if (type === '功放' || type.includes('定阻功放')) return TableType.AMPLIFIER;
    if (type.includes('音箱')) return TableType.SPEAKER;
    if (['中控系统', '矩阵', '视频会议系统', '录播系统', '子系统'].includes(type)) return TableType.SUBSYSTEM;
    return TableType.PERIPHERAL;
  };

  const isSpeakerPlanType = (type: string) => {
    const text = String(type || '');
    return text.includes('音箱') || text.includes('线阵列');
  };

  const isAmplifierPlanType = (type: string) => {
    const text = String(type || '');
    return text.includes('功放');
  };

  const normalizeTypeClass = (value: string) => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.includes('功放')) return '功放';
    if (text.includes('话筒') || text.includes('麦克风')) return '话筒';
    if (text.includes('反馈抑制')) return '反馈抑制器';
    if (text.includes('调音台')) return '调音台';
    if (text.includes('音频处理')) return '音频处理器';
    if (text.includes('天线放大')) return '天线放大系统';
    if (text.includes('电源时序')) return '电源时序器';
    if (text.includes('吊挂架') || text.includes('吊架')) return '线阵列吊架';
    if (text.includes('次低')) return '线阵列次低';
    if (text.includes('线阵列音箱')) return '线阵列音箱';
    if (text.includes('超低音箱')) return '超低音箱';
    if (text.includes('音箱')) return '音箱';
    if (text.includes('中控')) return '中控系统';
    if (text.includes('矩阵')) return '矩阵';
    if (text.includes('视频会议')) return '视频会议系统';
    if (text.includes('录播')) return '录播系统';
    return text;
  };

  const isSameReplacementCategory = (targetType: string, candidateType: string) => {
    const targetClass = normalizeTypeClass(targetType);
    const candidateClass = normalizeTypeClass(candidateType);
    if (!targetClass || !candidateClass) return false;
    return targetClass === candidateClass;
  };

  const isLineArraySupportChildType = (value: string) => {
    const text = String(value || '');
    return text.includes('次低') || text.includes('吊挂架') || text.includes('吊架');
  };

  const isLineArraySupportChildItem = (item: EquipmentItem) => {
    const detail = getItemDetail(item);
    const mainId = Number(detail?.main_id || 0);
    if (mainId > 0) return true;
    const typeText = `${item.type || ''} ${item.name || ''}`;
    return typeText.includes('线阵列') && isLineArraySupportChildType(typeText);
  };

  const isLineArraySpeakerItem = (item: EquipmentItem, detail?: DbInventoryItem | null) => {
    const productType = String(detail?.产品类型 || detail?.类型 || item.type || '').trim();
    const mainId = Number(detail?.main_id || 0);
    return productType.includes('线阵列音箱') && mainId <= 0;
  };

  const findPairedAmplifierIndex = (items: EquipmentItem[], speakerIndex: number) => {
    if (!Array.isArray(items) || speakerIndex < 0) return -1;
    for (let i = speakerIndex + 1; i < items.length; i += 1) {
      const type = String(items[i]?.type || '');
      if (isSpeakerPlanType(type)) break;
      if (isAmplifierPlanType(type)) return i;
    }
    return -1;
  };

  const findPairedSpeakerIndex = (items: EquipmentItem[], amplifierIndex: number) => {
    if (!Array.isArray(items) || amplifierIndex < 0) return -1;
    for (let i = amplifierIndex - 1; i >= 0; i -= 1) {
      const type = String(items[i]?.type || '');
      if (isSpeakerPlanType(type)) return i;
      if (isAmplifierPlanType(type)) break;
    }
    return -1;
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logic.designState.chatHistory, logic.isChatOpen]);

  useEffect(() => {
    setSelectedInventoryIds(new Set());
  }, [logic.activeTable]);

  useEffect(() => {
    if (tempType === TableType.LOCAL_STATIC_RESOURCE) {
      setNewResourceType('文字');
    }
    if (tempType === TableType.SPEAKER) {
      setNewSpeakerProductType(speakerTypeOptions[0] || SPEAKER_TYPES[0]);
    }
  }, [tempType, speakerTypeOptions]);

  useEffect(() => {
    if (!isAddingEq) return;
    if (ENTRY_TARGET_TABLES.includes(tempType)) return;
    setTempType(ENTRY_TARGET_TABLES[0]);
  }, [isAddingEq, tempType]);

  useEffect(() => {
    localStorage.setItem('inventory-column-preferences', JSON.stringify(columnPreferences));
  }, [columnPreferences]);

  useEffect(() => {
    if (isAddingEq) {
      setNewResourceType('文字');
      if (tempType === TableType.SPEAKER) {
        setNewSpeakerProductType(speakerTypeOptions[0] || SPEAKER_TYPES[0]);
      }
      return;
    }
    setEntryMode('single');
    setBatchText('');
    setBatchImageFile(null);
    setBatchSheetFile(null);
    setParsedBatchItems([]);
    setBatchParsing(false);
    setLineArraySubwooferExpanded(true);
    setLineArrayHangerExpanded(true);
  }, [isAddingEq, tempType, speakerTypeOptions]);

  useEffect(() => {
    setParsedBatchItems([]);
  }, [tempType]);

  useEffect(() => {
    setRemovedImageFieldKeys(new Set());
  }, [editingEq, logic.activeTable]);

  useEffect(() => {
    if (!editingEq || logic.activeTable !== TableType.LOCAL_STATIC_RESOURCE) return;
    const current = (editingEq as any).资源类型;
    const inferred = inferResourceTypeByContent(String((editingEq as any).资源内容 || ''));
    setEditResourceType(normalizeResourceType(current, inferred));
  }, [editingEq, logic.activeTable]);

  useEffect(() => {
    if (!editingEq || logic.activeTable !== TableType.SPEAKER) return;
    const fallbackType = speakerTypeOptions[0] || SPEAKER_TYPES[0];
    const currentType = String((editingEq as any).产品类型 || (editingEq as any).类型 || fallbackType).trim();
    setEditSpeakerProductType(currentType || fallbackType);
  }, [editingEq, logic.activeTable, speakerTypeOptions]);

  useEffect(() => {
    if (tempType !== TableType.SPEAKER) return;
    if (speakerTypeOptions.length === 0) return;
    if (!speakerTypeOptions.includes(newSpeakerProductType)) {
      setNewSpeakerProductType(speakerTypeOptions[0]);
    }
  }, [tempType, speakerTypeOptions, newSpeakerProductType]);

  useEffect(() => {
    if (logic.activeTable !== TableType.SPEAKER) return;
    if (speakerTypeOptions.length === 0) return;
    if (!speakerTypeOptions.includes(editSpeakerProductType)) {
      setEditSpeakerProductType(speakerTypeOptions[0]);
    }
  }, [logic.activeTable, speakerTypeOptions, editSpeakerProductType]);

  useEffect(() => {
    setSelectedInventoryIds((prev) => {
      const visibleSet = new Set(visibleInventoryIds);
      let changed = false;
      const next = new Set<number>();

      prev.forEach((id) => {
        if (visibleSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });

      if (!changed && next.size === prev.size) {
        return prev;
      }
      return next;
    });
  }, [visibleInventoryIds]);

  useEffect(() => {
    if (selectAllInventoryRef.current) {
      selectAllInventoryRef.current.indeterminate = isPartialVisibleInventorySelected;
    }
  }, [isPartialVisibleInventorySelected]);

  useEffect(() => {
    setSelectedHistoryIds((prev) => {
      const visibleSet = new Set(visibleHistoryIds);
      let changed = false;
      const next = new Set<number>();

      prev.forEach((id) => {
        if (visibleSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });

      if (!changed && next.size === prev.size) {
        return prev;
      }
      return next;
    });
  }, [visibleHistoryIds]);

  useEffect(() => {
    if (selectAllHistoryRef.current) {
      selectAllHistoryRef.current.indeterminate = isPartialVisibleHistorySelected;
    }
  }, [isPartialVisibleHistorySelected]);

  // 当方案切换时，如果当前视图是方案预览且未生成，则切回到数据清单
  useEffect(() => {
    if (activeResultView === 'WORD' && !canPreviewReport) {
      setActiveResultView('TABLE');
    }
  }, [logic.designState.activeResultIndex, canPreviewReport]);

  useEffect(() => {
    if (!activeResult?.items?.length) return;
    activeResult.items.forEach(item => {
      logic.fetchEquipmentDetail(item);
    });
  }, [logic.designState.activeResultIndex, activeResult?.items]);

  // 处理点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isResizingSolutionLayout) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!solutionResizeRef.current) return;
      const deltaX = event.clientX - solutionResizeRef.current.startX;
      const nextWidth = Math.max(320, Math.min(560, solutionResizeRef.current.startWidth + deltaX));
      setSolutionSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSolutionLayout(false);
      solutionResizeRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSolutionLayout]);

  const startSolutionResize = (event: React.MouseEvent<HTMLDivElement>) => {
    solutionResizeRef.current = {
      startX: event.clientX,
      startWidth: solutionSidebarWidth
    };
    setIsResizingSolutionLayout(true);
  };

  const renderTopNav = () => (
    <header className="bg-white border-b h-11 px-5 flex items-center justify-between z-50 shrink-0 shadow-sm relative">
      <div className="flex items-center space-x-6">
        <div className="text-base font-black tracking-tighter uppercase text-slate-900">
          声学<span className={themeText}>大师</span>
        </div>
        <nav className="flex space-x-5 h-11">
          {(Object.values(Page) as Page[]).filter(p => {
            if (p === Page.MANAGEMENT || p === Page.USERS) {
              return isAdminUser;
            }
            return true;
          }).map(p => (
            <button key={p} onClick={() => logic.setCurrentPage(p)}
              className={`text-[13px] font-bold h-full relative px-1 transition-all flex items-center ${logic.currentPage === p ? `${themeText} border-b-2 ${themeBorder}` : 'text-slate-400 hover:text-slate-900'}`}>
              {p === Page.SOLUTION ? '方案设计' : p === Page.VERIFICATION ? '方案验证' : p === Page.MANAGEMENT ? '资源管理' : p === Page.HISTORY ? '历史设计' : '用户管理'}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center space-x-4">
        {/* 系统 AI 状态控制 */}
        <div className="flex items-center space-x-2 mr-4 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
          <span className="text-[13px] font-bold text-slate-500 uppercase tracking-wider">AI 引擎</span>
          <div className="flex items-center">
            <span className={`w-2 h-2 rounded-full mr-2 ${logic.isAiBackendRunning ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500'}`}></span>
            <button 
              onClick={() => logic.toggleAiBackend(logic.isAiBackendRunning ? 'stop' : 'start')}
              className={`text-[13px] font-bold py-0.5 px-2 rounded transition-all ${
                logic.isAiBackendRunning 
                  ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' 
                  : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
              }`}
            >
              {logic.isAiBackendRunning ? '关闭' : '开启'}
            </button>
          </div>
        </div>

        {/* 用户头像与下拉菜单 */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setIsProfileOpen(!isProfileOpen)}
            className={`flex items-center space-x-2 group p-0.5 pr-2 rounded-full border transition-all ${isProfileOpen ? 'bg-slate-50 border-slate-200' : 'border-transparent hover:bg-slate-50'}`}
          >
            <div className={`w-7 h-7 rounded-full ${themeBg} text-white flex items-center justify-center font-black text-[13px] shadow-sm relative`}>
              {logic.currentUser.username[0]}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white"></span>
            </div>
            <span className="text-[13px] font-bold text-slate-600 group-hover:text-slate-900">{logic.currentUser.username}</span>
            <svg className={`w-3 h-3 text-slate-300 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"></path></svg>
          </button>

          {/* 下拉菜单 */}
          {isProfileOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200">
              {/* 用户信息头部 */}
              <div className="p-4 bg-slate-50/80 border-b border-slate-100">
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 rounded-full ${themeBg} text-white flex items-center justify-center font-black text-xs shadow-lg`}>
                    {logic.currentUser.username[0]}
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-900">{logic.currentUser.username}</div>
                    <div className="text-[13px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{logic.currentUser.role}</div>
                    <div className="text-[13px] text-slate-400 mt-1 truncate max-w-[140px]">{logic.currentUser.phone || '未填写电话'}</div>
                  </div>
                </div>
              </div>

              {/* 菜单列表 */}
              <div className="p-2 space-y-1">
                <button onClick={() => { setIsProfileOpen(false); setIsProfileDialogOpen(true); }} className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-[13px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                  <span>个人资料</span>
                </button>
                <button className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-[13px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                  <span>账户设置</span>
                </button>
                <div className="h-px bg-slate-100 mx-2 my-1"></div>
                <button className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-[13px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <span>帮助中心</span>
                </button>
              </div>

              {/* 退出登录按钮 */}
              <div className="p-2 border-t border-slate-100 bg-slate-50/50">
                {logic.currentUser.isGuest ? (
                  <button
                    onClick={() => { setIsProfileOpen(false); setIsLoginOpen(true); }}
                    className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-[13px] font-black text-blue-600 hover:bg-blue-50 transition-all uppercase tracking-widest"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                    <span>登录系统</span>
                  </button>
                ) : (
                  <button
                    onClick={() => { setIsProfileOpen(false); logic.handleLogout(); }}
                    className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-[13px] font-black text-red-500 hover:bg-red-50 transition-all uppercase tracking-widest"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                    <span>退出登录</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );

  const renderSolutionSidebar = () => (
    <div
      style={{ width: `${solutionSidebarWidth}px` }}
      className={`${theme.lightBg} border-r border-slate-200 flex flex-col shrink-0 min-h-0 h-full overflow-hidden`}
    >
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5 flex flex-col space-y-2.5">
        <div className="bg-white p-2.5 rounded-lg shadow-sm border border-slate-100 space-y-1.5">
          <div className="flex items-center justify-between border-b pb-1">
            <h3 className={`text-[13px] font-black ${themeText} uppercase tracking-widest`}>项目名称</h3>
            <span className="text-[13px] font-bold text-slate-400">用于导出文档</span>
          </div>
          <input
            type="text"
            value={logic.designState.projectName}
            onChange={e => logic.handleUpdateProjectName(e.target.value)}
            placeholder="请输入项目名称..."
            className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1.5 text-[13px] font-bold ${themeText} outline-none focus:bg-white focus:ring-1 focus:ring-opacity-20 ring-${theme.color}`}
          />
        </div>

        <div className={isBlueprintLocked ? 'pointer-events-none opacity-60' : ''}>
          <div className="bg-slate-200/40 p-0.5 rounded-lg flex border border-slate-200 shadow-inner">
            <button
              onClick={() => logic.handleParamChange('scenario', Scenario.MEETING_ROOM)}
              className={`flex-1 py-1 rounded-md text-[12px] font-bold transition-all ${logic.designState.scenario === Scenario.MEETING_ROOM ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
            >
              会议室
            </button>
            <button
              onClick={() => logic.handleParamChange('scenario', Scenario.LECTURE_HALL)}
              className={`flex-1 py-1 rounded-md text-[12px] font-bold transition-all ${logic.designState.scenario === Scenario.LECTURE_HALL ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500'}`}
            >
              报告厅
            </button>
          </div>
          <div className="bg-white p-2.5 rounded-lg shadow-sm border border-slate-100 space-y-1.5 mt-2.5">
            <h3 className="text-[13px] font-black text-slate-400 uppercase tracking-widest border-b pb-1">物理参数 (M)</h3>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[13px] text-slate-400 font-bold mb-0.5 block">房间长</label>
                <input type="number" value={logic.designState.params.length} onChange={e => logic.handleParamChange('length', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[13px] font-bold ${themeText} outline-none focus:bg-white focus:ring-1 focus:ring-opacity-20 ring-${theme.color}`} />
              </div>
              <div>
                <label className="text-[13px] text-slate-400 font-bold mb-0.5 block">房间宽</label>
                <input type="number" value={logic.designState.params.width} onChange={e => logic.handleParamChange('width', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[13px] font-bold ${themeText} outline-none focus:bg-white focus:ring-1 focus:ring-opacity-20 ring-${theme.color}`} />
              </div>
              <div className="col-span-2">
                <label className="text-[13px] text-slate-400 font-bold mb-0.5 block">安装高度</label>
                <input type="number" value={logic.designState.params.height} onChange={e => logic.handleParamChange('height', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[13px] font-bold ${themeText} outline-none focus:bg-white focus:ring-1 focus:ring-opacity-20 ring-${theme.color}`} />
              </div>

              {logic.designState.scenario === Scenario.LECTURE_HALL && (
                <div className="col-span-2 grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-50">
                  <div>
                    <label className="text-[13px] text-slate-400 font-bold mb-0.5 block leading-tight">台口至最近</label>
                    <input type="number" value={logic.designState.params.stageToNearAudience} onChange={e => logic.handleParamChange('stageToNearAudience', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[13px] font-bold outline-none ${themeText}`} />
                  </div>
                  <div>
                    <label className="text-[13px] text-slate-400 font-bold mb-0.5 block leading-tight">台口至最远</label>
                    <input type="number" value={logic.designState.params.stageToFarAudience} onChange={e => logic.handleParamChange('stageToFarAudience', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[13px] font-bold outline-none ${themeText}`} />
                  </div>
                  <div>
                    <label className="text-[13px] text-slate-400 font-bold mb-0.5 block leading-tight">台口宽度</label>
                    <input type="number" value={logic.designState.params.stageWidth} onChange={e => logic.handleParamChange('stageWidth', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[13px] font-bold outline-none ${themeText}`} />
                  </div>
                  <div>
                    <label className="text-[13px] text-slate-400 font-bold mb-0.5 block leading-tight">舞台深度</label>
                    <input type="number" value={logic.designState.params.stageDepth} onChange={e => logic.handleParamChange('stageDepth', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[13px] font-bold outline-none ${themeText}`} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-lg shadow-sm border border-slate-100 space-y-1.5 mt-2.5">
            <div className="flex items-center justify-between border-b pb-1">
              <h3 className={`text-[13px] font-black ${themeText} uppercase tracking-widest`}>话筒配置</h3>
              <button
                onClick={logic.addMic}
                disabled={logic.micTypeOptions.length === 0}
                className={`text-[13px] font-black px-1.5 py-0.5 rounded border ${themeText} ${themeBorder} bg-slate-50 hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                + 添加
              </button>
            </div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {(logic.designState.params.mics || []).map(m => (
                <div key={m.id} className="flex items-center space-x-1.5 group">
                  <select
                    value={logic.micTypeOptions.includes(m.type) ? m.type : ''}
                    onChange={e => logic.handleParamChange('mics', (logic.designState.params.mics || []).map(mic => mic.id === m.id ? { ...mic, type: e.target.value } : mic))}
                    className="flex-1 bg-slate-50 border border-slate-100 rounded px-1.5 py-1 text-[12px] font-bold outline-none"
                  >
                    {logic.micTypeOptions.length === 0 && (
                      <option value="" disabled>数据库暂无话筒产品</option>
                    )}
                    {logic.micTypeOptions.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <input type="number" value={m.count} onChange={e => logic.handleMicChange(m.id, parseInt(e.target.value))} className={`w-7 bg-white border border-slate-200 rounded py-1 text-center text-[12px] font-bold ${themeText} outline-none`} />
                  <button onClick={() => logic.removeMic(m.id)} className="text-slate-300 hover:text-red-500 text-[13px] px-0.5">✕</button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-lg shadow-sm border border-slate-100 space-y-1.5 mt-2.5">
            <h3 className="text-[13px] font-black text-slate-400 border-b pb-1 uppercase tracking-widest">配套子系统</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'hasCentralControl', l: '中控' }, { id: 'hasMatrix', l: '矩阵' }, { id: 'hasVideoConf', l: '视频' }, { id: 'hasRecording', l: '录播' }
              ].map(sys => (
                <label key={sys.id} className="flex items-center space-x-1.5 bg-slate-50/50 p-1.5 rounded border border-slate-100 cursor-pointer hover:bg-white transition-all">
                  <input type="checkbox" checked={(logic.designState.params as any)[sys.id]} onChange={e => logic.handleParamChange(sys.id as any, e.target.checked)} className={`w-3 h-3 rounded accent-${theme.color.split('-')[0]}`} />
                  <span className="text-[13px] font-bold text-slate-600">{sys.l}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-lg shadow-sm border border-slate-100 space-y-1.5 flex-1 mt-2.5">
            <h3 className="text-[13px] font-black text-slate-400 border-b pb-1 uppercase tracking-widest">其他需求</h3>
            <textarea
              value={logic.designState.params.extraRequirements}
              onChange={e => logic.handleParamChange('extraRequirements', e.target.value)}
              placeholder="补充品牌偏好等..."
              className="w-full bg-slate-50 border border-slate-100 rounded px-2 py-1.5 text-[12px] font-medium outline-none h-12 resize-none focus:bg-white transition-all"
            />
          </div>
        </div>

        <div className="bg-white p-2.5 rounded-lg shadow-sm border border-slate-100 space-y-1.5">
          <h3 className="text-[13px] font-black text-slate-400 border-b pb-1 uppercase tracking-widest">环境图纸</h3>
          <label className="flex flex-col items-center justify-center w-full h-12 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-all">
            <div className="flex flex-col items-center justify-center">
              <svg className="w-4 h-4 text-slate-400 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
              <p className="text-[13px] text-slate-500 font-bold uppercase">上传 CAD 图纸 (JPG/PNG)</p>
            </div>
            <input type="file" className="hidden" accept="image/*" onChange={logic.handleBlueprintUpload} />
          </label>
        </div>
      </div>
      <div className="p-2.5 pt-0">
        <button onClick={logic.startDesign} disabled={logic.isProcessingAi} className={`${glassPrimaryButtonClass} w-full h-10 font-bold text-[13px] shrink-0 uppercase tracking-widest`}>
          {logic.isProcessingAi ? '生成中...' : '启动方案设计'}
        </button>
      </div>
    </div>
  );

  const renderSolutionView = () => (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      {!logic.designState.isDesigned ? (
        isBlueprintLocked ? (
          <div className="flex-1 flex flex-col p-5 overflow-hidden">
            <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl shadow-inner relative overflow-hidden">
              {logic.designState.blueprint && (
                <img
                  src={logic.designState.blueprint}
                  alt="CAD 预览"
                  className={`absolute inset-0 w-full h-full object-contain transition-all ${logic.isProcessingAi ? 'grayscale opacity-40' : 'opacity-90'}`}
                />
              )}
              {logic.isProcessingAi && (
                <div className="absolute inset-0 bg-white/70 flex flex-col items-center justify-center">
                  <div className="flex flex-col items-center justify-center">
                    <lottie-player
                      src="https://assets2.lottiefiles.com/packages/lf20_qm8eqzse.json"
                      background="transparent"
                      speed="1"
                      style={{ width: '320px', height: '320px' }}
                      loop
                      autoplay
                    ></lottie-player>
                    <div className="text-[18px] text-slate-700 font-semibold mt-2">正在为您定制音频方案...</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : logic.isProcessingAi ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <div className="flex flex-col items-center justify-center">
              <lottie-player
                src="https://assets2.lottiefiles.com/packages/lf20_qm8eqzse.json"
                background="transparent"
                speed="1"
                style={{ width: '320px', height: '320px' }}
                loop
                autoplay
              ></lottie-player>
              <div className="text-[18px] text-slate-700 font-semibold mt-2">正在为您定制音频方案...</div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 opacity-10">
            <div className="text-7xl mb-6">📐</div>
            <h2 className="text-lg font-black uppercase tracking-[0.4em] text-center">输入参数开启智能设计方案</h2>
          </div>
        )
      ) : (
        <div className="flex-1 flex flex-col p-5 space-y-4 overflow-y-auto">
          <div className="flex justify-between items-center border-b pb-3 shrink-0">
            <div className="flex items-center space-x-3">
              <div className="flex items-baseline space-x-2">
                <h2 className="text-xl font-black text-slate-900 tracking-tighter uppercase leading-none shrink-0">设计看板</h2>
                <div className="flex items-center group relative cursor-pointer" onClick={() => setIsEditingProjectName(true)}>
                  {isEditingProjectName ? (
                    <input
                      autoFocus
                      type="text"
                      value={logic.designState.projectName}
                      onBlur={() => setIsEditingProjectName(false)}
                      onKeyDown={e => { if (e.key === 'Enter') setIsEditingProjectName(false); }}
                      onChange={e => logic.handleUpdateProjectName(e.target.value)}
                      className="text-[13px] font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded outline-none border border-slate-200"
                    />
                  ) : (
                    <>
                      <span className="text-slate-500 text-[13px] font-bold tracking-tight bg-slate-50 px-2 py-0.5 rounded border border-transparent group-hover:border-slate-200 transition-all">
                        {logic.designState.projectName}
                      </span>
                      <svg className="w-3 h-3 ml-1 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                {/* 动态导出按钮逻辑 */}
                {logic.currentResultTab === ResultTab.PLAN ? (
                  <>
                    {(hasExcelExport || hasPdfExport) && (
                      <div className="flex items-center space-x-2 animate-in fade-in slide-in-from-right-2 duration-300">
                        {hasExcelExport && (
                          <button
                            onClick={() => {
                              if (logic.designState.results.length > 1) {
                                setExportDialogType('EXCEL');
                              } else {
                                logic.handleDownload('EXCEL', 'CURRENT');
                              }
                            }}
                            className={`${glassButtonClass} space-x-2 px-3 h-9 font-bold text-[13px] uppercase`}
                          >
                            <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                            <span>导出清单</span>
                          </button>
                        )}
                        {hasPdfExport && (
                          <button
                            onClick={() => {
                              if (logic.designState.results.length > 1) {
                                setExportDialogType('PDF');
                              } else {
                                logic.handleDownload('PDF', 'CURRENT');
                              }
                            }}
                            disabled={isReportGenerating}
                            className={`${glassButtonClass} space-x-2 px-3 h-9 font-bold text-[13px] uppercase`}
                          >
                            <svg className="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                            <span>{isReportGenerating ? '生成中...' : '导出方案'}</span>
                          </button>
                        )}
                        {hasGeneratedReport && (
                          <button
                            onClick={() => logic.copyMarkdown('CURRENT')}
                            className={`${glassButtonClass} space-x-2 px-3 h-9 font-bold text-[13px] uppercase`}
                          >
                            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2M8 16h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                            <span>复制 Markdown</span>
                          </button>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => setShowReportDialog(true)}
                      disabled={logic.isGeneratingDocs || reportUpToDate || !activeResult}
                      className={`${glassPrimaryButtonClass} space-x-2 px-4 h-9 font-black text-[13px] uppercase active:scale-95`}
                    >
                      {logic.isGeneratingDocs ? (
                        <>
                          <div className="w-3 h-3 border-2 border-slate-300 border-t-white rounded-full animate-spin"></div>
                          <span>生成中...</span>
                        </>
                      ) : reportUpToDate ? (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
                          <span>报告已生成</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                          <span>生成正式报告</span>
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => logic.handleDownload('PNG')}
                    className={`${glassButtonClass} space-x-2 px-4 h-9 font-black text-[13px] uppercase active:scale-95 animate-in fade-in slide-in-from-right-2 duration-300`}
                  >
                    <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    <span>下载仿真图 (PNG)</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3 flex-1 flex flex-col">
            <div className="flex justify-between items-center shrink-0">
              <div className="flex flex-col space-y-1">
                <div className="max-w-[60vw] overflow-x-auto pb-1">
                  <div className="flex space-x-1 min-w-max">
                    {logic.designState.results.map((res, idx) => (
                      <button
                        key={res.id}
                        onClick={() => { logic.setDesignState(prev => ({ ...prev, activeResultIndex: idx })); }}
                        className={`px-3 py-1.5 rounded-md text-[13px] font-black transition-all whitespace-nowrap ${logic.designState.activeResultIndex === idx ? `bg-slate-900 text-white shadow-md` : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                      >
                        {res.title}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-[13px] font-black text-slate-500 uppercase tracking-widest py-1">
                  总价：<span className="text-slate-900">¥{activeTotalPrice.toLocaleString()}</span>
                </div>
              </div>
              <div className="bg-slate-50 p-0.5 rounded-md border border-slate-200 flex items-center h-8">
                {/* 切换放置在每个方案之下，体现它是针对当前方案的属性 */}
                <button onClick={() => logic.setCurrentResultTab(ResultTab.PLAN)} className={`px-3 h-7 rounded-sm text-[13px] font-bold transition-all ${logic.currentResultTab === ResultTab.PLAN ? `bg-white ${themeText} shadow-sm` : 'text-slate-400'}`}>方案明细</button>
                <button onClick={() => logic.setCurrentResultTab(ResultTab.SIMULATION)} className={`px-3 h-7 rounded-sm text-[13px] font-bold transition-all ${logic.currentResultTab === ResultTab.SIMULATION ? `bg-white ${themeText} shadow-sm` : 'text-slate-400'}`}>声学仿真</button>
              </div>
            </div>

            {logic.currentResultTab === ResultTab.PLAN ? (
              <div className="flex-1 flex flex-col space-y-3">
                <div className="flex justify-end">
                  <div className="bg-slate-100/50 p-0.5 rounded-md border border-slate-200 flex items-center h-8">
                    <button onClick={() => setActiveResultView('TABLE')} className={`px-3 h-7 rounded-sm text-[13px] font-bold transition-all ${activeResultView === 'TABLE' ? `bg-white ${themeText} shadow-sm` : 'text-slate-400'}`}>数据清单</button>
                    {/* 方案预览仅在生成后显示 */}
                    {canPreviewReport && (
                      <button onClick={() => setActiveResultView('WORD')} className={`px-3 h-7 rounded-sm text-[13px] font-bold transition-all animate-in zoom-in-95 duration-200 ${activeResultView === 'WORD' ? `bg-white ${themeText} shadow-sm` : 'text-slate-400'}`}>方案预览</button>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col relative flex-1">
                  {activeResultView === 'TABLE' ? (
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-left text-[13px]">
                        <thead className="sticky top-0 bg-slate-50 z-10 border-b">
                          <tr>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter">设备分类</th>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter">品牌</th>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter">产品名称</th>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter">型号规格</th>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter text-center">数量</th>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter text-right">单价</th>
                            <th className="px-5 py-2.5 text-right pr-5 font-bold text-slate-400 uppercase tracking-tighter">管理操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {activeResult?.items.map((item, idx) => (
                            <tr
                              key={item.id}
                              className={`${item.recentlyUpdated ? 'bg-amber-100/40 hover:bg-amber-100/50' : 'hover:bg-slate-50/50'} transition-all group`}
                            >
                              <td className="px-5 py-2.5 text-slate-500 font-medium">{item.type}</td>
                              <td className="px-5 py-2.5 text-slate-600 font-bold">{getItemBrand(item) || '--'}</td>
                              <td className="px-5 py-2.5 font-bold text-slate-900">
                                <div className="flex items-center gap-2">
                                  <span>{item.name}</span>
                                  {item.inventoryMatched === false && (
                                    <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-rose-100 text-rose-700 border border-rose-200">
                                      {item.inventoryMatchNote || '未匹配到库存'}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-5 py-2.5 text-slate-400 font-mono text-[13px]">{item.model}</td>
                              <td className="px-5 py-2.5 text-center">
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.quantity}
                                  onChange={(e) => {
                                    if (isLineArraySupportChildItem(item)) {
                                      alert('该设备为线阵列音箱配套设备，请修改对应线阵列音箱型号。');
                                      return;
                                    }
                                    const nextQuantity = Number(e.target.value);
                                    logic.setDesignState((prev) => {
                                      const newResults = [...prev.results];
                                      const targetResult = newResults[prev.activeResultIndex];
                                      if (!targetResult) return prev;
                                      const nextItems = [...targetResult.items];
                                      nextItems[idx] = {
                                        ...nextItems[idx],
                                        quantity: Number.isFinite(nextQuantity) ? Math.max(0, Math.floor(nextQuantity)) : 0,
                                        recentlyUpdated: true
                                      };
                                      newResults[prev.activeResultIndex] = {
                                        ...targetResult,
                                        items: nextItems
                                      };
                                      return { ...prev, results: newResults };
                                    });
                                  }}
                                  className={`w-16 bg-white border border-slate-200 rounded px-2 py-1 text-center text-[13px] font-black ${themeText} outline-none focus:ring-1 focus:ring-slate-300`}
                                />
                              </td>
                              <td className="px-5 py-2.5 text-right font-black text-slate-700">¥{getItemUnitPrice(item).toLocaleString()}</td>
                              <td className="px-5 py-2.5 text-right space-x-3 pr-5">
                                <button
                                  onClick={async () => {
                                    const table = resolvePlanItemTable(item.type);

                                    if (table) {
                                      await logic.ensureInventoryOptions(table);
                                    }

                                    const detail = await logic.fetchEquipmentDetail(item);
                                    setDetailDialog({ resIdx: logic.designState.activeResultIndex, itemIdx: idx, item: { ...item }, detail, table });
                                    setReplacementId(detail?.id || '');
                                  }}
                                  className="text-slate-500 font-bold hover:underline"
                                >
                                  详细
                                </button>
                                <button
                                  onClick={async () => {
                                    const table = resolvePlanItemTable(item.type);
                                    const currentDetail = await logic.fetchEquipmentDetail(item);
                                    if (isLineArraySupportChildItem(item) || (Number(currentDetail?.main_id || 0) > 0 && isLineArraySupportChildType(String(currentDetail?.用途 || currentDetail?.类型 || item.type)))) {
                                      alert('该设备为线阵列音箱配套设备，必须通过修改线阵列音箱来联动更新。');
                                      return;
                                    }
                                    const targetDetailType = String(currentDetail?.类型 || currentDetail?.产品类型 || item.type || '').trim();
                                    let options: DbInventoryItem[] = [];
                                    let nextLinkedUpdates: LinkedPlanUpdate[] = [];

                                    if (table) {
                                      await logic.ensureInventoryOptions(table);
                                      options = logic.getInventoryOptions(table);
                                      if (targetDetailType) {
                                        options = options.filter((opt) => {
                                          const rowType = String(opt.类型 || opt.产品类型 || '').trim();
                                          if (!rowType) return false;
                                          return isSameReplacementCategory(targetDetailType, rowType);
                                        });
                                      }

                                      if (isAmplifierPlanType(item.type)) {
                                        const currentItems = activeResult?.items || [];
                                        const pairedSpeakerIdx = findPairedSpeakerIndex(currentItems, idx);
                                        if (pairedSpeakerIdx >= 0) {
                                          const pairedSpeaker = currentItems[pairedSpeakerIdx];
                                          try {
                                            const analysis = await logic.analyzeAmplifierMatch({
                                              scenario: logic.designState.scenario,
                                              speaker: {
                                                model: pairedSpeaker.model,
                                                name: pairedSpeaker.name,
                                                quantity: pairedSpeaker.quantity
                                              }
                                            });

                                            const recommendationMap = new Map<string, any>();
                                            const recommendedList = Array.isArray(analysis?.recommended) ? analysis.recommended : [];
                                            recommendedList.forEach((entry: any) => {
                                              const model = String(entry?.model || '').trim();
                                              if (!model || recommendationMap.has(model)) return;
                                              recommendationMap.set(model, entry);
                                            });

                                            options = options
                                              .filter((opt) => recommendationMap.has(String(opt.型号 || '').trim()))
                                              .map((opt) => {
                                                const model = String(opt.型号 || '').trim();
                                                const rec = recommendationMap.get(model);
                                                return {
                                                  ...opt,
                                                  推荐数量: Number(rec?.requiredQuantity || 0),
                                                  匹配模式: String(rec?.mode || '')
                                                } as DbInventoryItem;
                                              });
                                          } catch (error) {
                                            console.error('❌ Failed to filter compatible amplifiers:', error);
                                          }
                                        }
                                      }
                                    }

                                    setEditingOptions(options);
                                    setPendingLinkedUpdates(nextLinkedUpdates);
                                    setAmpRecommendationPrompt(null);
                                    setIsReplacementPickerOpen(false);
                                    logic.setEditingItem({ resIdx: logic.designState.activeResultIndex, itemIdx: idx, item: { ...item } });
                                  }}
                                  className={`${themeText} font-bold hover:underline`}
                                >
                                  编辑
                                </button>
                                <button
                                  onClick={() => {
                                    if (isLineArraySupportChildItem(item)) {
                                      alert('该设备为线阵列音箱配套设备，必须通过修改线阵列音箱来联动更新。');
                                      return;
                                    }
                                    logic.deleteItem(logic.designState.activeResultIndex, idx);
                                  }}
                                  className="text-slate-300 hover:text-red-500 font-bold"
                                >
                                  删除
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="flex-1 p-6 overflow-y-auto bg-slate-50/30">
                      <div className="max-w-5xl mx-auto bg-white shadow-xl border border-slate-100 rounded-lg p-6 space-y-4 animate-in fade-in zoom-in-95 duration-300">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                          <h1 className="text-lg font-black text-slate-900 tracking-tight uppercase">方案预览</h1>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => logic.copyMarkdown('CURRENT')}
                              disabled={!hasGeneratedReport}
                              className={`${glassButtonClass} px-3 h-9 text-[13px] font-black uppercase`}
                            >
                              复制 Markdown
                            </button>
                            <button
                              onClick={() => logic.handleDownload('PDF', 'CURRENT')}
                              disabled={!hasGeneratedReport || isReportGenerating}
                              className={`${glassButtonClass} px-3 h-9 text-[13px] font-black uppercase`}
                            >
                              {isReportGenerating ? '方案生成中...' : '下载 PDF'}
                            </button>
                          </div>
                        </div>
                        {canPreviewReport ? (
                          <>
                            {activeResult?.reportGenerationError && (
                              <div className="px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-[13px] text-rose-700 font-bold">
                                {activeResult.reportGenerationError}
                              </div>
                            )}
                            {renderProgressiveReport(activeResult)}
                          </>
                        ) : (
                          <div className="aspect-[1/1.41] bg-slate-50 border border-dashed border-slate-200 rounded flex flex-col items-center justify-center text-slate-300 font-black text-[12px] uppercase tracking-[0.5em] space-y-4">
                            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-200">
                              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                            </div>
                            <span>未获取到可预览报告</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden relative shadow-inner min-h-[350px]">
                {/* 每个方案传入自己的 items */}
                <Visualization
                  params={logic.designState.params}
                  scenario={logic.designState.scenario}
                  blueprint={logic.designState.blueprint}
                  items={activeResult?.items}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 生成文档选择对话框 */}
      {showReportDialog && (
        <div className="fixed inset-0 z-[300] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="bg-white w-full max-sm rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">生成正式报告</h3>
              <button onClick={() => setShowReportDialog(false)} className="text-slate-300 hover:text-slate-900 transition-colors">✕</button>
            </div>
            <p className="text-[13px] text-slate-500 font-medium">请选择需要转换成正式方案文档的范围：</p>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => { logic.handleGenerateReports('CURRENT'); setShowReportDialog(false); }}
                disabled={logic.isGeneratingDocs || !activeResult}
                className={`glass-btn flex flex-col items-start p-4 rounded-xl transition-all group ${logic.isGeneratingDocs || !activeResult ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className="text-[13px] font-black text-slate-900 group-hover:text-blue-600">方案：{activeResult?.title} (仅当前)</span>
                <span className="text-[13px] text-slate-400 mt-1">仅针对当前选中的推荐方案生成正式文档并开启预览/下载。</span>
              </button>
              <button
                onClick={() => { logic.handleGenerateReports('ALL'); setShowReportDialog(false); }}
                disabled={logic.isGeneratingDocs || logic.designState.results.length === 0}
                className={`glass-btn flex flex-col items-start p-4 rounded-xl transition-all group ${logic.isGeneratingDocs || logic.designState.results.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className="text-[13px] font-black text-slate-900 group-hover:text-blue-600">所有推荐方案 (共 {logic.designState.results.length} 个)</span>
                <span className="text-[13px] text-slate-400 mt-1">对本次设计出的所有备选方案同时生成正式文档并开启预览/下载。</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {exportDialogType && (
        <div className="fixed inset-0 z-[310] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="bg-white w-full max-sm rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                {exportDialogType === 'EXCEL' ? '导出清单' : '导出方案'}
              </h3>
              <button onClick={() => setExportDialogType(null)} className="text-slate-300 hover:text-slate-900 transition-colors">✕</button>
            </div>
            <p className="text-[13px] text-slate-500 font-medium">请选择导出范围：</p>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => { logic.handleDownload(exportDialogType, 'CURRENT'); setExportDialogType(null); }}
                className="glass-btn flex flex-col items-start p-4 rounded-xl transition-all group"
              >
                <span className="text-[13px] font-black text-slate-900 group-hover:text-blue-600">仅当前方案：{activeResult?.title}</span>
                <span className="text-[13px] text-slate-400 mt-1">只导出当前选中方案。</span>
              </button>
              <button
                onClick={() => { logic.handleDownload(exportDialogType, 'ALL'); setExportDialogType(null); }}
                className="glass-btn flex flex-col items-start p-4 rounded-xl transition-all group"
              >
                <span className="text-[13px] font-black text-slate-900 group-hover:text-blue-600">全部方案 (共 {logic.designState.results.length} 个)</span>
                <span className="text-[13px] text-slate-400 mt-1">同时导出所有方案。</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed -left-[10000px] top-0 w-[794px] opacity-0 pointer-events-none">
        {logic.designState.results.map((res) => {
          const previewMarkdown = res.markdownProcessed || res.markdownRaw || '';
          if (!previewMarkdown) return null;
          return (
            <article
              key={`print-${res.id}`}
              id={`report-print-${res.id}`}
              className="markdown-report bg-white p-8"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>{previewMarkdown}</ReactMarkdown>
            </article>
          );
        })}
      </div>
    </div>
  );

  const renderManagementView = () => (
    <div className="flex-1 flex overflow-hidden bg-slate-50">
      <aside className="w-60 bg-white border-r border-slate-200 flex flex-col p-4 shrink-0 min-h-0">
        <h2 className="text-xs font-black text-slate-700 uppercase tracking-[0.16em] mb-4 px-2">资源目录</h2>
        <nav className="space-y-1.5 flex-1 min-h-0 overflow-y-auto pr-1">
          {MANAGEMENT_TABLES.map((t) => (
            <button
              key={t}
              onClick={() => logic.setActiveTable(t)}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-[13px] font-bold transition-all border ${logic.activeTable === t
                ? managementTheme.activeNav
                : 'text-slate-600 border-transparent hover:bg-slate-100 hover:border-slate-200'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </aside>

      <section className="flex-1 flex flex-col min-w-0">
        <div className="px-6 py-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tight">{logic.activeTable}</h2>
            <p className="text-[12px] text-slate-500 font-semibold">资源列表与编辑管理</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-slate-500 font-semibold mr-1">已选 {selectedVisibleInventoryCount} 条</span>
            <button
              onClick={handleBatchDeleteInventory}
              disabled={selectedVisibleInventoryCount === 0}
              className={`px-4 h-10 rounded-xl text-[13px] font-black tracking-wide active:scale-[0.98] transition-all border ${selectedVisibleInventoryCount === 0 ? 'border-slate-200 text-slate-300 bg-slate-100 cursor-not-allowed' : 'border-red-200 text-red-600 bg-red-50 hover:bg-red-100'}`}
            >
              批量删除
            </button>
            {isAdminUser && (
              <button
                onClick={() => {
                  ensureTableColumnPreference(logic.activeTable, getBaseDisplayColumns(logic.activeTable, logic.inventory));
                  setIsColumnConfigOpen(true);
                }}
                className={`px-4 h-10 rounded-xl text-[13px] font-black tracking-wide active:scale-[0.98] transition-all border ${managementTheme.softBtn}`}
              >
                列设置
              </button>
            )}
            <button
              onClick={() => setIsAddingEq(true)}
              className={`px-4 h-10 rounded-xl text-white text-[13px] font-black tracking-wide active:scale-[0.98] transition-all ${managementTheme.primaryBtn}`}
            >
              + 录入数据
            </button>
          </div>
        </div>

        <div className="px-6 py-4 bg-white border-b border-slate-200">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="text-[12px] font-black text-slate-500 uppercase tracking-wide">筛选框 1：品牌 / 产品类型</div>
                <input
                  value={logic.searchFilters.品牌}
                  onChange={e => logic.setSearchFilters(prev => ({ ...prev, 品牌: e.target.value }))}
                  placeholder="输入品牌关键词"
                  className={`w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] font-semibold outline-none focus:ring-2 ${managementTheme.focusRing}`}
                />
                <select
                  value={logic.searchFilters.产品类型}
                  onChange={e => logic.setSearchFilters(prev => ({ ...prev, 产品类型: e.target.value }))}
                  className={`w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] font-semibold outline-none focus:ring-2 ${managementTheme.focusRing}`}
                >
                  <option value="">产品类型：全部</option>
                  {productTypeFilterOptions.map((opt) => (
                    <option key={`filter-type-${opt}`} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="text-[12px] font-black text-slate-500 uppercase tracking-wide">筛选框 2：市场价格区间</div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min="0"
                    value={logic.searchFilters.市场价最小值}
                    onChange={e => logic.setSearchFilters(prev => ({ ...prev, 市场价最小值: e.target.value }))}
                    placeholder="最小价格"
                    className={`w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] font-semibold outline-none focus:ring-2 ${managementTheme.focusRing}`}
                  />
                  <input
                    type="number"
                    min="0"
                    value={logic.searchFilters.市场价最大值}
                    onChange={e => logic.setSearchFilters(prev => ({ ...prev, 市场价最大值: e.target.value }))}
                    placeholder="最大价格"
                    className={`w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] font-semibold outline-none focus:ring-2 ${managementTheme.focusRing}`}
                  />
                </div>
              </div>
            </div>

            <div className="text-[12px] text-slate-500 font-semibold flex items-center justify-end gap-3 pr-1 shrink-0">
              <span>共 {logic.inventory.length} 条</span>
              <button
                type="button"
                onClick={() => logic.setSearchFilters(prev => ({
                  ...prev,
                  品牌: '',
                  产品类型: '',
                  市场价最小值: '',
                  市场价最大值: ''
                }))}
                className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 font-bold hover:bg-slate-50"
              >
                清空筛选
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-6 py-5">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
            <table className="w-full text-[13px] table-fixed">
              <thead className="sticky top-0 bg-slate-100/90 backdrop-blur border-b border-slate-200 z-10">
                <tr>
                  <th className="w-12 px-2 py-3.5 text-center">
                    <input
                      ref={selectAllInventoryRef}
                      type="checkbox"
                      checked={isAllVisibleInventorySelected}
                      disabled={visibleInventoryIds.length === 0}
                      onChange={(e) => toggleSelectAllInventoryRows(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-300"
                    />
                  </th>
                  {getDisplayColumns(logic.activeTable, logic.inventory).map((col) => (
                    <th
                      key={col}
                      className={`px-4 py-3.5 font-black text-slate-700 ${col === '序号' ? 'w-20 text-center' : 'text-left'}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className={`inline-flex items-center ${col === '序号' ? 'justify-center w-full' : ''}`}
                      >
                        {getDisplayColumnLabel(logic.activeTable, col)}
                        {renderSortArrow(col)}
                      </button>
                    </th>
                  ))}
                  <th className="w-44 px-4 py-3.5 text-center font-black text-slate-700">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logic.inventory.map((item, rowIndex) => (
                  <tr key={`${item.id}-${rowIndex}`} className={`${managementTheme.rowHover} transition-colors`}>
                    <td className="px-2 py-3 align-middle text-center">
                      <input
                        type="checkbox"
                        checked={selectedInventoryIds.has(Number(item.id))}
                        onChange={(e) => toggleInventoryRowSelection(Number(item.id), e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-300"
                      />
                    </td>
                    {getDisplayColumns(logic.activeTable, logic.inventory).map((col) => {
                      const rawValue = col === '序号'
                        ? ((item as any).序号 ?? rowIndex + 1)
                        : (item as any)[col];

                      if (imageColumnSet.has(col)) {
                        const src = String(rawValue || '').trim();
                        return (
                          <td key={`${item.id}-${col}`} className="px-4 py-3 align-middle text-center">
                            {src ? (
                              <button
                                onClick={() => setPreviewImage({ src, title: `${(item as any).产品名称 || (item as any).图片名称 || '图片预览'} - ${col}` })}
                                className={`inline-flex items-center justify-center h-8 px-3 rounded-lg text-[12px] font-bold transition-colors border ${managementTheme.softBtn}`}
                              >
                                预览图片
                              </button>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                        );
                      }

                      const displayValue = Array.isArray(rawValue) ? rawValue.join(' / ') : (rawValue ?? '');
                      const alignClass = getColumnAlignmentClass(col);
                      const isEmphasis = col === '型号' || col === '市场价' || col.includes('价');
                      const formatted = (col === '市场价' && displayValue !== '' && Number.isFinite(Number(displayValue)))
                        ? `¥${Number(displayValue).toLocaleString()}`
                        : String(displayValue);

                      if (logic.activeTable === TableType.LOCAL_STATIC_RESOURCE && col === '图片名称') {
                        const title = String(formatted || '').trim();
                        return (
                          <td key={`${item.id}-${col}`} className={`px-4 py-3 align-middle text-slate-700 ${alignClass} font-medium`}>
                            {title ? (
                              <button
                                type="button"
                                title="点击查看并编辑资源内容"
                                onClick={() => setEditingEq(item)}
                                className="text-blue-700 hover:text-blue-800 hover:underline font-semibold"
                              >
                                {title}
                              </button>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                        );
                      }

                      return (
                        <td key={`${item.id}-${col}`} className={`px-4 py-3 align-middle text-slate-700 ${alignClass} ${isEmphasis ? 'font-semibold text-slate-900' : 'font-medium'}`}>
                          {formatted || <span className="text-slate-300">-</span>}
                        </td>
                      );
                    })}
                    <td className="w-40 px-4 py-3 align-middle">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setEditingEq(item)}
                          className={`h-8 px-3 rounded-lg border text-[12px] font-bold transition-colors ${managementTheme.softBtn}`}
                        >
                          编辑
                        </button>
                        <button
                          onClick={async () => {
                            if (window.confirm('确定要删除该设备吗？')) {
                              await logic.deleteInventoryItem(logic.activeTable, item.id);
                            }
                          }}
                          className="h-8 px-3 rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 text-[12px] font-bold transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {logic.inventory.length === 0 && (
                  <tr>
                    <td colSpan={getDisplayColumns(logic.activeTable, logic.inventory).length + 2} className="py-16 text-center text-slate-400 font-semibold">
                      暂无数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {isColumnConfigOpen && isAdminUser && (
        <div className="fixed inset-0 z-[620] bg-slate-900/55 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-[15px] font-black text-slate-900">列设置</div>
                <div className="text-[12px] text-slate-500 font-semibold">{logic.activeTable}</div>
              </div>
              <button onClick={() => setIsColumnConfigOpen(false)} className="text-slate-400 hover:text-slate-900 text-xl">✕</button>
            </div>

            <div className="p-4 space-y-3 max-h-[65vh] overflow-y-auto">
              {(() => {
                const allColumns = getBaseDisplayColumns(logic.activeTable, logic.inventory).filter((col) => col !== '序号');
                const current = columnPreferences[logic.activeTable] || { order: allColumns, visible: allColumns };
                const ordered = [
                  ...current.order.filter((col) => allColumns.includes(col)),
                  ...allColumns.filter((col) => !current.order.includes(col))
                ];
                const visibleSet = new Set((current.visible || []).length > 0 ? current.visible : ordered);

                return ordered.map((col, idx) => (
                  <div key={`column-setting-${col}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <label className="inline-flex items-center gap-2 text-[13px] font-bold text-slate-700 flex-1">
                      <input
                        type="checkbox"
                        checked={visibleSet.has(col)}
                        onChange={(e) => {
                          setColumnPreferences((prev) => {
                            const existing = prev[logic.activeTable] || { order: ordered, visible: ordered };
                            const nextVisible = new Set((existing.visible || []).length > 0 ? existing.visible : ordered);
                            if (e.target.checked) {
                              nextVisible.add(col);
                            } else {
                              nextVisible.delete(col);
                            }
                            return {
                              ...prev,
                              [logic.activeTable]: {
                                order: existing.order,
                                visible: Array.from(nextVisible)
                              }
                            };
                          });
                        }}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span>{getDisplayColumnLabel(logic.activeTable, col)}</span>
                    </label>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => {
                          setColumnPreferences((prev) => {
                            const existing = prev[logic.activeTable] || { order: ordered, visible: ordered };
                            const nextOrder = [...existing.order];
                            const from = nextOrder.indexOf(col);
                            if (from <= 0) return prev;
                            const to = from - 1;
                            [nextOrder[from], nextOrder[to]] = [nextOrder[to], nextOrder[from]];
                            return {
                              ...prev,
                              [logic.activeTable]: {
                                ...existing,
                                order: nextOrder
                              }
                            };
                          });
                        }}
                        className={`h-7 px-2 rounded-md border text-[12px] font-black ${idx === 0 ? 'border-slate-100 text-slate-300 cursor-not-allowed' : 'border-slate-200 text-slate-600 hover:bg-white'}`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={idx === ordered.length - 1}
                        onClick={() => {
                          setColumnPreferences((prev) => {
                            const existing = prev[logic.activeTable] || { order: ordered, visible: ordered };
                            const nextOrder = [...existing.order];
                            const from = nextOrder.indexOf(col);
                            if (from < 0 || from >= nextOrder.length - 1) return prev;
                            const to = from + 1;
                            [nextOrder[from], nextOrder[to]] = [nextOrder[to], nextOrder[from]];
                            return {
                              ...prev,
                              [logic.activeTable]: {
                                ...existing,
                                order: nextOrder
                              }
                            };
                          });
                        }}
                        className={`h-7 px-2 rounded-md border text-[12px] font-black ${idx === ordered.length - 1 ? 'border-slate-100 text-slate-300 cursor-not-allowed' : 'border-slate-200 text-slate-600 hover:bg-white'}`}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                ));
              })()}
            </div>

            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => {
                  const allColumns = getBaseDisplayColumns(logic.activeTable, logic.inventory).filter((col) => col !== '序号');
                  setColumnPreferences((prev) => ({
                    ...prev,
                    [logic.activeTable]: {
                      order: allColumns,
                      visible: allColumns
                    }
                  }));
                }}
                className="h-9 px-3 rounded-lg border border-slate-200 text-[12px] font-black text-slate-600 hover:bg-white"
              >
                重置默认
              </button>
              <button
                type="button"
                onClick={() => setIsColumnConfigOpen(false)}
                className="h-9 px-3 rounded-lg bg-slate-900 text-white text-[12px] font-black hover:bg-black"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  const renderHistoryView = () => (
    <div className="flex-1 flex flex-col p-6 overflow-hidden bg-white">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">历史设计档案</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">回顾及重新载入之前的设计成果</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-slate-500 font-semibold">已选 {selectedVisibleHistoryCount} 条</span>
          <button
            onClick={handleBatchDeleteHistory}
            disabled={selectedVisibleHistoryCount === 0}
            className={`px-4 h-10 rounded-xl text-[13px] font-black tracking-wide active:scale-[0.98] transition-all border ${selectedVisibleHistoryCount === 0 ? 'border-slate-200 text-slate-300 bg-slate-100 cursor-not-allowed' : 'border-red-200 text-red-600 bg-red-50 hover:bg-red-100'}`}
          >
            批量删除
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm flex flex-col">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 bg-slate-50 border-b z-10">
              <tr>
                <th className="px-4 py-4 text-center">
                  <input
                    ref={selectAllHistoryRef}
                    type="checkbox"
                    checked={isAllVisibleHistorySelected}
                    disabled={visibleHistoryIds.length === 0}
                    onChange={(e) => toggleSelectAllHistoryRows(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-300"
                  />
                </th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">项目名称</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">设计时间</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">场景类型</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">状态</th>
                <th className="px-6 py-4 text-right pr-6 font-black text-slate-400 uppercase tracking-widest">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logic.history.map(h => (
                <tr key={h.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-4 py-4 text-center">
                    <input
                      type="checkbox"
                      checked={selectedHistoryIds.has(Number(h.id))}
                      onChange={(e) => toggleHistoryRowSelection(Number(h.id), e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-300"
                    />
                  </td>
                  <td className="px-6 py-4 font-black text-slate-900">{h.projectName}</td>
                  <td className="px-6 py-4 text-slate-400 font-mono">{new Date(h.createdAt).toISOString().slice(0, 10)}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded-full text-[13px] font-black uppercase ${h.scenario === Scenario.MEETING_ROOM ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
                      }`}>{h.scenario === Scenario.MEETING_ROOM ? '会议室' : '报告厅'}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-1.5">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                      <span className="text-emerald-600 font-bold">已完成</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right pr-6 space-x-4">
                    <button onClick={() => logic.setPreviewHistoryItem(h)} className="text-blue-600 font-black hover:underline uppercase tracking-widest text-[13px]">详情预览</button>
                    <button onClick={() => setEditingHistory(h)} className="text-slate-500 font-black hover:underline uppercase tracking-widest text-[13px]">编辑</button>
                    <button onClick={() => logic.deleteHistoryRecord(h.id)} className="text-red-400 font-black hover:text-red-600 transition-colors uppercase tracking-widest text-[13px]">删除</button>
                  </td>
                </tr>
              ))}
              {logic.history.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-20 text-center text-slate-300 font-black uppercase italic">暂无历史设计记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const buildHistoryPrintDomId = (historyId: number, resultId: string) => `history-report-print-${historyId}-${resultId}`;

  const buildHistoryFallbackMarkdown = (
    historyItem: HistoryRecord,
    scenarioLabel: string,
    params: AcousticParams,
    result: any
  ) => {
    const items = Array.isArray(result?.items) ? result.items : [];
    const micLines = (params.mics || []).map((mic) => `- ${mic.type}：${mic.count} 套`);
    const subsystemLines = [
      params.hasCentralControl ? '中控系统' : null,
      params.hasMatrix ? '矩阵系统' : null,
      params.hasVideoConf ? '视频会议系统' : null,
      params.hasRecording ? '录播系统' : null
    ].filter(Boolean) as string[];

    const tableHeader = '| 设备分类 | 设备名称 | 型号 | 数量 |';
    const tableSplit = '| --- | --- | --- | --- |';
    const tableRows = items.map((it: any) => `| ${it.type || ''} | ${it.name || ''} | ${it.model || ''} | ${it.quantity || 0} |`);

    return [
      `# ${historyItem.projectName} - ${result?.title || '方案'}`,
      '',
      '## 项目概述',
      `本报告来自历史归档记录，场景为${scenarioLabel}。空间参数为长${params.length}m、宽${params.width}m、高${params.height}m。`,
      '',
      '## 系统配置',
      subsystemLines.length > 0 ? subsystemLines.map((x) => `- ${x}`).join('\n') : '- 无额外子系统',
      '',
      '## 话筒配置',
      micLines.length > 0 ? micLines.join('\n') : '- 未配置话筒',
      '',
      '## 设备清单',
      tableHeader,
      tableSplit,
      ...tableRows,
      '',
      '## 说明',
      '该条历史记录未保存完整 Markdown 正文，以上内容由系统按归档参数与设备清单自动回建。'
    ].join('\n');
  };

  const renderHistoryPreview = () => {
    const item = logic.previewHistoryItem!;
    const scenarioLabel = item.scenario === Scenario.MEETING_ROOM ? '会议室' : '报告厅';
    const params: AcousticParams = item.params || {
      length: 0,
      width: 0,
      height: 0,
      stageToNearAudience: 0,
      stageToFarAudience: 0,
      stageWidth: 0,
      stageDepth: 0,
      mics: [],
      hasCentralControl: false,
      hasMatrix: false,
      hasVideoConf: false,
      hasRecording: false,
      micHandheld: 0,
      micGooseneck: 0,
      micOmni: 0,
      micLavalier: 0,
      micCeiling: 0,
      extraRequirements: ''
    };
    const historyResults = Array.isArray(item.results) ? item.results : [];
    const getHistoryMarkdown = (res: any) => {
      const raw = String(res?.markdownProcessed || res?.markdownRaw || '').trim();
      if (raw) return raw;
      return buildHistoryFallbackMarkdown(item, scenarioLabel, params, res);
    };

    const handleHistoryDownload = async (type: 'EXCEL' | 'PDF') => {
      if (type === 'EXCEL') {
        const rows: Array<Record<string, string | number>> = [];
        historyResults.forEach((res: any) => {
          const items = Array.isArray(res?.items) ? res.items : [];
          items.forEach((it: any) => {
            rows.push({
              方案: res?.title || '方案',
              设备分类: it?.type || '',
              品牌: it?.brand || '',
              产品名称: it?.name || '',
              型号: it?.model || '',
              数量: Number(it?.quantity || 0)
            });
          });
        });
        if (rows.length === 0) {
          alert('该历史记录没有可导出的设备清单。');
          return;
        }

        const XLSX = await import('xlsx');
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '设备清单');
        XLSX.writeFile(workbook, `${item.projectName}_历史设备清单.xlsx`);
        return;
      }

      const domIds = historyResults.map((res: any, idx: number) =>
        buildHistoryPrintDomId(item.id, String(res?.id || idx))
      );
      await logic.exportPdfFromDomIds(domIds, `${item.projectName}_历史方案`);
    };

    const handleHistoryCopyMarkdown = async () => {
      const text = historyResults
        .map((res: any) => getHistoryMarkdown(res))
        .filter(Boolean)
        .join('\n\n---\n\n');

      if (!text) {
        alert('该历史记录没有可复制的 Markdown 内容。');
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        alert('历史记录 Markdown 已复制');
      } catch (error) {
        console.error('❌ Copy history markdown failed:', error);
        alert('复制失败，请检查浏览器剪贴板权限。');
      }
    };
    return (
      <div className="fixed inset-0 z-[500] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-6">
        <div className="bg-white w-full max-w-5xl max-h-[90vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight uppercase">{item.projectName}</h2>
              <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">设计归档于 {new Date(item.createdAt).toISOString().slice(0, 10)}</p>
            </div>
            <button onClick={logic.closeHistoryPreview} className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">

        <div className="flex items-center space-x-3 mb-6">
          <button
            onClick={() => handleHistoryDownload('EXCEL')}
            className={`${glassButtonClass} px-4 h-9 text-[13px] font-black uppercase`}
          >
            导出清单
          </button>
          <button
            onClick={() => handleHistoryDownload('PDF')}
            className={`${glassButtonClass} px-4 h-9 text-[13px] font-black uppercase`}
          >
            导出方案
          </button>
          <button
            onClick={handleHistoryCopyMarkdown}
            className={`${glassButtonClass} px-4 h-9 text-[13px] font-black uppercase`}
          >
            复制 Markdown
          </button>
        </div>

        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 mb-6">
          <div className="text-[13px] font-black text-slate-400 uppercase tracking-widest mb-3">设计参数</div>
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
              <span className="text-slate-400 font-bold">场景</span>
              <span className="font-black text-slate-900">{scenarioLabel}</span>
            </div>
            <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
              <span className="text-slate-400 font-bold">房间长</span>
              <span className="font-black text-slate-900">{params.length} m</span>
            </div>
            <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
              <span className="text-slate-400 font-bold">房间宽</span>
              <span className="font-black text-slate-900">{params.width} m</span>
            </div>
            <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
              <span className="text-slate-400 font-bold">安装高度</span>
              <span className="font-black text-slate-900">{params.height} m</span>
            </div>
            {item.scenario === Scenario.LECTURE_HALL && (
              <>
                <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
                  <span className="text-slate-400 font-bold">台口至最近</span>
                  <span className="font-black text-slate-900">{params.stageToNearAudience} m</span>
                </div>
                <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
                  <span className="text-slate-400 font-bold">台口至最远</span>
                  <span className="font-black text-slate-900">{params.stageToFarAudience} m</span>
                </div>
                <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
                  <span className="text-slate-400 font-bold">台口宽度</span>
                  <span className="font-black text-slate-900">{params.stageWidth} m</span>
                </div>
                <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
                  <span className="text-slate-400 font-bold">舞台深度</span>
                  <span className="font-black text-slate-900">{params.stageDepth} m</span>
                </div>
              </>
            )}
          </div>
          <div className="mt-4 text-[13px] font-black text-slate-400 uppercase tracking-widest">话筒配置</div>
          <div className="grid grid-cols-2 gap-3 mt-2 text-[13px]">
            {(params.mics || []).map(mic => (
              <div key={mic.id} className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
                <span className="text-slate-500 font-bold">{mic.type}</span>
                <span className="font-black text-slate-900">{mic.count} 套</span>
              </div>
            ))}
          </div>
          <div className="mt-4 text-[13px] font-black text-slate-400 uppercase tracking-widest">配套子系统</div>
          <div className="flex flex-wrap gap-2 mt-2 text-[13px]">
            {params.hasCentralControl && <span className="px-2 py-1 rounded-full bg-white border border-slate-200 font-bold">中控</span>}
            {params.hasMatrix && <span className="px-2 py-1 rounded-full bg-white border border-slate-200 font-bold">矩阵</span>}
            {params.hasVideoConf && <span className="px-2 py-1 rounded-full bg-white border border-slate-200 font-bold">视频</span>}
            {params.hasRecording && <span className="px-2 py-1 rounded-full bg-white border border-slate-200 font-bold">录播</span>}
            {!params.hasCentralControl && !params.hasMatrix && !params.hasVideoConf && !params.hasRecording && (
              <span className="text-slate-400 font-bold">无</span>
            )}
          </div>
          {params.extraRequirements && (
            <div className="mt-4">
              <div className="text-[13px] font-black text-slate-400 uppercase tracking-widest">其他需求</div>
              <div className="mt-2 text-[13px] text-slate-600 font-medium bg-white border border-slate-100 rounded-lg px-3 py-2">
                {params.extraRequirements}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="text-[13px] font-black text-slate-400 uppercase tracking-widest">方案正文预览</div>
          {historyResults.map((res: any, idx: number) => {
            const markdown = getHistoryMarkdown(res);
            return (
              <article
                key={String(res?.id || idx)}
                id={buildHistoryPrintDomId(item.id, String(res?.id || idx))}
                className="markdown-report bg-white border border-slate-200 rounded-2xl p-5"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>{markdown}</ReactMarkdown>
              </article>
            );
          })}
        </div>
        <button
          onClick={() => {
            logic.setDesignState(prev => ({
              ...prev,
              projectName: `${item.projectName}_复件`,
              scenario: item.scenario,
              params: item.params,
              results: item.results,
              isDesigned: true
            }));
            logic.setCurrentPage(Page.SOLUTION);
            logic.setPreviewHistoryItem(null);
          }}
          className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[13px] uppercase tracking-widest mt-6"
        >
          重新载入此设计
        </button>
          </div>
        </div>
      </div>
    );
  };

  const renderUserManagementView = () => {
    const keyword = logic.userNameFilter.trim().toLowerCase();
    const filteredUsers = logic.users.filter(u => {
      const roleMatch = logic.userRoleFilter === 'ALL' || u.role === logic.userRoleFilter;
      const keywordMatch = !keyword || u.username.toLowerCase().includes(keyword) || u.phone.includes(keyword);
      return roleMatch && keywordMatch;
    });

    return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden bg-white">
      <div className="shrink-0 mb-6">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">用户管理中心</h2>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">管理系统成员权限、账户状态及安全策略</p>
      </div>

      {/* 过滤器 */}
      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-6 flex flex-wrap items-end gap-4 shrink-0">
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">按角色过滤</label>
          <select
            value={logic.userRoleFilter}
            onChange={e => logic.setUserRoleFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-[12px] font-bold outline-none"
          >
            <option value="ALL">所有角色</option>
            <option value="管理员">管理员</option>
            <option value="普通用户">普通用户</option>
          </select>
        </div>
        <div className="space-y-1.5 flex-[2] min-w-[300px]">
          <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">搜索用户名或电话</label>
          <div className="relative">
            <input
              type="text"
              placeholder="请输入关键词..."
              value={logic.userNameFilter}
              onChange={e => logic.setUserNameFilter(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 pl-10 text-[12px] font-bold outline-none focus:ring-2 focus:ring-blue-500/10"
            />
            <svg className="w-4 h-4 absolute left-3.5 top-2.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </div>
        </div>
        <button
          onClick={() => setIsAddingUser(true)}
          className="bg-slate-900 text-white px-6 py-2.5 rounded-xl text-[13px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95"
        >
          + 新增成员
        </button>
      </div>

      {/* 用户列表表格 */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col">
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 bg-slate-50 border-b z-10">
              <tr>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">用户名</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">联系电话</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">公司</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">角色权限</th>
                <th className="px-6 py-4 text-right pr-6 font-black text-slate-400 uppercase tracking-widest w-40">管理操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map(u => (
                <tr key={u.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 rounded-full ${themeBg} text-white flex items-center justify-center font-black text-[13px]`}>{u.username[0]}</div>
                      <div>
                        <div className="font-black text-slate-900 text-[12px]">{u.username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-500">{u.phone}</td>
                  <td className="px-6 py-4 text-slate-500">{u.company}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-[13px] font-black uppercase tracking-tighter border ${u.role === '管理员' ? 'border-red-200 bg-red-50 text-red-600' : 'border-blue-200 bg-blue-50 text-blue-600'}`}>{u.role}</span>
                  </td>
                  <td className="px-6 py-4 text-right pr-6 space-x-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditingUser(u)} className="text-blue-600 font-black hover:underline uppercase tracking-widest text-[13px]">编辑</button>
                    <button onClick={() => logic.deleteUser(u.id)} className="text-red-400 font-black hover:text-red-600 transition-colors uppercase tracking-widest text-[13px]">删除</button>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-20 text-center text-slate-300 font-black uppercase italic">未发现相关用户信息</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 用户编辑/新增弹窗 */}
      {(editingUser || isAddingUser) && (
        <div className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-5">
          <div className="bg-white w-full max-md rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                {isAddingUser ? '新增平台成员' : `编辑用户资料：${editingUser?.username}`}
              </h3>
              <button onClick={() => { setEditingUser(null); setIsAddingUser(false); }} className="text-slate-300 hover:text-slate-900 transition-colors">✕</button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">用户名</label>
                <input id="user-name" defaultValue={isAddingUser ? "" : editingUser?.username} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="如：admin" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">联系电话</label>
                <input id="user-phone" defaultValue={isAddingUser ? "" : editingUser?.phone} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="如：13700000000" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">角色权限</label>
                  <select id="user-role" defaultValue={isAddingUser ? '普通用户' : editingUser?.role} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none">
                    <option value="管理员">管理员</option>
                    <option value="普通用户">普通用户</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">公司名称</label>
                  <input id="user-company" defaultValue={isAddingUser ? "" : editingUser?.company} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="如：中国计量大学" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">登录密码</label>
                <input id="user-password" type="password" defaultValue="" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="仅新增或修改时填写" />
              </div>
            </div>

            <div className="flex space-x-3 pt-4">
              <button onClick={() => { setEditingUser(null); setIsAddingUser(false); }} className="flex-1 py-3.5 rounded-2xl border border-slate-200 text-slate-400 font-black text-[13px] uppercase tracking-widest hover:bg-slate-50 transition-all">取消</button>
              <button onClick={() => {
                const username = (document.getElementById('user-name') as HTMLInputElement).value;
                const phone = (document.getElementById('user-phone') as HTMLInputElement).value;
                const company = (document.getElementById('user-company') as HTMLInputElement).value;
                const role = (document.getElementById('user-role') as HTMLSelectElement).value as any;
                const password = (document.getElementById('user-password') as HTMLInputElement).value;

                if (isAddingUser) {
                  logic.addUser({ username, phone, company, role, password });
                } else if (editingUser) {
                  logic.updateUser({ ...editingUser, username, phone, company, role, ...(password ? { password } : {}) });
                }
                setEditingUser(null); setIsAddingUser(false);
              }} className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[13px] uppercase shadow-xl hover:bg-black transition-all">保存设置</button>
            </div>
          </div>
        </div>
      )}
    </div>
    );
  };

  return (
    <div className={`${theme.lightBg} app-glass-theme h-screen overflow-hidden text-slate-900 font-sans`} style={glassThemeVars}>
      <style>{markdownReportStyles}</style>
      <div className="flex flex-col h-full min-h-0">
      {renderTopNav()}
      <main className={`flex-1 flex overflow-hidden min-h-0 ${isResizingSolutionLayout ? 'select-none' : ''}`}>
        {logic.currentPage === Page.SOLUTION && (
          <>
            {renderSolutionSidebar()}
            <div
              onMouseDown={startSolutionResize}
              className={`w-1.5 shrink-0 cursor-col-resize transition-colors ${isResizingSolutionLayout ? 'bg-slate-300' : 'bg-slate-200 hover:bg-slate-300'}`}
              title="拖动调整左右区域宽度"
            />
            {renderSolutionView()}
          </>
        )}
        {logic.currentPage === Page.MANAGEMENT && renderManagementView()}
        {logic.currentPage === Page.HISTORY && renderHistoryView()}
        {logic.currentPage === Page.USERS && renderUserManagementView()}
      </main>

      {logic.previewHistoryItem && renderHistoryPreview()}

      {/* --- 核心修改：动态录入弹窗 (基于 TableType 切换字段) --- */}
      {isAddingEq && (
        <div className="fixed inset-0 z-[600] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-5">
          <div className="bg-white w-full max-w-3xl max-h-[92vh] rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b px-8 py-5 shrink-0">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                录入新设备
              </h3>
              <button onClick={() => setIsAddingEq(false)} className="text-slate-300 hover:text-slate-900 transition-colors text-xl font-black">✕</button>
            </div>

            <div className="px-8 py-6 space-y-6 overflow-y-auto">
              <div className="bg-slate-100 rounded-xl p-1 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEntryMode('single')}
                  className={`flex-1 h-9 rounded-lg text-[13px] font-black transition-all ${entryMode === 'single' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  单条录入
                </button>
                <button
                  type="button"
                  onClick={() => setEntryMode('batch')}
                  className={`flex-1 h-9 rounded-lg text-[13px] font-black transition-all ${entryMode === 'batch' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  批量录入
                </button>
              </div>

              {entryMode === 'single' ? (
                <>
                  <div className="space-y-1.5">
                    <label className={`text-[13px] font-black uppercase ml-1 ${isLectureHallManagement ? 'text-fuchsia-600' : 'text-blue-600'}`}>第一步：选择设备大类</label>
                    <select
                      value={tempType}
                      onChange={(e) => setTempType(e.target.value as TableType)}
                      className={`w-full border rounded-xl px-4 py-3 text-[13px] font-bold outline-none focus:ring-2 ${isLectureHallManagement ? 'bg-fuchsia-50/50 border-fuchsia-100 focus:ring-fuchsia-500/20' : 'bg-blue-50/50 border-blue-100 focus:ring-blue-500/20'}`}
                    >
                      {ENTRY_TARGET_TABLES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-4">
                    <label className="text-[13px] font-black text-slate-400 uppercase ml-1">第二步：填写设备属性</label>
                    <div className="grid grid-cols-2 gap-4">
                      {getFieldsByTable(tempType).map((field) => (
                        <div key={`new-${field.key}`} className="space-y-1">
                          <label className="text-[13px] font-black text-slate-500 ml-1">{field.label}</label>
                          {tempType === TableType.LOCAL_STATIC_RESOURCE && field.key === '资源内容' ? (
                            newResourceType === '图片' ? (
                              <input
                                id={`new-${field.key}`}
                                type="file"
                                accept="image/*"
                                className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-[12px] outline-none file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:font-bold ${managementTheme.fileBtn}`}
                              />
                            ) : (
                              <textarea
                                id={`new-${field.key}`}
                                defaultValue={String(field.defaultValue ?? '')}
                                placeholder={field.placeholder || `${field.label}${field.required ? ' (必填)' : ''}`}
                                rows={3}
                                className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none resize-y"
                              />
                            )
                          ) : field.type === 'multiselect' ? (
                            <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                              {getFieldOptions(field).map((opt) => (
                                <label key={opt} className="inline-flex items-center gap-2 text-[12px] font-semibold text-slate-700">
                                  <input name={`new-${field.key}`} type="checkbox" value={opt} className="h-4 w-4 rounded border-slate-300" />
                                  <span>{opt}</span>
                                </label>
                              ))}
                            </div>
                          ) : field.type === 'select' ? (
                            <select
                              id={`new-${field.key}`}
                              defaultValue={String(field.defaultValue ?? getFieldOptions(field)[0] ?? '')}
                              onChange={(e) => {
                                if (tempType === TableType.LOCAL_STATIC_RESOURCE && field.key === '资源类型') {
                                  setNewResourceType(normalizeResourceType(e.target.value));
                                }
                                if (tempType === TableType.SPEAKER && (field.key === '产品类型' || field.key === '类型')) {
                                  setNewSpeakerProductType(e.target.value);
                                }
                              }}
                              className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none"
                            >
                              {getFieldOptions(field).map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : field.type === 'textarea' ? (
                            <textarea
                              id={`new-${field.key}`}
                              defaultValue={String(field.defaultValue ?? '')}
                              placeholder={field.placeholder || `${field.label}${field.required ? ' (必填)' : ''}`}
                              rows={3}
                              className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none resize-y"
                            />
                          ) : field.type === 'file' ? (
                            <input
                              id={`new-${field.key}`}
                              type="file"
                              accept={field.accept || 'image/*'}
                              className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-[12px] outline-none file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:font-bold ${managementTheme.fileBtn}`}
                            />
                          ) : (
                            <input
                              id={`new-${field.key}`}
                              type={field.type === 'number' ? 'number' : 'text'}
                              defaultValue={field.defaultValue ?? ''}
                              placeholder={field.placeholder || `${field.label}${field.required ? ' (必填)' : ''}`}
                              className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none"
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    {tempType === TableType.SPEAKER && newSpeakerProductType === '线阵列音箱' && (
                      <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                        <div className="text-[13px] font-black text-slate-700">线阵列配套设备（必填）</div>

                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 space-y-3">
                          <button
                            type="button"
                            onClick={() => setLineArraySubwooferExpanded((prev) => !prev)}
                            className="w-full flex items-center justify-between text-left"
                          >
                            <span className="text-[13px] font-black text-emerald-700">配套1：次低音音箱（用途自动填充为“次低音箱”）</span>
                            <span className="text-emerald-700 text-[12px] font-black">{lineArraySubwooferExpanded ? '收起' : '展开'}</span>
                          </button>
                          {lineArraySubwooferExpanded && (
                            <div className="grid grid-cols-2 gap-3">
                              {LINE_ARRAY_SUBWOOFER_FIELDS.map((field) => (
                                <div key={`new-line-subwoofer-${field.key}`} className="space-y-1">
                                  <label className="text-[12px] font-black text-slate-600">{field.label}</label>
                                  <input
                                    id={`new-line-subwoofer-${field.key}`}
                                    defaultValue={field.key === '市场价' ? 100 : ''}
                                    placeholder={field.placeholder || `${field.label}（必填）`}
                                    className="w-full bg-white border border-emerald-100 rounded-lg px-3 py-2 text-[12px] outline-none"
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 space-y-3">
                          <button
                            type="button"
                            onClick={() => setLineArrayHangerExpanded((prev) => !prev)}
                            className="w-full flex items-center justify-between text-left"
                          >
                            <span className="text-[13px] font-black text-sky-700">配套2：线阵列音箱吊挂架（用途自动填充为“挂架”）</span>
                            <span className="text-sky-700 text-[12px] font-black">{lineArrayHangerExpanded ? '收起' : '展开'}</span>
                          </button>
                          {lineArrayHangerExpanded && (
                            <div className="grid grid-cols-2 gap-3">
                              {LINE_ARRAY_HANGER_FIELDS.map((field) => (
                                <div key={`new-line-hanger-${field.key}`} className="space-y-1">
                                  <label className="text-[12px] font-black text-slate-600">{field.label}</label>
                                  <input
                                    id={`new-line-hanger-${field.key}`}
                                    defaultValue={field.key === '市场价' ? 100 : ''}
                                    placeholder={field.placeholder || `${field.label}（必填）`}
                                    className="w-full bg-white border border-sky-100 rounded-lg px-3 py-2 text-[12px] outline-none"
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-black text-slate-500">目标表</label>
                    <select
                      value={tempType}
                      onChange={(e) => setTempType(e.target.value as TableType)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[13px] font-bold outline-none"
                    >
                      {ENTRY_TARGET_TABLES.map((t) => (
                        <option key={`batch-${t}`} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <div className="text-[13px] font-black text-slate-600">统一对话式输入</div>
                    <textarea
                      value={batchText}
                      onChange={(e) => setBatchText(e.target.value)}
                      rows={6}
                      placeholder="在这里输入设备描述；也可同时上传图片或 Excel/CSV 文件。"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-[12px] outline-none resize-y"
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <div className="text-[12px] font-black text-slate-500 mb-1">上传图片（可选）</div>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => setBatchImageFile(e.target.files?.[0] || null)}
                          className={`w-full bg-white border rounded-xl px-3 py-2 text-[12px] outline-none file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:font-bold ${managementTheme.fileBtn}`}
                        />
                        {batchImageFile && <div className="mt-1 text-[12px] text-slate-500 truncate">已选择：{batchImageFile.name}</div>}
                      </label>

                      <label className="block">
                        <div className="text-[12px] font-black text-slate-500 mb-1">上传 Excel/CSV（可选）</div>
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          onChange={(e) => setBatchSheetFile(e.target.files?.[0] || null)}
                          className={`w-full bg-white border rounded-xl px-3 py-2 text-[12px] outline-none file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:font-bold ${managementTheme.fileBtn}`}
                        />
                        {batchSheetFile && <div className="mt-1 text-[12px] text-slate-500 truncate">已选择：{batchSheetFile.name}</div>}
                      </label>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleParseBatchInput}
                      disabled={batchParsing}
                      className={`h-9 px-4 rounded-lg text-[12px] font-black text-white transition-all ${batchParsing ? 'bg-slate-400' : 'bg-slate-900 hover:bg-black'}`}
                    >
                      {batchParsing ? '解析中...' : '开始解析'}
                    </button>
                  </div>

                  <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
                    {parsedBatchItems.length === 0 ? (
                      <div className="text-[12px] text-slate-400 font-semibold py-6 text-center border border-dashed border-slate-200 rounded-xl">解析结果会以和单条录入一致的参数表单展示，并支持直接编辑。</div>
                    ) : (
                      parsedBatchItems.map((item) => {
                        const title = String(item.payload.产品名称 || item.payload.图片名称 || item.payload.型号 || `设备${item.id}`);
                        const isValid = item.complete && item.errors.length === 0;
                        return (
                          <div key={`batch-item-${item.id}`} className={`rounded-xl border ${isValid ? 'border-emerald-300 bg-emerald-50/60' : 'border-rose-300 bg-rose-50/60'}`}>
                            <button
                              type="button"
                              onClick={() => setParsedBatchItems((prev) => prev.map((row) => row.id === item.id ? { ...row, expanded: !row.expanded } : row))}
                              className="w-full px-3 py-2.5 flex items-center justify-between text-left"
                            >
                              <span className="text-[12px] font-black text-slate-800">{title}</span>
                              <span className={`text-[12px] font-black ${isValid ? 'text-emerald-700' : 'text-rose-700'}`}>{isValid ? '信息完整' : '存在缺失/格式错误'}</span>
                            </button>
                            {item.expanded && (
                              <div className="px-3 pb-3 space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                  {getFieldsByTable(tempType).filter((field) => field.type !== 'file').map((field) => {
                                    const value = (item.payload as any)?.[field.key];
                                    const options = getFieldOptions(field);
                                    if (field.type === 'multiselect') {
                                      const values = normalizeFeatureValues(value);
                                      return (
                                        <div key={`batch-edit-${item.id}-${field.key}`} className="space-y-1 col-span-2">
                                          <label className="text-[12px] font-black text-slate-600">{field.label}</label>
                                          <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-2">
                                            {options.map((opt) => {
                                              const checked = values.includes(opt);
                                              return (
                                                <label key={`batch-check-${item.id}-${field.key}-${opt}`} className="inline-flex items-center gap-2 text-[12px] text-slate-700">
                                                  <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={(e) => {
                                                      const next = new Set(values);
                                                      if (e.target.checked) next.add(opt);
                                                      else next.delete(opt);
                                                      updateParsedBatchItemField(item.id, field.key, Array.from(next));
                                                    }}
                                                  />
                                                  <span>{opt}</span>
                                                </label>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    }

                                    if (field.type === 'select') {
                                      return (
                                        <div key={`batch-edit-${item.id}-${field.key}`} className="space-y-1">
                                          <label className="text-[12px] font-black text-slate-600">{field.label}</label>
                                          <select
                                            value={String(value ?? field.defaultValue ?? options[0] ?? '')}
                                            onChange={(e) => updateParsedBatchItemField(item.id, field.key, e.target.value)}
                                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-semibold outline-none"
                                          >
                                            {options.map((opt) => (
                                              <option key={`batch-option-${item.id}-${field.key}-${opt}`} value={opt}>{opt}</option>
                                            ))}
                                          </select>
                                        </div>
                                      );
                                    }

                                    if (field.type === 'textarea') {
                                      return (
                                        <div key={`batch-edit-${item.id}-${field.key}`} className="space-y-1 col-span-2">
                                          <label className="text-[12px] font-black text-slate-600">{field.label}</label>
                                          <textarea
                                            value={String(value ?? '')}
                                            onChange={(e) => updateParsedBatchItemField(item.id, field.key, e.target.value)}
                                            rows={3}
                                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] outline-none resize-y"
                                          />
                                        </div>
                                      );
                                    }

                                    return (
                                      <div key={`batch-edit-${item.id}-${field.key}`} className="space-y-1">
                                        <label className="text-[12px] font-black text-slate-600">{field.label}</label>
                                        <input
                                          type={field.type === 'number' ? 'number' : 'text'}
                                          value={String(value ?? (field.key === '市场价' ? 100 : field.defaultValue ?? ''))}
                                          onChange={(e) => updateParsedBatchItemField(item.id, field.key, e.target.value)}
                                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] outline-none"
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                                {item.errors.length > 0 && (
                                  <div className="rounded-lg border border-rose-200 bg-rose-100/70 p-2 text-[12px] text-rose-700">
                                    {item.errors.map((err, idx) => <div key={`error-${item.id}-${idx}`}>- {err}</div>)}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex space-x-3 px-8 py-4 border-t shrink-0">
              <button onClick={() => setIsAddingEq(false)} className="flex-1 py-3.5 rounded-2xl border text-slate-400 font-black text-[13px] uppercase tracking-widest hover:bg-slate-50 transition-all">取消</button>
              {entryMode === 'single' ? (
                <button
                  onClick={async () => {
                    try {
                      const payload = await buildPayloadFromForm('new', tempType);
                      const ok = await logic.handleSaveEquipment(tempType, payload);
                      if (ok) {
                        setIsAddingEq(false);
                      }
                    } catch (error: any) {
                      alert(error?.message || '录入失败，请检查输入后重试。');
                    }
                  }}
                  className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[13px] uppercase shadow-xl hover:bg-black transition-all"
                >
                  确认保存
                </button>
              ) : (
                <button
                  onClick={handleConfirmBatchSave}
                  className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[13px] uppercase shadow-xl hover:bg-black transition-all"
                >
                  确定录入
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {editingEq && (
        <div className="fixed inset-0 z-[650] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-5">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">编辑设备</h3>
              <button onClick={() => setEditingEq(null)} className="text-slate-300 hover:text-slate-900 transition-colors text-xl font-black">✕</button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {getFieldsByTable(logic.activeTable).map((field) => (
                  <div key={`edit-${field.key}`} className="space-y-1">
                    <label className="text-[13px] font-black text-slate-500 ml-1">{field.label}</label>
                    {logic.activeTable === TableType.LOCAL_STATIC_RESOURCE && field.key === '资源内容' ? (
                      editResourceType === '图片' ? (
                        <div className="space-y-2">
                          <input
                            id={`edit-${field.key}`}
                            type="file"
                            accept="image/*"
                            className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-[12px] outline-none file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:font-bold ${managementTheme.fileBtn}`}
                          />
                          {String((editingEq as any)?.资源内容 || '').trim() && (
                            <button
                              type="button"
                              onClick={() => setPreviewImage({ src: String((editingEq as any)?.资源内容 || ''), title: `${editingEq.图片名称 || '资源图片'} - 资源内容` })}
                              className={`h-8 px-3 rounded-lg border text-[12px] font-bold transition-colors ${managementTheme.softBtn}`}
                            >
                              查看当前图片
                            </button>
                          )}
                        </div>
                      ) : (
                        <textarea
                          id={`edit-${field.key}`}
                          defaultValue={String((editingEq as any)[field.key] ?? field.defaultValue ?? '')}
                          placeholder={field.placeholder || field.label}
                          rows={3}
                          className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none resize-y"
                        />
                      )
                    ) : field.type === 'multiselect' ? (
                      <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        {getFieldOptions(field).map((opt) => {
                          const currentValues = normalizeFeatureValues((editingEq as any)[field.key]);
                          return (
                            <label key={`edit-${field.key}-${opt}`} className="inline-flex items-center gap-2 text-[12px] font-semibold text-slate-700">
                              <input
                                name={`edit-${field.key}`}
                                type="checkbox"
                                value={opt}
                                defaultChecked={currentValues.includes(opt)}
                                className="h-4 w-4 rounded border-slate-300"
                              />
                              <span>{opt}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : field.type === 'select' ? (
                      <select
                        id={`edit-${field.key}`}
                        defaultValue={String((editingEq as any)[field.key] ?? (field.key === '产品类型' ? (editingEq as any).类型 : undefined) ?? field.defaultValue ?? getFieldOptions(field)[0] ?? '')}
                        onChange={(e) => {
                          if (logic.activeTable === TableType.LOCAL_STATIC_RESOURCE && field.key === '资源类型') {
                            setEditResourceType(normalizeResourceType(e.target.value));
                          }
                          if (logic.activeTable === TableType.SPEAKER && (field.key === '产品类型' || field.key === '类型')) {
                            setEditSpeakerProductType(e.target.value);
                          }
                        }}
                        className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none"
                      >
                        {getFieldOptions(field).map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        id={`edit-${field.key}`}
                        defaultValue={String((editingEq as any)[field.key] ?? field.defaultValue ?? '')}
                        placeholder={field.placeholder || field.label}
                        rows={3}
                        className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none resize-y"
                      />
                    ) : field.type === 'file' ? (
                      <div className="space-y-2">
                        <input
                          id={`edit-${field.key}`}
                          type="file"
                          accept={field.accept || 'image/*'}
                          className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-[12px] outline-none file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:font-bold ${managementTheme.fileBtn}`}
                        />
                        {String((editingEq as any)[field.key] || '').trim() && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setPreviewImage({ src: String((editingEq as any)[field.key] || ''), title: `${editingEq.产品名称 || editingEq.图片名称 || '图片'} - ${field.label}` })}
                              className={`h-8 px-3 rounded-lg border text-[12px] font-bold transition-colors ${managementTheme.softBtn}`}
                            >
                              查看当前图片
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRemovedImageFieldKeys((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(field.key)) {
                                    next.delete(field.key);
                                  } else {
                                    next.add(field.key);
                                  }
                                  return next;
                                });
                              }}
                              className={`h-8 px-3 rounded-lg border text-[12px] font-bold transition-colors ${removedImageFieldKeys.has(field.key) ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'}`}
                            >
                              {removedImageFieldKeys.has(field.key) ? '撤销删除图片' : '删除当前图片'}
                            </button>
                            {removedImageFieldKeys.has(field.key) && (
                              <span className="text-[12px] font-bold text-amber-700">已标记删除，保存后生效</span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <input
                        id={`edit-${field.key}`}
                        type={field.type === 'number' ? 'number' : 'text'}
                        defaultValue={String((editingEq as any)[field.key] ?? field.defaultValue ?? '')}
                        placeholder={field.placeholder || field.label}
                        className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex space-x-3 pt-4 border-t">
              <button onClick={() => setEditingEq(null)} className="flex-1 py-3.5 rounded-2xl border text-slate-400 font-black text-[13px] uppercase tracking-widest hover:bg-slate-50 transition-all">取消</button>
              <button
                onClick={async () => {
                  try {
                    const payload = await buildPayloadFromForm('edit', logic.activeTable);
                    const ok = await logic.updateInventoryItem(logic.activeTable, editingEq.id, payload);
                    if (ok) {
                      setEditingEq(null);
                    }
                  } catch (error: any) {
                    alert(error?.message || '更新失败，请检查输入后重试。');
                  }
                }}
                className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[13px] uppercase shadow-xl hover:bg-black transition-all"
              >
                保存更新
              </button>
            </div>
          </div>
        </div>
      )}

      {previewImage && (
        <div className="fixed inset-0 z-[652] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setPreviewImage(null)}>
          <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 tracking-tight">{previewImage.title}</h3>
              <button onClick={() => setPreviewImage(null)} className="text-slate-400 hover:text-slate-900 text-xl leading-none">✕</button>
            </div>
            <div className="max-h-[75vh] overflow-auto bg-slate-50 p-6">
              <img src={previewImage.src} alt={previewImage.title} className="max-w-full h-auto mx-auto rounded-xl border border-slate-200 bg-white" />
            </div>
          </div>
        </div>
      )}

      {editingHistory && (
        <div className="fixed inset-0 z-[655] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-5">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">编辑历史设计</h3>
              <button onClick={() => setEditingHistory(null)} className="text-slate-300 hover:text-slate-900 transition-colors text-xl font-black">✕</button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">设计名称</label>
                <input id="history-name" defaultValue={editingHistory.projectName} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">场景类型</label>
                <select id="history-scenario" defaultValue={editingHistory.scenario} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none">
                  <option value={Scenario.MEETING_ROOM}>会议室</option>
                  <option value={Scenario.LECTURE_HALL}>报告厅</option>
                </select>
              </div>
            </div>
            <div className="flex space-x-3 pt-4 border-t">
              <button onClick={() => setEditingHistory(null)} className="flex-1 py-3.5 rounded-2xl border text-slate-400 font-black text-[13px] uppercase tracking-widest hover:bg-slate-50 transition-all">取消</button>
              <button
                onClick={() => {
                  const projectName = (document.getElementById('history-name') as HTMLInputElement).value;
                  const scenario = (document.getElementById('history-scenario') as HTMLSelectElement).value as Scenario;
                  logic.updateHistoryRecord(editingHistory.id, { projectName, scenario });
                  setEditingHistory(null);
                }}
                className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[13px] uppercase shadow-xl hover:bg-black transition-all"
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoginOpen && (
        <div className="fixed inset-0 z-[660] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-5">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">登录系统</h3>
              <button onClick={() => setIsLoginOpen(false)} className="text-slate-300 hover:text-slate-900 transition-colors text-xl font-black">✕</button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">用户名</label>
                <input id="login-username" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="请输入用户名" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">密码</label>
                <input id="login-password" type="password" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="请输入密码" />
              </div>
            </div>
            <div className="flex space-x-3 pt-4 border-t">
              <button onClick={() => setIsLoginOpen(false)} className="flex-1 py-3.5 rounded-2xl border text-slate-400 font-black text-[13px] uppercase tracking-widest hover:bg-slate-50 transition-all">取消</button>
              <button
                onClick={async () => {
                  const username = (document.getElementById('login-username') as HTMLInputElement).value.trim();
                  const password = (document.getElementById('login-password') as HTMLInputElement).value;
                  const ok = await logic.login(username, password);
                  if (!ok) {
                    alert('登录失败，请检查用户名或密码。');
                    return;
                  }
                  setIsLoginOpen(false);
                }}
                className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[13px] uppercase shadow-xl hover:bg-black transition-all"
              >
                立即登录
              </button>
            </div>
          </div>
        </div>
      )}

      {isProfileDialogOpen && (
        <div className="fixed inset-0 z-[670] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-5">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">个人资料</h3>
              <button onClick={() => setIsProfileDialogOpen(false)} className="text-slate-300 hover:text-slate-900 transition-colors text-xl font-black">✕</button>
            </div>
            {logic.currentUser.isGuest ? (
              <div className="space-y-4">
                <p className="text-[12px] text-slate-500">当前为游客身份，请先登录后查看或修改个人资料。</p>
                <button
                  onClick={() => { setIsProfileDialogOpen(false); setIsLoginOpen(true); }}
                  className="w-full py-3 bg-slate-900 text-white rounded-xl font-black text-[13px] uppercase"
                >
                  去登录
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">用户名</label>
                  <input id="profile-username" defaultValue={logic.currentUser.username} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">联系电话</label>
                  <input id="profile-phone" defaultValue={logic.currentUser.phone} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">公司名称</label>
                  <input id="profile-company" defaultValue={logic.currentUser.company} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-black text-slate-400 uppercase tracking-widest ml-1">修改密码</label>
                  <input id="profile-password" type="password" defaultValue="" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="留空则不修改" />
                </div>
                <div className="flex space-x-3 pt-2">
                  <button onClick={() => setIsProfileDialogOpen(false)} className="flex-1 py-3.5 rounded-2xl border text-slate-400 font-black text-[13px] uppercase tracking-widest hover:bg-slate-50 transition-all">取消</button>
                  <button
                    onClick={async () => {
                      const username = (document.getElementById('profile-username') as HTMLInputElement).value;
                      const phone = (document.getElementById('profile-phone') as HTMLInputElement).value;
                      const company = (document.getElementById('profile-company') as HTMLInputElement).value;
                      const password = (document.getElementById('profile-password') as HTMLInputElement).value;
                      const ok = await logic.updateProfile({ username, phone, company, ...(password ? { password } : {}) });
                      if (!ok) {
                        alert('更新失败，请检查后端日志。');
                        return;
                      }
                      setIsProfileDialogOpen(false);
                    }}
                    className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[13px] uppercase shadow-xl hover:bg-black transition-all"
                  >
                    保存资料
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="fixed bottom-6 right-6 z-[200]">
        {!logic.isChatOpen ? (
          <button
            onClick={() => logic.setIsChatOpen(true)}
            className={`w-14 h-14 rounded-full ${themeBg} text-white shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all group`}
          >
            <svg className="w-6 h-6 group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
          </button>
        ) : (
          <div className="w-[380px] h-[520px] bg-white rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300">
            <div className={`p-4 ${themeBg} text-white flex items-center justify-between`}>
              <h4 className="text-xs font-black uppercase tracking-widest">声学助理 AI</h4>
              <button onClick={() => logic.setIsChatOpen(false)} className="text-white/60 hover:text-white transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 scrollbar-hide">
              {logic.designState.chatHistory.map((chat, idx) => (
                <div key={idx} className={`flex ${chat.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[90%] p-3.5 rounded-2xl text-[12px] leading-relaxed shadow-sm ${chat.role === 'user'
                    ? `${themeBg} text-white rounded-tr-none`
                    : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none prose prose-slate prose-xs max-w-none'
                    }`}>
                    {chat.role === 'user' ? (
                      chat.text
                    ) : chat.text.includes("AI 引擎当前处于关闭状态") ? (
                      <div className="space-y-3">
                        <p className="font-bold text-rose-600 mb-1">{chat.text}</p>
                        <button
                          onClick={async () => {
                            await logic.toggleAiBackend('start');
                            // 额外检查一次状态
                          }}
                          className={`${themeBg} text-white px-4 py-2 rounded-xl text-[13px] font-black uppercase tracking-widest shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center space-x-2`}
                        >
                          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                          <span>立即尝试开启 AI 引擎</span>
                        </button>
                      </div>
                    ) : (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table: ({ node, ...props }) => (
                            <div className="overflow-x-auto my-2">
                              <table className="min-w-full border shadow-sm rounded-lg text-[13px]" {...props} />
                            </div>
                          ),
                          th: ({ node, ...props }) => <th className="border px-2 py-1 bg-slate-50 font-black text-slate-900" {...props} />,
                          td: ({ node, ...props }) => <td className="border px-2 py-1" {...props} />,
                          code: ({ node, ...props }) => <code className="bg-slate-100 px-1 rounded text-pink-600 font-mono" {...props} />,
                          p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                        }}
                      >
                        {chat.text}
                      </ReactMarkdown>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-4 bg-white border-t border-slate-100 flex items-center space-x-2">
              <input
                type="text"
                value={logic.chatInputValue}
                onChange={e => logic.setChatInputValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && logic.handleSendMessage()}
                placeholder="描述您的需求..."
                className="flex-1 bg-slate-100 border-none rounded-full px-4 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button onClick={logic.handleSendMessage} className={`w-8 h-8 rounded-full flex items-center justify-center ${themeBg} text-white`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 12h14M12 5l7 7-7 7"></path></svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Editing Item Dialog */}
      {logic.editingItem && (
        <div className="fixed inset-0 z-[400] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white w-full max-md rounded-3xl shadow-2xl overflow-hidden">
            <div className={`px-6 py-4 ${themeBg} text-white flex items-center justify-between`}>
              <h3 className="text-sm font-black uppercase tracking-widest">编辑设备属性</h3>
              <button
                onClick={() => {
                  logic.setEditingItem(null);
                  setPendingLinkedUpdates([]);
                  setAmpRecommendationPrompt(null);
                }}
                className="text-white/60 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 gap-3 text-[12px]">
                <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
                  <div className="text-[13px] text-slate-400 font-black">设备分类</div>
                  <div className="font-bold text-slate-800">{logic.editingItem.item.type || '-'}</div>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
                  <div className="text-[13px] text-slate-400 font-black">设备名称</div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-bold text-slate-800">{logic.editingItem.item.name || '-'}</div>
                    <button
                      onClick={() => {
                        if (isLineArraySupportChildItem(logic.editingItem!.item)) {
                          alert('该设备为线阵列音箱配套设备，必须通过修改线阵列音箱来联动更新。');
                          return;
                        }
                        setIsReplacementPickerOpen(true);
                      }}
                      className="w-7 h-7 rounded-lg border border-slate-200 text-slate-600 hover:bg-white flex items-center justify-center"
                      title="替换同类型设备"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7h11m0 0l-3-3m3 3l-3 3M20 17H9m0 0l3-3m-3 3l3 3"/></svg>
                    </button>
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
                  <div className="text-[13px] text-slate-400 font-black">型号</div>
                  <div className="font-bold text-slate-800">{logic.editingItem.item.model || '-'}</div>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
                  <div className="text-[13px] text-slate-400 font-black">品牌</div>
                  <div className="font-bold text-slate-800">{logic.editingItem.item.brand || '-'}</div>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
                  <div className="text-[13px] text-slate-400 font-black">单价</div>
                  <div className="font-bold text-slate-800">¥{Number(logic.editingItem.item.unitPrice || 0).toLocaleString()}</div>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[13px] font-black text-slate-500">数量</label>
                <input
                  type="number"
                  value={logic.editingItem.item.quantity}
                  onChange={e => {
                    if (isLineArraySupportChildItem(logic.editingItem!.item)) {
                      alert('该设备为线阵列音箱配套设备，必须通过修改线阵列音箱来联动更新。');
                      return;
                    }
                    logic.setEditingItem({
                      ...logic.editingItem!,
                      item: {
                        ...logic.editingItem!.item,
                        quantity: parseInt(e.target.value) || 0
                      }
                    });
                  }}
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2.5 text-xs font-bold outline-none"
                />
              </div>
              {pendingLinkedUpdates.length > 0 && (
                <div className="px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-[12px] font-bold">
                  已检测到配套联动，保存后将同步更新关联设备配置。
                </div>
              )}
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex space-x-3">
              <button
                onClick={() => {
                  logic.setEditingItem(null);
                  setEditingOptions([]);
                  setIsReplacementPickerOpen(false);
                  setPendingLinkedUpdates([]);
                  setAmpRecommendationPrompt(null);
                }}
                className="flex-1 py-3 rounded-xl border border-slate-200 text-[13px] font-black uppercase tracking-widest text-slate-500"
              >
                取消
              </button>
              <button
                onClick={() => {
                  logic.saveEdit(pendingLinkedUpdates);
                  setEditingOptions([]);
                  setIsReplacementPickerOpen(false);
                  setPendingLinkedUpdates([]);
                  setAmpRecommendationPrompt(null);
                }}
                className={`flex-1 py-3 rounded-xl ${themeBg} text-white shadow-lg text-[13px] font-black uppercase tracking-widest hover:brightness-110`}
              >
                保存更改
              </button>
            </div>
          </div>
        </div>
      )}

      {logic.editingItem && isReplacementPickerOpen && (
        <div className="fixed inset-0 z-[410] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden">
            <div className={`px-6 py-4 ${themeBg} text-white flex items-center justify-between`}>
              <h3 className="text-sm font-black uppercase tracking-widest">选择同类型设备</h3>
              <button onClick={() => setIsReplacementPickerOpen(false)} className="text-white/60 hover:text-white transition-colors">✕</button>
            </div>
            <div className="p-6 space-y-3 max-h-[65vh] overflow-y-auto">
              {editingOptions.length === 0 ? (
                <div className="text-[12px] text-slate-400 font-bold">无同类可替换。</div>
              ) : (
                editingOptions.map((opt) => (
                  <div key={opt.id} className="border border-slate-100 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12px] font-black text-slate-900 truncate">{opt.产品名称 || '-'}</div>
                      <div className="text-[13px] text-slate-500 truncate">{opt.品牌 || '-'} / {opt.型号 || '-'}</div>
                      {Number((opt as any).推荐数量 || 0) > 0 && (
                        <div className="text-[12px] text-emerald-700 font-bold mt-1">
                          推荐数量: {Number((opt as any).推荐数量)}
                          {String((opt as any).匹配模式 || '') ? `（${String((opt as any).匹配模式) === 'bridged' ? '桥接模式' : '常规模式'}）` : ''}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={async () => {
                        const editing = logic.editingItem;
                        if (!editing) return;

                        const nextItem: EquipmentItem = {
                          ...editing.item,
                          name: opt.产品名称 || editing.item.name,
                          model: opt.型号 || editing.item.model,
                          brand: opt.品牌 || editing.item.brand,
                          unitPrice: Number(opt.市场价) || editing.item.unitPrice || 0,
                          inventoryMatched: true,
                          inventoryMatchNote: '',
                          recentlyUpdated: true
                        };

                        let nextLinkedUpdates: LinkedPlanUpdate[] = [];
                        let waitingAmpDecision = false;
                        setAmpRecommendationPrompt(null);

                        if (isAmplifierPlanType(editing.item.type)) {
                          const recommendedQuantity = Number((opt as any).推荐数量);
                          if (Number.isFinite(recommendedQuantity) && recommendedQuantity > 0) {
                            nextItem.quantity = Math.max(1, Math.floor(recommendedQuantity));
                          }
                        }

                        if (isSpeakerPlanType(editing.item.type)) {
                          const currentItems = logic.designState.results[editing.resIdx]?.items || [];

                          try {
                            const currentSpeakerDetail = await logic.fetchEquipmentDetail(editing.item);
                            if (isLineArraySpeakerItem(editing.item, currentSpeakerDetail)) {
                              const currentSpeakerMainId = Number(currentSpeakerDetail?.id || 0);
                              const nextSpeakerMainId = Number(opt?.id || 0);

                              if (currentSpeakerMainId > 0 && nextSpeakerMainId > 0 && currentSpeakerMainId !== nextSpeakerMainId) {
                                await logic.ensureInventoryOptions(TableType.LINE_ARRAY_SUPPORT);
                                const supportRows = logic
                                  .getInventoryOptions(TableType.LINE_ARRAY_SUPPORT)
                                  .filter((row) => Number(row.main_id || 0) === nextSpeakerMainId);

                                const nextSubwoofer = supportRows.find((row) => String(row.用途 || row.类型 || '').includes('次低'));
                                const nextHanger = supportRows.find((row) => {
                                  const text = String(row.用途 || row.类型 || '');
                                  return text.includes('吊挂架') || text.includes('吊架');
                                });

                                for (let i = 0; i < currentItems.length; i += 1) {
                                  if (i === editing.itemIdx) continue;
                                  const candidate = currentItems[i];
                                  const candidateDetail = await logic.fetchEquipmentDetail(candidate);
                                  if (Number(candidateDetail?.main_id || 0) !== currentSpeakerMainId) continue;

                                  const purposeText = `${candidateDetail?.用途 || ''} ${candidateDetail?.类型 || candidate.type || ''}`;
                                  if (purposeText.includes('次低') && nextSubwoofer) {
                                    nextLinkedUpdates.push({
                                      resIdx: editing.resIdx,
                                      itemIdx: i,
                                      itemPatch: {
                                        type: String(nextSubwoofer.类型 || candidate.type || ''),
                                        name: String(nextSubwoofer.产品名称 || candidate.name || ''),
                                        model: String(nextSubwoofer.型号 || candidate.model || ''),
                                        brand: String(nextSubwoofer.品牌 || candidate.brand || ''),
                                        unitPrice: Number(nextSubwoofer.市场价 || candidate.unitPrice || 0),
                                        inventoryMatched: true,
                                        inventoryMatchNote: ''
                                      }
                                    });
                                  } else if (isLineArraySupportChildType(purposeText) && nextHanger) {
                                    nextLinkedUpdates.push({
                                      resIdx: editing.resIdx,
                                      itemIdx: i,
                                      itemPatch: {
                                        type: String(nextHanger.类型 || candidate.type || ''),
                                        name: String(nextHanger.产品名称 || candidate.name || ''),
                                        model: String(nextHanger.型号 || candidate.model || ''),
                                        brand: String(nextHanger.品牌 || candidate.brand || ''),
                                        unitPrice: Number(nextHanger.市场价 || candidate.unitPrice || 0),
                                        inventoryMatched: true,
                                        inventoryMatchNote: ''
                                      }
                                    });
                                  }
                                }

                                if (nextLinkedUpdates.length > 0) {
                                  alert('线阵列音箱型号已变更，关联次低音箱与吊架将同步联动更新，保存后生效。');
                                }
                              }
                            }
                          } catch (lineArrayError) {
                            console.error('❌ Line-array linked replacement failed:', lineArrayError);
                          }

                          const pairedAmpIdx = findPairedAmplifierIndex(currentItems, editing.itemIdx);
                          if (pairedAmpIdx >= 0) {
                            const currentAmp = currentItems[pairedAmpIdx];
                            try {
                              const analysis = await logic.analyzeAmplifierMatch({
                                scenario: logic.designState.scenario,
                                speaker: {
                                  model: nextItem.model,
                                  name: nextItem.name,
                                  quantity: nextItem.quantity,
                                  ratedPower: (opt as any).额定功率,
                                  ratedImpedance: (opt as any).额定阻抗
                                },
                                currentAmplifier: {
                                  model: currentAmp.model,
                                  name: currentAmp.name
                                }
                              });

                              const currentMatch = analysis?.current;
                              const requiredQty = Number(currentMatch?.requiredQuantity || 0);
                              if (currentMatch?.matched && requiredQty > 0) {
                                nextLinkedUpdates.push({
                                  resIdx: editing.resIdx,
                                  itemIdx: pairedAmpIdx,
                                  itemPatch: {
                                    quantity: requiredQty
                                  }
                                });
                                alert(`已按匹配关系重算功放数量为 ${requiredQty}，保存后生效。`);
                              } else {
                                const rec = analysis?.recommendation;
                                const recQty = Number(rec?.requiredQuantity || 0);
                                if (analysis?.needsConfirmation && rec && recQty > 0) {
                                  waitingAmpDecision = true;
                                  const recommendAmpUpdate: LinkedPlanUpdate = {
                                    resIdx: editing.resIdx,
                                    itemIdx: pairedAmpIdx,
                                    itemPatch: {
                                      name: String(rec?.name || currentAmp.name || ''),
                                      model: String(rec?.model || currentAmp.model || ''),
                                      brand: String(rec?.brand || currentAmp.brand || ''),
                                      unitPrice: Number(rec?.unitPrice || currentAmp.unitPrice || 0),
                                      quantity: recQty
                                    }
                                  };
                                  setAmpRecommendationPrompt({
                                    message: '新音箱与当前功放不匹配。已自动推荐可配套功放，是否应用推荐结果？',
                                    recommendation: {
                                      name: String(rec?.name || ''),
                                      model: String(rec?.model || ''),
                                      brand: String(rec?.brand || ''),
                                      unitPrice: Number(rec?.unitPrice || 0),
                                      requiredQuantity: recQty,
                                      mode: String(rec?.mode || '')
                                    },
                                    applyUpdates: [...nextLinkedUpdates, recommendAmpUpdate],
                                    rejectUpdates: [...nextLinkedUpdates]
                                  });
                                } else if (currentMatch?.matched === false) {
                                  alert('当前功放与新音箱不匹配，已按规则保留原功放型号与数量不变。');
                                }
                              }
                            } catch (error) {
                              console.error('❌ Speaker replacement match analysis failed:', error);
                              alert('音箱已替换，但功放匹配分析失败，请手动检查功放型号与数量。');
                            }
                          }
                        }

                        logic.setEditingItem({
                          ...editing,
                          item: nextItem
                        });
                        if (!waitingAmpDecision) {
                          setPendingLinkedUpdates(nextLinkedUpdates);
                        }
                        setIsReplacementPickerOpen(false);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[13px] font-black"
                    >
                      选择
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button onClick={() => setIsReplacementPickerOpen(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-[13px] font-black text-slate-500">取消</button>
            </div>
          </div>
        </div>
      )}

      {logic.editingItem && ampRecommendationPrompt && (
        <div className="fixed inset-0 z-[415] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden">
            <div className={`px-6 py-4 ${themeBg} text-white`}>
              <h3 className="text-sm font-black uppercase tracking-widest">功放匹配确认</h3>
            </div>
            <div className="p-6 space-y-4 text-[13px]">
              <div className="text-slate-700 font-bold">{ampRecommendationPrompt.message}</div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-1">
                <div className="text-emerald-800 font-black">推荐功放</div>
                <div className="text-slate-700 font-bold">
                  {ampRecommendationPrompt.recommendation.brand || '-'} / {ampRecommendationPrompt.recommendation.name || '-'} / {ampRecommendationPrompt.recommendation.model || '-'}
                </div>
                <div className="text-emerald-700 font-bold">
                  建议数量: {ampRecommendationPrompt.recommendation.requiredQuantity}
                  {ampRecommendationPrompt.recommendation.mode ? `（${ampRecommendationPrompt.recommendation.mode === 'bridged' ? '桥接模式' : '常规模式'}）` : ''}
                </div>
              </div>
              <div className="text-slate-500 font-medium">确认后将在保存时同步替换功放并更新数量；不接受则保留原功放型号和数量。</div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button
                onClick={() => {
                  setPendingLinkedUpdates(ampRecommendationPrompt.rejectUpdates);
                  setAmpRecommendationPrompt(null);
                }}
                className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-[13px] font-black"
              >
                保持原功放
              </button>
              <button
                onClick={() => {
                  setPendingLinkedUpdates(ampRecommendationPrompt.applyUpdates);
                  setAmpRecommendationPrompt(null);
                }}
                className={`flex-1 py-2.5 rounded-lg ${themeBg} text-white text-[13px] font-black`}
              >
                应用推荐
              </button>
            </div>
          </div>
        </div>
      )}

      {detailDialog && (
        <div className="fixed inset-0 z-[420] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden">
            <div className={`px-6 py-4 ${themeBg} text-white flex items-center justify-between`}>
              <h3 className="text-sm font-black uppercase tracking-widest">设备详细信息</h3>
              <button onClick={() => setDetailDialog(null)} className="text-white/60 hover:text-white transition-colors">✕</button>
            </div>
            <div className="p-6 space-y-5">
              {detailDialog.detail ? (
                <div className="grid grid-cols-2 gap-4 text-[13px]">
                  <div className="space-y-1">
                    <div className="text-slate-400 font-bold uppercase">品牌</div>
                    <div className="font-black text-slate-900">{detailDialog.detail.品牌 || '—'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-slate-400 font-bold uppercase">型号</div>
                    <div className="font-black text-slate-900">{detailDialog.detail.型号 || '—'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-slate-400 font-bold uppercase">产品名称</div>
                    <div className="font-black text-slate-900">{detailDialog.detail.产品名称 || '—'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-slate-400 font-bold uppercase">市场价</div>
                    <div className="font-black text-slate-900">¥{Number(detailDialog.detail.市场价 || 0).toLocaleString()}</div>
                  </div>
                  {detailDialog.detail.描述 && (
                    <div className="col-span-2 space-y-1">
                      <div className="text-slate-400 font-bold uppercase">描述</div>
                      <div className="text-slate-600 font-medium">{detailDialog.detail.描述}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[12px] text-slate-400 font-bold">未找到该设备的数据库信息。</div>
              )}

              {detailDialog.table && (
                <div className="border-t border-slate-100 pt-4 space-y-3">
                  <div className="text-[13px] font-black text-slate-400 uppercase tracking-widest">替换设备</div>
                  {isLineArraySupportChildItem(detailDialog.item) || (Number(detailDialog.detail?.main_id || 0) > 0 && isLineArraySupportChildType(String(detailDialog.detail?.用途 || detailDialog.detail?.类型 || ''))) ? (
                    <div className="text-[12px] text-amber-700 font-bold bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      该设备为线阵列音箱配套设备，必须通过修改线阵列音箱进行联动更新。
                    </div>
                  ) : detailReplacementOptions.length === 0 ? (
                    <div className="text-[12px] text-slate-400 font-bold">无同类可替换。</div>
                  ) : (
                    <div className="flex items-center space-x-3">
                      <select
                        value={replacementId}
                        onChange={e => setReplacementId(e.target.value ? Number(e.target.value) : '')}
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[13px] font-bold outline-none"
                      >
                        <option value="">请选择替换设备</option>
                        {detailReplacementOptions.map(opt => (
                          <option key={opt.id} value={opt.id}>{buildReplacementOptionLabel(opt)}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          const selected = detailReplacementOptions.find(opt => opt.id === Number(replacementId));
                          if (!selected) return;
                          if (isLineArraySpeakerItem(detailDialog.item, detailDialog.detail)) {
                            alert('线阵列音箱请在“编辑设备”窗口替换，以便同步联动次低音箱和吊架。');
                            return;
                          }
                          logic.replacePlanItem(detailDialog.resIdx, detailDialog.itemIdx, selected);
                          setDetailDialog(prev => prev ? {
                            ...prev,
                            detail: selected,
                            item: {
                              ...prev.item,
                              name: selected.产品名称 || prev.item.name,
                              model: selected.型号 || prev.item.model,
                              brand: selected.品牌 || prev.item.brand,
                              unitPrice: Number(selected.市场价) || prev.item.unitPrice,
                              inventoryMatched: true,
                              inventoryMatchNote: '',
                              recentlyUpdated: true
                            }
                          } : prev);
                        }}
                        className="px-4 py-2 rounded-lg bg-slate-900 text-white text-[13px] font-black uppercase"
                      >
                        确认替换
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default App;
