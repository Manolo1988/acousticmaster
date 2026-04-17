// server.js
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import axios from "axios";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { exec } from "child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import {
  ensureStaticBlockTableAndSeed,
  listStaticBlocks,
  loadEnabledStaticBlockMap,
  updateStaticBlock
} from "./plan_service.js";

dotenv.config({ path: fileURLToPath(new URL("./.env", import.meta.url)) });

const app = express();
const defaultCorsOrigins = [
  "http://115.231.236.153:8100",
  "http://115.231.236.153:8101",
  "http://115.231.236.153:3000",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];
const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // 允许所有来源请求，彻底解决测试环境的 CORS 拦截问题
      return callback(null, true);
    },
    credentials: true,
    optionsSuccessStatus: 204
  })
);
app.use(express.json());

const DB_CONFIG = {
  host: process.env.DB_HOST || "115.231.236.153",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "user1",
  password: process.env.DB_PASSWORD || "UasbecrD1!1",
  database: process.env.DB_NAME || "equipment",
  charset: "utf8mb4",
  connectionLimit: 10
};

const pool = mysql.createPool(DB_CONFIG);
const isProduction = process.env.NODE_ENV === 'production';
const ALLOWED_TABLES = new Set([
  "固定搭配",
  "音箱",
  "定阻功放",
  "周边设备",
  "固定搭配场景剩余周边设备",
  "非固定搭配场景剩余周边设备"
]);

const getSafeTableName = (table) => {
  if (!table || !ALLOWED_TABLES.has(table)) return null;
  return table;
};

const getTableColumns = async (table) => {
  const [rows] = await pool.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    [DB_CONFIG.database, table]
  );
  return rows.map((row) => row.COLUMN_NAME);
};

const getPrimaryKey = async (table) => {
  const [rows] = await pool.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'",
    [DB_CONFIG.database, table]
  );
  if (rows.length > 0) return rows[0].COLUMN_NAME;
  return "id";
};

const parseJsonField = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  if (Buffer.isBuffer(value)) {
    try {
      return JSON.parse(value.toString("utf8"));
    } catch (error) {
      return fallback;
    }
  }
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

let latestAcousticIntent = null;
let latestDifyResult = null;

// === 本地 LLM 配置 (例如 Ollama 或 LocalAI) ===
const LOCAL_LLM_URL = process.env.LOCAL_LLM_URL || "http://127.0.0.1:11434/v1/chat/completions";
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || "qwen3:32b"; 
const ARK_API_URL = process.env.ARK_API_URL || "https://ark.cn-beijing.volces.com/api/v3/responses";
const ARK_MODEL = process.env.ARK_MODEL || "doubao-seed-2-0-pro-260215";
const PROMPT_TEMPLATE_FILE_URL = new URL("./大模型方案生成指导模板.md", import.meta.url);
const STATIC_BLOCKS_INDEX_FILE_URL = new URL("./static_blocks/index.json", import.meta.url);
const STATIC_BLOCKS_DIR_URL = new URL("./static_blocks/", import.meta.url);
const GENERATED_DOCS_DIR_URL = new URL("./generated_docs/", import.meta.url);
const PLAN_STREAM_CONCURRENCY = Math.max(1, Number(process.env.PLAN_STREAM_CONCURRENCY || 2));
const PLAN_BATCH_CONCURRENCY = Math.max(1, Number(process.env.PLAN_BATCH_CONCURRENCY || 2));

const safeNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const inferSelectedSystems = (params, items) => {
  const systems = new Set();
  const list = Array.isArray(items) ? items : [];

  list.forEach((item) => {
    const type = String(item?.type || "");
    const name = String(item?.name || "");
    const sample = `${type} ${name}`;
    if (sample.includes("中控")) systems.add("中控系统");
    if (sample.includes("矩阵")) systems.add("矩阵系统");
    if (sample.includes("视频") || sample.includes("会议终端") || sample.includes("摄像")) systems.add("视频会议系统");
    if (sample.includes("录播")) systems.add("录播系统");
    if (sample.includes("话筒") || sample.includes("麦克风") || sample.includes("鹅颈") || sample.includes("领夹") || sample.includes("手持")) systems.add("话筒");
  });

  if (params?.hasCentralControl) systems.add("中控系统");
  if (params?.hasMatrix) systems.add("矩阵系统");
  if (params?.hasVideoConf) systems.add("视频会议系统");
  if (params?.hasRecording) systems.add("录播系统");

  const micCount =
    safeNumber(params?.micHandheld) +
    safeNumber(params?.micGooseneck) +
    safeNumber(params?.micOmni) +
    safeNumber(params?.micLavalier) +
    safeNumber(params?.micCeiling);
  if (micCount > 0 || (Array.isArray(params?.mics) && params.mics.length > 0)) {
    systems.add("话筒");
  }

  // 扩声系统默认作为基础系统，避免模型漏掉主链路
  systems.add("扩声系统");
  return Array.from(systems);
};

const buildPlanPrompt = ({ projectName, scenario, params, planTitle, items }) => {
  let templateText = "";
  try {
    templateText = readFileSync(PROMPT_TEMPLATE_FILE_URL, "utf-8");
  } catch (error) {
    console.warn("⚠️ Prompt template read failed, fallback to concise prompt:", error.message);
  }

  const truncatedTemplate = String(templateText || "").slice(0, 12000);
  const userInput = {
    scene: scenario === "LECTURE_HALL" ? "报告厅" : "会议室",
    length: safeNumber(params?.length),
    width: safeNumber(params?.width),
    height: safeNumber(params?.height),
    stage_to_near_audience: safeNumber(params?.stageToNearAudience),
    stage_to_far_audience: safeNumber(params?.stageToFarAudience),
    stage_width: safeNumber(params?.stageWidth),
    stage_depth: safeNumber(params?.stageDepth),
    selected_systems: inferSelectedSystems(params, items),
    extra_requirements: String(params?.extraRequirements || "")
  };

  const equipment = (Array.isArray(items) ? items : []).map((item) => ({
    设备分类: item?.type || "",
    设备名称: item?.name || "",
    品牌: item?.brand || "",
    型号: item?.model || "",
    数量: safeNumber(item?.quantity),
    单位: item?.unit || "台"
  }));

  return [
    "你是专业声学顾问，请根据输入生成可直接用于投标/验收的正式 Markdown 方案。",
    `项目名称: ${projectName}`,
    `方案标题: ${planTitle}`,
    "",
    "【用户输入】",
    JSON.stringify(userInput, null, 2),
    "",
    "【设备清单】",
    JSON.stringify(equipment, null, 2),
    "",
    "【输出约束】",
    "1. 仅输出 Markdown，不要输出 JSON。",
    "2. 设备型号和数量必须与设备清单一致，不得增删编造。",
    "3. 内容必须与场景匹配（会议室/报告厅）。",
    "4. 必须严格遵守模板中的目录结构和章节顺序。",
    "5. 只保留设备清单中实际存在的系统章节；无对应设备的系统章节必须整节删除（包含标题与正文）。",
    "6. 必须包含完整工程化文字描述，不可只给表格。",
    "7. 必须输出模板中要求的固定公式，并对每个公式给出不少于50字的原则与解释。",
    "8. 必须在方案中保留该占位符原文且不能改字：【后端自动插入：报告厅平面布局图】。",
    "9. 可按模板建议使用静态块占位符，例如 {{INSERT:STANDARDS_TABLE}}、{{INSERT:FORMULAS_BLOCK}}。",
    "",
    "【参考模板（节选）】",
    truncatedTemplate
  ].join("\n");
};

const PLAN_CHAPTERS = [
  { key: "project_overview", title: "项目概述" },
  { key: "design_basis_target", title: "设计依据和目标" },
  { key: "solution_design", title: "方案设计" },
  { key: "equipment_intro", title: "设备介绍" },
  { key: "decoration_suggestion", title: "装修建议" },
  { key: "environment_requirements", title: "环境要求" }
];

const CHAPTER_SHARED_RULES = [
  "总则",
  "你现在只负责分章节生成《{方案标题}》，严格遵守以下固定规则：",
  "1. 只生成我指定的单一章节，不生成其他内容、不生成目录、不总结、不提前写后面章节。",
  "2. 只保留设备清单中存在的系统，无设备的系统整节删除，不出现文字。",
  "3. 公式必须原样写在指定位置；图片统一用占位符【后端自动插入：XXX】。",
  "4. 语言正式工程化，符合投标/验收标准，格式规范。",
  "5. 我会按章节依次让你生成，你只返回当前章节内容。"
].join("\n");

const buildChapterTaskPrompt = (chapterKey, sceneLabel, selectedSystemsText) => {
  switch (chapterKey) {
    case "project_overview":
      return [
        "生成【第1章 项目概述】，包含：",
        "1.1 项目概况：按用户输入空间参数与场景撰写，覆盖大型会议、学术交流、文艺活动、培训、信息发布等用途。",
        "1.2 项目需求：按“需求牵引、瞄准前沿、确保可行、利于发展”撰写，实现多功能会议、智能管控、稳定高效。",
        "只返回本章内容。"
      ].join("\n");
    case "design_basis_target":
      return [
        "生成【第2章 设计依据和目标】，包含：",
        "2.1 设计依据：列出国家会议、扩声、音视频、录播、机房相关标准编号与名称。",
        "2.2 设计原则：先进性、成熟实用性、灵活性开放性、集成可扩展性、标准化模块化、安全性可靠性、服务便利性、经济性。",
        "2.3 设计目标：音视频统一管理、信号任意切换、扩声清晰、集中控制、满足录制存储。",
        "只返回本章内容。"
      ].join("\n");
    case "solution_design":
      return [
        `生成【第3章 方案设计】，当前场景为${sceneLabel}，当前设备系统为：${selectedSystemsText}。包含：`,
        "3.1 中心机房：统一管控、统一供电、设备集中部署。",
        "3.2 多功能报告厅/会议室：",
        "3.2.1 概况：面积、用途、设计系统清单。",
        "3.2.4 系统设计（只保留设备清单里有的系统）：",
        "3.2.4.2 专业扩声系统（必须完整）：系统概述、声学指标表格、声压计算、混响时间要求。",
        "声压计算中必须原样输出以下公式：",
        "Lp = SPL + 10logW - 20logr",
        "NAG(dB) = 20logD0 - 20logEAD",
        "PAG(dB) = 20logD0 + 20logD1 - 20logD2 - 20logDs - 10logNOM - FSM",
        "EPR = 10^X",
        "X =〔SPL + 3dB + (ΔD2 - Δref dist) - LSENSI〕/ 10",
        "Dc(m) = K × √(Q²V / T60)",
        "%ALcons ＝ 200² × D2² × T60² / V²Q",
        "并在下方按顺序插入：",
        "【后端自动插入：厅堂最佳混响时间标准图】",
        "【后端自动插入：500Hz总声压级3D图】",
        "3.2.4.3 视频会议系统。",
        "3.2.4.4 录播系统。",
        "无设备的系统整节删除。",
        "只返回本章内容。"
      ].join("\n");
    case "equipment_intro":
      return [
        "生成【第4章 设备介绍】，只包含设备清单里存在的系统分类：",
        "4.1 扩声系统设备",
        "4.2 视频会议系统设备",
        "4.3 录播系统设备",
        "4.4 显示系统设备",
        "按清单逐项写型号、数量、用途，无设备不写。",
        "只返回本章内容。"
      ].join("\n");
    case "decoration_suggestion":
      return [
        "生成【第5章 装修建议】，包含：",
        "5.1 装修概况：环保、防火、吸音、阻燃、现代美观。",
        "5.2 装修方案：吸音板墙面、木质吊顶、电动遮光窗帘、实木桌椅、三基色灯具、防静电地毯。",
        "5.3 会场布置：色调布局、灯光照度、音响效果。",
        "只返回本章内容。"
      ].join("\n");
    case "environment_requirements":
      return [
        "生成【第6章 环境要求】，包含：",
        "6.1 温湿度要求",
        "6.2 机房地面要求（防静电、承重）",
        "6.3 供电要求（一级负荷、净化电源、防干扰）",
        "6.4 接地要求（接地电阻≤4Ω，联合接地≤0.3Ω）",
        "6.5 设备连接工艺要求",
        "6.6 施工工艺标准",
        "内容按行业规范完整撰写。",
        "只返回本章内容。"
      ].join("\n");
    default:
      return `生成【${chapterKey}】对应章节，且只返回当前章节内容。`;
  }
};

const stripMarkdownFence = (text) =>
  String(text || "")
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

const ensureChapterHeading = (chapterTitle, markdown) => {
  const normalized = stripMarkdownFence(markdown);
  if (!normalized) return `## ${chapterTitle}\n\n（该章节暂无内容）`;
  if (new RegExp(`^##\\s+${chapterTitle}`).test(normalized)) return normalized;
  return `## ${chapterTitle}\n\n${normalized}`;
};

const composePlanMarkdown = ({ projectName, planTitle, chapterContents }) => {
  const topTitle = `# ${projectName}-${planTitle}系统设计方案`;
  const body = chapterContents.filter(Boolean).join("\n\n");
  return [topTitle, "", body].join("\n").trim();
};

const buildChapterPrompt = ({ projectName, scenario, params, planTitle, items, chapter }) => {
  const sceneLabel = scenario === "LECTURE_HALL" ? "报告厅" : "会议室";
  const userInput = {
    scene: sceneLabel,
    length: safeNumber(params?.length),
    width: safeNumber(params?.width),
    height: safeNumber(params?.height),
    stage_to_near_audience: safeNumber(params?.stageToNearAudience),
    stage_to_far_audience: safeNumber(params?.stageToFarAudience),
    stage_width: safeNumber(params?.stageWidth),
    stage_depth: safeNumber(params?.stageDepth),
    selected_systems: inferSelectedSystems(params, items),
    extra_requirements: String(params?.extraRequirements || "")
  };

  const equipment = (Array.isArray(items) ? items : []).map((item) => ({
    设备分类: item?.type || "",
    设备名称: item?.name || "",
    品牌: item?.brand || "",
    型号: item?.model || "",
    数量: safeNumber(item?.quantity),
    单位: item?.unit || "台"
  }));

  const selectedSystems = inferSelectedSystems(params, items);
  const selectedSystemsText = selectedSystems.length ? selectedSystems.join("、") : "无";
  const chapterTaskPrompt = buildChapterTaskPrompt(chapter.key, sceneLabel, selectedSystemsText);
  const rulesText = CHAPTER_SHARED_RULES.replace("{方案标题}", `${projectName}-${planTitle}`);

  return [
    rulesText,
    "",
    "【当前章节任务】",
    chapterTaskPrompt,
    "",
    "【用户输入】",
    JSON.stringify(userInput, null, 2),
    "",
    "【设备清单】",
    JSON.stringify(equipment, null, 2),
    "",
    "【输出要求】",
    `仅返回章节“${chapter.title}”正文，禁止输出其它章节与目录。`
  ].join("\n");
};

const generatePlanMarkdownByChapters = async ({
  projectName,
  scenario,
  params,
  planTitle,
  items
}) => {
  const prompt = buildPlanPrompt({
    projectName,
    scenario,
    params,
    planTitle,
    items
  });

  let markdown = "";
  let finalError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      markdown = await callArkMarkdown(prompt);
      finalError = null;
      break;
    } catch (error) {
      finalError = error;
      console.warn(`⚠️ Plan ${planTitle} generation failed on attempt ${attempt + 1}:`, error.message);
      if (attempt < 1) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
  }

  if (finalError) {
    throw new Error(`方案“${planTitle}”生成失败: ${finalError.message}`);
  }

  const normalized = stripMarkdownFence(markdown);
  if (!normalized) {
    return `# ${projectName}-${planTitle}系统设计方案\n\n（生成内容为空，请重试）`;
  }
  if (/^#\s+/.test(normalized)) {
    return normalized;
  }
  return `# ${projectName}-${planTitle}系统设计方案\n\n${normalized}`;
};

const runWithConcurrency = async (items, concurrency, worker) => {
  const list = Array.isArray(items) ? items : [];
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, list.length || 1));
  const results = new Array(list.length);
  let cursor = 0;

  const runner = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runner()));
  return results;
};

const extractArkMarkdown = (data) => {
  if (!data || typeof data !== "object") return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();

  const texts = [];
  if (Array.isArray(data.output)) {
    data.output.forEach((entry) => {
      if (typeof entry?.text === "string") texts.push(entry.text);
      if (Array.isArray(entry?.content)) {
        entry.content.forEach((part) => {
          if (typeof part?.text === "string") texts.push(part.text);
        });
      }
    });
  }

  if (Array.isArray(data.content)) {
    data.content.forEach((part) => {
      if (typeof part?.text === "string") texts.push(part.text);
    });
  }

  return texts.join("\n").trim();
};

const callArkMarkdown = async (prompt) => {
  const apiKey = process.env.ARK_API_KEY || "";
  if (!apiKey) {
    throw new Error("Missing ARK_API_KEY env variable");
  }

  const response = await axios.post(
    ARK_API_URL,
    {
      model: ARK_MODEL,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }]
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 180000
    }
  );

  const markdown = extractArkMarkdown(response.data);
  if (!markdown) {
    throw new Error("Ark returned empty markdown content");
  }
  return markdown;
};

const headingToAnchor = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^\w\s\-\u4e00-\u9fa5]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const generateToc = (markdown) => {
  const lines = String(markdown || "").split(/\r?\n/);
  const toc = [];
  for (const line of lines) {
    const matched = line.match(/^(#{2,6})\s+(.+)$/);
    if (!matched) continue;
    const level = matched[1].length;
    const title = matched[2].trim();
    const indent = "  ".repeat(level - 2);
    toc.push(`${indent}- [${title}](#${headingToAnchor(title)})`);
  }
  if (toc.length < 2) return "";
  return toc.join("\n");
};

const insertToc = (markdown) => {
  const toc = generateToc(markdown);
  if (!toc) return markdown;

  const lines = String(markdown || "").split(/\r?\n/);
  let insertAt = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#\s+/.test(lines[i])) {
      insertAt = i + 1;
      while (insertAt < lines.length && lines[insertAt].trim() === "") {
        insertAt += 1;
      }
      break;
    }
  }

  lines.splice(insertAt, 0, "", "## 目录", "", toc, "", "---", "");
  return lines.join("\n");
};

const injectStaticBlocks = (markdown, blockMap) => {
  const injected = [];
  const content = String(markdown || "").replace(/\{\{INSERT:([A-Z0-9_]+)\}\}/g, (_, key) => {
    if (blockMap[key]) {
      injected.push(key);
      return String(blockMap[key]);
    }
    return `<!-- WARNING: static block '${key}' not found -->`;
  });
  return { content, injected };
};

const postProcessMarkdown = (markdown, blockMap) => {
  const { content, injected } = injectStaticBlocks(markdown, blockMap);
  const withToc = insertToc(content);
  return {
    markdownProcessed: withToc,
    postProcessReport: {
      injected_blocks: injected,
      toc_added: withToc !== content
    }
  };
};

const loadStaticBlocksFromFiles = () => {
  try {
    const raw = JSON.parse(readFileSync(STATIC_BLOCKS_INDEX_FILE_URL, "utf-8"));
    const blocks = raw?.blocks || {};
    const blockMap = {};

    for (const [key, meta] of Object.entries(blocks)) {
      const sourceFile = String(meta?.file || "");
      if (!sourceFile) continue;
      const fileUrl = new URL(sourceFile, STATIC_BLOCKS_DIR_URL);
      if (!existsSync(fileUrl)) continue;
      blockMap[key] = readFileSync(fileUrl, "utf-8").trim();
    }
    return blockMap;
  } catch (error) {
    console.warn("⚠️ Failed to load static blocks from files:", error.message);
    return {};
  }
};

const loadEffectiveStaticBlockMap = async () => {
  try {
    const dbMap = await loadEnabledStaticBlockMap(pool);
    if (dbMap && Object.keys(dbMap).length > 0) {
      return dbMap;
    }
  } catch (error) {
    console.warn("⚠️ Failed to load static blocks from DB, fallback to files:", error.message);
  }
  return loadStaticBlocksFromFiles();
};

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const slugify = (value) =>
  String(value || "document")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "document";

const markdownToDocHtml = (markdown, title) => {
  const escaped = escapeHtml(markdown).replace(/\n/g, "<br/>");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
body { font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; line-height: 1.75; color: #1f2937; font-size: 13pt; margin: 24px; }
h1,h2,h3,h4 { color: #0f172a; }
pre { white-space: pre-wrap; word-wrap: break-word; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<pre>${escaped}</pre>
</body>
</html>`;
};

const saveGeneratedDoc = ({ projectName, planTitle, markdownProcessed }) => {
  const outDir = fileURLToPath(GENERATED_DOCS_DIR_URL);
  mkdirSync(outDir, { recursive: true });

  const fileBase = `${Date.now()}-${slugify(projectName)}-${slugify(planTitle)}`;
  const fileName = `${fileBase}.doc`;
  const filePath = fileURLToPath(new URL(`./${fileName}`, GENERATED_DOCS_DIR_URL));
  const docHtml = markdownToDocHtml(markdownProcessed, `${projectName} - ${planTitle}`);
  writeFileSync(filePath, docHtml, "utf-8");

  return {
    fileName,
    docLink: `/api/plan/documents/${encodeURIComponent(fileName)}`
  };
};

// --- 系统管理接口 ---
const SCRIPT_PATH_CANDIDATES = [
  process.env.MANAGE_BACKEND_SCRIPT,
  "/app/scripts/manage_backend.sh",
  "/app/manage_backend.sh",
  "/home/ubuntu/sunlong/acousticmaster/manage_backend.sh",
  "/home/ubuntu/zdh/manage_backend.sh"
].filter(Boolean);

const SCRIPT_PATH = SCRIPT_PATH_CANDIDATES.find((candidate) => existsSync(candidate)) || SCRIPT_PATH_CANDIDATES[0];
const hasManageScript = !!SCRIPT_PATH && existsSync(SCRIPT_PATH);

const runManageScript = (action, callback) => {
  if (!hasManageScript) {
    return callback(new Error(`manage_backend.sh not found. candidates=${SCRIPT_PATH_CANDIDATES.join(",")}`), "", "");
  }
  exec(`bash \"${SCRIPT_PATH}\" ${action}`, callback);
};

app.get("/api/system/ai-status", (req, res) => {
  runManageScript("status", (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: stderr || error.message });
    }
    const isRunning = stdout.includes("正在运行");
    res.json({ isRunning, raw: stdout });
  });
});

app.post("/api/system/ai-toggle", (req, res) => {
  const { action } = req.body; // 'start' or 'stop'
  console.log(`[AI-TOGGLE] Received action: ${action}`);

  if (!['start', 'stop'].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  // 特殊逻辑：如果是停止，先返回响应，再执行停止，防止服务端进程被杀导致连接中断
  if (action === 'stop') {
    res.json({ success: true, message: "Stopping service..." });
    setTimeout(() => {
      console.log("[AI-TOGGLE] Executing stop script...");
      runManageScript("stop", () => {
        // intentionally ignore async stop result to avoid blocking current response
      });
    }, 500);
    return;
  }

  // 如果是开启
  if (action === 'start') {
    // 检查是否已经在运行
    runManageScript("status", (err, stdout, stderr) => {
      if (err) {
        return res.status(500).json({ error: stderr || err.message });
      }
      if (stdout.includes("正在运行")) {
        return res.json({ success: true, message: "Service is already running." });
      }
      
      // 如果没运行（实际上这种逻辑很难在当前进程执行，因为如果没运行，接口就不会响应）
      // 所以 'start' 逻辑通常是给另一个独立管理进程用的，或者这里做个 restart
      runManageScript("start", (error, stdout, stderr) => {
        if (error) return res.status(500).json({ error: stderr || error.message });
        res.json({ success: true, message: stdout });
      });
    });
    return;
  }

  res.status(400).json({ error: "Unsupported operation" });
});

app.post("/api/chat-assistant", async (req, res) => {
  const { message, history = [], currentParams = {} } = req.body;
  const micTypeHint = Array.isArray(currentParams.micTypeOptions) && currentParams.micTypeOptions.length > 0
    ? currentParams.micTypeOptions.join('、')
    : '手持无线话筒、鹅颈会议话筒、全向阵列话筒、领夹话筒、吊装话筒';

  const systemPrompt = `你是一位专业的声学专家，负责引导用户补齐声学方案所需的参数。
当前场景：${currentParams.scenario === 'MEETING_ROOM' ? '会议室' : (currentParams.scenario === 'LECTURE_HALL' ? '报告厅' : '未定')}
当前参数完整状态：${JSON.stringify(currentParams)}

指令：
1. **第一步（场景确认）**：如果场景未定，请先确认用户是“会议室”还是“报告厅”。
2. **第二步（差异化询问）**：
   - **如果是会议室**：忽略所有舞台相关参数（stageWidth, stageDepth 等），只询问长、宽、高、话筒配置及子系统。
   - **如果是报告厅**：除了基本长宽高和话筒外，还需要引导用户提供舞台参数（stageWidth, stageDepth, stageToNearAudience, stageToFarAudience）。
3. **对话阶段**：简洁专业。在此阶段**不需要**输出 [UPDATE_PARAM] 标记。
4. **总结与更新时机**：只有当所有针对该场景的关键参数都已确认，且确认无其他需求时，才执行：
   - **最开头**一次性输出所有参数标记：[UPDATE_PARAM: {"key": "length", "value": 10}][UPDATE_PARAM: {"key": "scenario", "value": "MEETING_ROOM"}]...
   - **然后**给出详细清晰的参数总结清单。
   - **最后**指引用户说若信息未更新请输入更新全部参数，若信息没问题则点击页面下方的“启动方案设计”按钮。
5. 键名参考：length, width, height, micHandheld, micGooseneck, micOmni, micLavalier, micCeiling, hasCentralControl, hasMatrix, hasVideoConf, hasRecording。
6. 不要输出 <think> 标签。
7. 当你引导用户填写话筒配置时，必须先提示默认建议：
  - 报告厅默认：手领（型号 KU102）2个，鹅颈话筒（型号 KU204）2个。
  - 会议室默认：手领（型号 KU102）2个。
8. 话筒类型优先使用以下数据库可选项：${micTypeHint}。`;

  try {
    // 设置 Server-Sent Events (SSE) 头部供流式输出
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const response = await axios.post(LOCAL_LLM_URL, {
      model: LOCAL_LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: message }
      ],
      temperature: 0.1, 
      stream: true, 
      options: {
        num_ctx: 2048,
        stop: ["<think>", "</think>", "|im_end|"], 
        num_predict: 100
      }
    }, { 
      timeout: 120000,
      responseType: 'stream' 
    });

    response.data.on('data', chunk => {
      const payload = chunk.toString();
      const lines = payload.split('\n');
      for (const line of lines) {
        if (!line.trim() || line.includes('[DONE]')) continue;
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.replace('data: ', ''));
            const content = data.choices[0]?.delta?.content || "";
            if (content) {
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
          } catch (e) {
            // 解析失败时忽略
          }
        }
      }
    });

    response.data.on('end', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });

  } catch (error) {
    console.error("❌ Local LLM Stream failed:", error.message);
    res.write(`data: ${JSON.stringify({ error: "Local LLM service unavailable" })}\n\n`);
    res.end();
  }
});

app.post("/api/acoustic-intent", (req, res) => {
  const { acousticIntent } = req.body;
  if (!acousticIntent) {
    return res.status(400).json({ error: "Missing acousticIntent" });
  }
  // Deprecated endpoint: keep for backward compatibility without storing shared state.
  res.json({ ok: true });
});

// 🔥 修改：直接返回 Dify 的原始 answer，不做任何 JSON 解析
app.post("/api/run-dify-chatflow", async (req, res) => {
  const { acousticIntent, userId, guestId, username } = req.body || {};
  if (!acousticIntent) {
    return res.status(400).json({ error: "Missing acousticIntent" });
  }

  // === ⚠️ 替换为你自己的 Dify 信息（可用环境变量覆盖） ===
  const DIFY_API_KEY = "app-NB3lEaGg14fyON5fYhENY1oV"; // ← 已保留你的 key 
  // const DIFY_API_KEY = "app-rmJ6pmkpBuf4KGAChHYrcZBP";
  const DIFY_CHAT_API_URL = process.env.DIFY_CHAT_API_URL || "http://115.231.236.153:20000/v1/chat-messages";
  const queryText = isProduction ? "请执行声学方案设计流程。" : "请执行声学方案设计流程（测试）。";
  const maskKey = (key) => key ? `${key.slice(0, 4)}...${key.slice(-4)}` : "(empty)";
  console.log(`🔐 Dify config: url=${DIFY_CHAT_API_URL}, key=${maskKey(DIFY_API_KEY)}`);
  console.log(`🎯 Running Dify Chatflow in ${isProduction ? 'production' : 'development'} mode with query: "${queryText}"`);
  try {
    const userTag = userId ? `user_${userId}` : guestId ? `guest_${guestId}` : `anon_${Date.now()}`;
    const userLabel = username ? `${userTag}_${username}` : userTag;
    const acousticIntentJson = JSON.stringify(acousticIntent);
    console.log("🚀 Calling Dify Chatflow with intent:", acousticIntent);

    const response = await axios.post(
      DIFY_CHAT_API_URL,
      {
        inputs: {
          acoustic_intent_json: acousticIntentJson,
          acousticIntent: acousticIntentJson
        },
        query: queryText, // 👈 改为非空（避免 400）
        response_mode: "blocking",
        user: userLabel
      },
      {
        headers: {
          Authorization: `Bearer ${DIFY_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 1200000
      }
    );

    const answerText = response.data?.answer;
    if (!answerText) {
      throw new Error("Dify returned empty answer");
    }

    // ✅ 关键修改：不再尝试解析 JSON，直接返回原始文本
    const output = { raw_answer: answerText };
    console.log("✅ Raw Dify answer received (length: %d chars)", answerText.length);

    res.json(output); // 👈 前端通过 result.raw_answer 获取

  } catch (error) {
    console.error("❌ Dify Chat API failed:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to run Dify Chatflow",
      details: error.response?.data?.message || error.message
    });
  }
});

// 库存管理 CRUD
app.get("/api/inventory/:table", async (req, res) => {
  const table = getSafeTableName(req.params.table);
  if (!table) return res.status(400).json({ error: "Invalid table name" });

  try {
    const [rows] = await pool.query(`SELECT * FROM \`${table}\``);
    res.json(rows);
  } catch (error) {
    console.error("❌ Fetch inventory failed:", error.message);
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

app.get("/api/inventory/:table/detail", async (req, res) => {
  const table = getSafeTableName(req.params.table);
  if (!table) return res.status(400).json({ error: "Invalid table name" });

  const { model, name } = req.query;
  if (!model && !name) {
    return res.status(400).json({ error: "Missing model or name" });
  }

  try {
    const conditions = [];
    const values = [];
    if (model) {
      conditions.push("`型号` = ?");
      values.push(model);
    }
    if (name) {
      conditions.push("`产品名称` = ?");
      values.push(name);
    }

    const [rows] = await pool.query(
      `SELECT * FROM \`${table}\` WHERE ${conditions.join(" OR ")} LIMIT 1`,
      values
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("❌ Fetch inventory detail failed:", error.message);
    res.status(500).json({ error: "Failed to fetch inventory detail" });
  }
});

app.post("/api/inventory/:table", async (req, res) => {
  const table = getSafeTableName(req.params.table);
  if (!table) return res.status(400).json({ error: "Invalid table name" });

  const payload = req.body || {};
  try {
    const columns = await getTableColumns(table);
    const keys = Object.keys(payload).filter((key) => columns.includes(key));
    if (keys.length === 0) {
      return res.status(400).json({ error: "No valid columns in payload" });
    }

    const placeholders = keys.map(() => "?").join(", ");
    const fields = keys.map((key) => `\`${key}\``).join(", ");
    const values = keys.map((key) => payload[key]);
    const [result] = await pool.query(
      `INSERT INTO \`${table}\` (${fields}) VALUES (${placeholders})`,
      values
    );

    res.json({ id: result.insertId });
  } catch (error) {
    console.error("❌ Create inventory failed:", error.message);
    res.status(500).json({ error: "Failed to create inventory" });
  }
});

app.put("/api/inventory/:table/:id", async (req, res) => {
  const table = getSafeTableName(req.params.table);
  if (!table) return res.status(400).json({ error: "Invalid table name" });

  const payload = req.body || {};
  const recordId = req.params.id;

  try {
    const [columns, primaryKey] = await Promise.all([
      getTableColumns(table),
      getPrimaryKey(table)
    ]);

    const keys = Object.keys(payload).filter(
      (key) => columns.includes(key) && key !== primaryKey
    );
    if (keys.length === 0) {
      return res.status(400).json({ error: "No valid columns in payload" });
    }

    const setClause = keys.map((key) => `\`${key}\` = ?`).join(", ");
    const values = keys.map((key) => payload[key]);
    values.push(recordId);

    const [result] = await pool.query(
      `UPDATE \`${table}\` SET ${setClause} WHERE \`${primaryKey}\` = ?`,
      values
    );

    res.json({ affectedRows: result.affectedRows });
  } catch (error) {
    console.error("❌ Update inventory failed:", error.message);
    res.status(500).json({ error: "Failed to update inventory" });
  }
});

app.delete("/api/inventory/:table/:id", async (req, res) => {
  const table = getSafeTableName(req.params.table);
  if (!table) return res.status(400).json({ error: "Invalid table name" });

  const recordId = req.params.id;
  try {
    const primaryKey = await getPrimaryKey(table);
    const [result] = await pool.query(
      `DELETE FROM \`${table}\` WHERE \`${primaryKey}\` = ?`,
      [recordId]
    );
    res.json({ affectedRows: result.affectedRows });
  } catch (error) {
    console.error("❌ Delete inventory failed:", error.message);
    res.status(500).json({ error: "Failed to delete inventory" });
  }
});

// 用户管理与登录
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Missing username or password" });
  }

  try {
    const [rows] = await pool.query(
      "SELECT id, username, phone, company, role, password_hash FROM users WHERE username = ?",
      [username]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({
      id: user.id,
      username: user.username,
      phone: user.phone,
      company: user.company,
      role: user.role
    });
  } catch (error) {
    console.error("❌ Login failed:", error.message);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, username, phone, company, role, created_at AS createdAt FROM users ORDER BY id DESC"
    );
    res.json(rows);
  } catch (error) {
    console.error("❌ Fetch users failed:", error.message);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.post("/api/users", async (req, res) => {
  const { username, phone, company, role, password } = req.body || {};
  if (!username || !password || !role) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (username, phone, company, role, password_hash) VALUES (?, ?, ?, ?, ?)",
      [username, phone || "", company || "", role, passwordHash]
    );
    res.json({ id: result.insertId });
  } catch (error) {
    console.error("❌ Create user failed:", error.message);
    res.status(500).json({ error: "Failed to create user" });
  }
});

app.put("/api/users/:id", async (req, res) => {
  const userId = req.params.id;
  const { username, phone, company, role, password } = req.body || {};

  try {
    const fields = [];
    const values = [];
    if (username) { fields.push("username = ?"); values.push(username); }
    if (phone !== undefined) { fields.push("phone = ?"); values.push(phone); }
    if (company !== undefined) { fields.push("company = ?"); values.push(company); }
    if (role) { fields.push("role = ?"); values.push(role); }
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      fields.push("password_hash = ?");
      values.push(passwordHash);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(userId);
    const [result] = await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
      values
    );
    res.json({ affectedRows: result.affectedRows });
  } catch (error) {
    console.error("❌ Update user failed:", error.message);
    res.status(500).json({ error: "Failed to update user" });
  }
});

app.delete("/api/users/:id", async (req, res) => {
  const userId = req.params.id;
  try {
    const [result] = await pool.query("DELETE FROM users WHERE id = ?", [userId]);
    res.json({ affectedRows: result.affectedRows });
  } catch (error) {
    console.error("❌ Delete user failed:", error.message);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// 历史设计 CRUD
app.get("/api/history", async (req, res) => {
  const { userId, guestId } = req.query;
  try {
    let rows = [];
    if (userId) {
      [rows] = await pool.query(
        "SELECT * FROM design_history WHERE user_id = ? ORDER BY created_at DESC",
        [userId]
      );
    } else if (guestId) {
      [rows] = await pool.query(
        "SELECT * FROM design_history WHERE guest_id = ? ORDER BY created_at DESC",
        [guestId]
      );
    } else {
      [rows] = await pool.query(
        "SELECT * FROM design_history ORDER BY created_at DESC"
      );
    }

    const mapped = rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      guestId: row.guest_id,
      username: row.username,
      createdAt: row.created_at,
      projectName: row.project_name,
      scenario: row.scenario,
      params: parseJsonField(row.params_json, {}),
      results: parseJsonField(row.results_json, [])
    }));

    res.json(mapped);
  } catch (error) {
    console.error("❌ Fetch history failed:", error.message);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

app.post("/api/history", async (req, res) => {
  const { userId, guestId, username, projectName, scenario, params, results } = req.body || {};
  if (!username || !projectName || !scenario) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const [result] = await pool.query(
      "INSERT INTO design_history (user_id, guest_id, username, project_name, scenario, params_json, results_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [userId || null, guestId || null, username, projectName, scenario, JSON.stringify(params || {}), JSON.stringify(results || [])]
    );
    res.json({ id: result.insertId });
  } catch (error) {
    console.error("❌ Create history failed:", error.message);
    res.status(500).json({ error: "Failed to create history" });
  }
});

app.put("/api/history/:id", async (req, res) => {
  const historyId = req.params.id;
  const { projectName, scenario, params, results } = req.body || {};
  try {
    const fields = [];
    const values = [];
    if (projectName) { fields.push("project_name = ?"); values.push(projectName); }
    if (scenario) { fields.push("scenario = ?"); values.push(scenario); }
    if (params) { fields.push("params_json = ?"); values.push(JSON.stringify(params)); }
    if (results) { fields.push("results_json = ?"); values.push(JSON.stringify(results)); }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(historyId);
    const [result] = await pool.query(
      `UPDATE design_history SET ${fields.join(", ")} WHERE id = ?`,
      values
    );
    res.json({ affectedRows: result.affectedRows });
  } catch (error) {
    console.error("❌ Update history failed:", error.message);
    res.status(500).json({ error: "Failed to update history" });
  }
});

app.delete("/api/history/:id", async (req, res) => {
  const historyId = req.params.id;
  try {
    const [result] = await pool.query("DELETE FROM design_history WHERE id = ?", [historyId]);
    res.json({ affectedRows: result.affectedRows });
  } catch (error) {
    console.error("❌ Delete history failed:", error.message);
    res.status(500).json({ error: "Failed to delete history" });
  }
});

app.get("/api/static-blocks", async (req, res) => {
  try {
    const rows = await listStaticBlocks(pool);
    res.json(rows);
  } catch (error) {
    console.error("❌ List static blocks failed:", error.message);
    res.status(500).json({ error: "Failed to list static blocks" });
  }
});

app.put("/api/static-blocks/:blockKey", async (req, res) => {
  const blockKey = String(req.params.blockKey || "").trim().toUpperCase();
  if (!blockKey) {
    return res.status(400).json({ error: "Missing block key" });
  }

  try {
    const result = await updateStaticBlock(pool, blockKey, req.body || {});
    if (!result.updated) {
      return res.status(404).json({ error: "Static block not found or no fields updated", details: result.reason || "" });
    }
    res.json({ ok: true, blockKey });
  } catch (error) {
    console.error("❌ Update static block failed:", error.message);
    res.status(500).json({ error: "Failed to update static block" });
  }
});

app.get("/api/plan/documents/:fileName", (req, res) => {
  const rawName = decodeURIComponent(String(req.params.fileName || ""));
  const isSafeName = /^[a-zA-Z0-9\-_\.]+$/.test(rawName) && !rawName.includes("..") && !rawName.includes("/");
  if (!isSafeName) {
    return res.status(400).json({ error: "Invalid file name" });
  }

  const filePath = fileURLToPath(new URL(`./${rawName}`, GENERATED_DOCS_DIR_URL));
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: "Document not found" });
  }

  res.setHeader("Content-Type", "application/msword; charset=utf-8");
  res.sendFile(filePath);
});

app.post("/api/plan/generate-markdowns-stream", async (req, res) => {
  const { projectName, scenario, params, plans } = req.body || {};
  if (!projectName || !scenario || !params || !Array.isArray(plans) || plans.length === 0) {
    return res.status(400).json({ error: "Missing required fields: projectName, scenario, params, plans" });
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const sendSse = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  try {
    const staticBlockMap = await loadEffectiveStaticBlockMap();
    const planResults = await runWithConcurrency(plans, PLAN_STREAM_CONCURRENCY, async (plan) => {
      if (closed) {
        return { status: "aborted" };
      }

      const planStartAt = Date.now();
      const planId = plan?.id;
      const planTitle = String(plan?.title || "方案");
      const items = Array.isArray(plan?.items) ? plan.items : [];

      try {
        const markdownRaw = await generatePlanMarkdownByChapters({
          projectName: String(projectName),
          scenario: String(scenario),
          params,
          planTitle,
          items,
          onChapterStart: (chapter) => {
            if (closed) return;
            sendSse({
              event: "chapter-start",
              planId,
              title: planTitle,
              chapterKey: chapter.key,
              chapterTitle: chapter.title,
              elapsedMs: Date.now() - planStartAt
            });
          },
          onChapterComplete: (chapter, chapterMarkdown, partialMarkdown) => {
            if (closed) return;
            sendSse({
              event: "chapter-complete",
              planId,
              title: planTitle,
              chapterKey: chapter.key,
              chapterTitle: chapter.title,
              chapterMarkdown,
              partialMarkdown,
              elapsedMs: Date.now() - planStartAt
            });
          },
          onChapterError: (chapter, chapterError) => {
            if (closed) return;
            sendSse({
              event: "chapter-error",
              planId,
              title: planTitle,
              chapterKey: chapter.key,
              chapterTitle: chapter.title,
              message: chapterError?.message || "章节生成失败",
              elapsedMs: Date.now() - planStartAt
            });
          }
        });

        const { markdownProcessed, postProcessReport } = postProcessMarkdown(markdownRaw, staticBlockMap);
        const { docLink } = saveGeneratedDoc({
          projectName: String(projectName),
          planTitle,
          markdownProcessed
        });

        if (!closed) {
          sendSse({
            event: "plan-complete",
            planId,
            title: planTitle,
            markdownRaw,
            markdownProcessed,
            docLink,
            postProcessReport,
            elapsedMs: Date.now() - planStartAt
          });
        }

        return { status: "success" };
      } catch (error) {
        console.error(`❌ Plan stream generation failed (${planTitle}):`, error.response?.data || error.message);
        if (!closed) {
          sendSse({
            event: "plan-error",
            planId,
            title: planTitle,
            message: error.message,
            elapsedMs: Date.now() - planStartAt
          });
        }
        return { status: "failed", message: error.message };
      }
    });

    const summary = planResults.reduce(
      (acc, item) => {
        if (item?.status === "success") acc.success += 1;
        if (item?.status === "failed") acc.failed += 1;
        return acc;
      },
      { total: plans.length, success: 0, failed: 0 }
    );

    if (!closed) {
      sendSse({ event: "done", summary });
      res.end();
    }
  } catch (error) {
    console.error("❌ Generate markdown stream failed:", error.response?.data || error.message);
    if (!closed) {
      sendSse({ event: "fatal-error", message: error.message });
      res.end();
    }
  }
});

app.post("/api/plan/generate-markdowns", async (req, res) => {
  const { projectName, scenario, params, plans } = req.body || {};
  if (!projectName || !scenario || !params || !Array.isArray(plans) || plans.length === 0) {
    return res.status(400).json({ error: "Missing required fields: projectName, scenario, params, plans" });
  }

  try {
    const staticBlockMap = await loadEffectiveStaticBlockMap();
    const planResults = await runWithConcurrency(plans, PLAN_BATCH_CONCURRENCY, async (plan) => {
      const planTitle = String(plan?.title || "方案");
      const items = Array.isArray(plan?.items) ? plan.items : [];
      try {
        const markdownRaw = await generatePlanMarkdownByChapters({
          projectName: String(projectName),
          scenario: String(scenario),
          params,
          planTitle,
          items
        });

        const { markdownProcessed, postProcessReport } = postProcessMarkdown(markdownRaw, staticBlockMap);
        const { docLink } = saveGeneratedDoc({
          projectName: String(projectName),
          planTitle,
          markdownProcessed
        });

        return {
          ok: true,
          data: {
            id: plan?.id,
            title: planTitle,
            markdownRaw,
            markdownProcessed,
            docLink,
            postProcessReport
          }
        };
      } catch (error) {
        return {
          ok: false,
          data: {
            id: plan?.id,
            title: planTitle,
            message: error.message
          }
        };
      }
    });

    const generated = planResults.filter((item) => item?.ok).map((item) => item.data);
    const failed = planResults.filter((item) => !item?.ok).map((item) => item.data);

    const ok = generated.length > 0;
    if (!ok) {
      return res.status(500).json({
        error: "Failed to generate markdowns",
        failed
      });
    }

    res.json({ ok: true, projectName, generated, failed, documents: generated });
  } catch (error) {
    console.error("❌ Generate markdowns failed:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to generate markdowns",
      details: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

const backendDir = fileURLToPath(new URL("./", import.meta.url));
try {
  await ensureStaticBlockTableAndSeed(pool, backendDir);
  console.log("✅ Static markdown blocks ready");
} catch (error) {
  console.warn("⚠️ Static markdown blocks init failed:", error.message);
}

// 启动 - 支持环境变量动态指定端口
// 优先读取环境变量 PORT，没有则用默认值（测试3002/线上3001）
const DEFAULT_TEST_PORT = Number(process.env.TEST_PORT || 3002);
const DEFAULT_PROD_PORT = Number(process.env.PROD_PORT || 3001);
const PORT = Number(process.env.PORT || (isProduction ? DEFAULT_PROD_PORT : DEFAULT_TEST_PORT));
// 默认使用 3001，与 docker-compose/nginx upstream 保持一致
const DIFY_INTENT_HOST = process.env.DIFY_INTENT_HOST || "115.231.236.153";
const difyIntentUrl = `http://${DIFY_INTENT_HOST}:${PORT}/api/acoustic-intent/latest`;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🎧 Server running on http://0.0.0.0:${PORT}`);
  console.log(`🎯 Current environment: ${isProduction ? 'production' : 'development'}`);
});