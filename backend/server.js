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
  LOCAL_STATIC_RESOURCE_TABLE as SERVICE_LOCAL_STATIC_RESOURCE_TABLE,
  loadEnabledStaticBlockMap,
  updateStaticBlock
} from "./plan_service.js";

dotenv.config({ path: fileURLToPath(new URL("./.env", import.meta.url)) });

const app = express();
const defaultCorsOrigins = [
  "http://115.231.236.153:8100",
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
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "20mb" }));

const DB_CONFIG = {
  host: process.env.DB_HOST || "115.231.236.153",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "user1",
  password: process.env.DB_PASSWORD || "UasbecrD1!1",
  database: process.env.DB_NAME || "longdata_new",
  charset: "utf8mb4",
  connectionLimit: 10
};

const pool = mysql.createPool(DB_CONFIG);
const isProduction = process.env.NODE_ENV === 'production';
const LINE_ARRAY_SUPPORT_TABLE = "线阵列配套";
const SUBSYSTEM_TABLE = "子系统";
const LEGACY_SUBSYSTEM_TABLES = ["固定搭配场景剩余周边设备", "非固定搭配场景剩余周边设备"];
const INVENTORY_TABLES = [
  "音箱",
  LINE_ARRAY_SUPPORT_TABLE,
  "定阻功放",
  "周边设备",
  SUBSYSTEM_TABLE
];
const LEGACY_IMAGE_RESOURCE_TABLE = "图片资源管理";
const LOCAL_STATIC_RESOURCE_TABLE = SERVICE_LOCAL_STATIC_RESOURCE_TABLE;
const LOCAL_STATIC_RESOURCE_MANAGEMENT_TABLE = "本地静态资源管理";
const ALLOWED_TABLES = new Set([...INVENTORY_TABLES, LOCAL_STATIC_RESOURCE_TABLE, LOCAL_STATIC_RESOURCE_MANAGEMENT_TABLE]);
const RESOURCE_TYPE_IMAGE = "图片";
const RESOURCE_TYPE_TEXT = "文字";
const RESOURCE_TYPE_TABLE = "表格";
const PLAN_CHAPTER_TITLE_CANDIDATES = [
  "项目概述",
  "设计依据和目标",
  "方案设计",
  "设备介绍",
  "装修建议",
  "环境要求"
];

const normalizeChapterTitle = (value = "") =>
  String(value || "")
    .replace(/^第\s*\d+\s*[章节]\s*/g, "")
    .replace(/^\d+(?:\.\d+)*\s*/g, "")
    .replace(/^[、\.:：\-\s]+/g, "")
    .trim();

const normalizeStaticBlockKey = (value = "") =>
  String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);

const ensureStaticBlockKey = (value = "") => {
  const normalized = normalizeStaticBlockKey(value);
  return normalized || `BLOCK_${Date.now()}`;
};

const createManualResourceBlockKey = (title = "") => {
  const normalizedTitle = normalizeStaticBlockKey(title);
  const timePart = Date.now().toString(36).toUpperCase();
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  const base = normalizedTitle ? `USR_${normalizedTitle}_${timePart}_${randomPart}` : `USR_RESOURCE_${timePart}_${randomPart}`;
  return ensureStaticBlockKey(base);
};

const normalizeEnabledValue = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on", "是", "启用"].includes(normalized);
};

const normalizeResourceType = (value, fallback = RESOURCE_TYPE_TEXT) => {
  const normalized = String(value || "").trim();
  if (normalized === RESOURCE_TYPE_IMAGE || normalized === "image" || normalized === "图片资源") {
    return RESOURCE_TYPE_IMAGE;
  }
  if (normalized === RESOURCE_TYPE_TABLE || normalized === "table" || normalized === "markdown_table") {
    return RESOURCE_TYPE_TABLE;
  }
  if (normalized === RESOURCE_TYPE_TEXT || normalized === "text" || normalized === "文字" || normalized === "文本") {
    return RESOURCE_TYPE_TEXT;
  }
  if (normalized === "文字（表格）") {
    return fallback;
  }
  return fallback;
};

const inferResourceTypeFromContent = (content) => {
  const text = String(content || "").trim().toLowerCase();
  if (!text) return RESOURCE_TYPE_TEXT;
  if (
    text.startsWith("data:image/") ||
    /^!\[[^\]]*\]\([^\)]+\)$/.test(text) ||
    /https?:\/\/[^\s]+\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/.test(text)
  ) {
    return RESOURCE_TYPE_IMAGE;
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasPipeRow = lines.some((line) => /^\|.+\|$/.test(line));
  const hasTableDivider = lines.some((line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line));
  if (text.includes("<table") || (hasPipeRow && hasTableDivider)) {
    return RESOURCE_TYPE_TABLE;
  }
  return RESOURCE_TYPE_TEXT;
};

const normalizeSpeakerFunctionValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const text = String(value || "").trim();
  if (!text) return [];
  return text
    .split(/[、,，;；|/]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseCoverageAngles = (value) => {
  const text = String(value || "").trim();
  if (!text) {
    return {
      horizontal: "",
      vertical: ""
    };
  }
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*°?\s*[x×X＊*]\s*([0-9]+(?:\.[0-9]+)?)\s*°?/);
  if (!match) {
    return {
      horizontal: "",
      vertical: ""
    };
  }
  return {
    horizontal: match[1],
    vertical: match[2]
  };
};

const buildCoverageText = (horizontal, vertical) => {
  const h = String(horizontal ?? "").trim();
  const v = String(vertical ?? "").trim();
  if (!h || !v) return "";
  return `${h}°×${v}°`;
};

const isSpeakerLikeTable = (table) => table === "音箱" || table === LINE_ARRAY_SUPPORT_TABLE;

const asPositiveNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const asNumericText = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const matched = text.match(/^-?\d+(?:\.\d+)?/);
  return matched ? matched[0] : "";
};

const normalizeWithUnit = (value, unitType) => {
  const text = String(value ?? "").trim();
  if (!text) return text;

  if (unitType === "ohm") {
    const matched = text.match(/^(-?\d+(?:\.\d+)?)\s*(?:Ω|ohm)$/i);
    if (matched) return `${matched[1]}Ω`;
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return `${text}Ω`;
    return text;
  }

  if (unitType === "w") {
    const matched = text.match(/^(-?\d+(?:\.\d+)?)\s*w$/i);
    if (matched) return `${matched[1]}W`;
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return `${text}W`;
    return text;
  }

  if (unitType === "db") {
    const matched = text.match(/^(-?\d+(?:\.\d+)?)\s*db$/i);
    if (matched) return `${matched[1]}dB`;
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return `${text}dB`;
    return text;
  }

  return text;
};

const normalizeAcousticSpecUnits = (payload = {}) => {
  const next = { ...(payload || {}) };
  if (Object.prototype.hasOwnProperty.call(next, "额定阻抗")) {
    next["额定阻抗"] = normalizeWithUnit(next["额定阻抗"], "ohm");
  }
  if (Object.prototype.hasOwnProperty.call(next, "额定功率")) {
    next["额定功率"] = normalizeWithUnit(next["额定功率"], "w");
  }
  if (Object.prototype.hasOwnProperty.call(next, "灵敏度")) {
    next["灵敏度"] = normalizeWithUnit(next["灵敏度"], "db");
  }
  if (Object.prototype.hasOwnProperty.call(next, "最大声压级")) {
    next["最大声压级"] = normalizeWithUnit(next["最大声压级"], "db");
  }

  if (Object.prototype.hasOwnProperty.call(next, "水平覆盖角")) {
    next["水平覆盖角"] = asNumericText(next["水平覆盖角"]);
  }
  if (Object.prototype.hasOwnProperty.call(next, "垂直覆盖角")) {
    next["垂直覆盖角"] = asNumericText(next["垂直覆盖角"]);
  }

  return next;
};

const validateUnitField = (value, suffixPattern) => {
  const text = String(value || "").trim();
  if (!text) return false;
  return suffixPattern.test(text);
};

const validateSpeakerPayload = (payload = {}) => {
  const errors = [];
  const requiredKeys = [
    "类型",
    "品牌",
    "产品名称",
    "型号",
    "市场价",
    "额定阻抗",
    "额定功率",
    "灵敏度",
    "最大声压级",
    "覆盖角",
    "面高",
    "功能"
  ];

  requiredKeys.forEach((key) => {
    const value = payload[key];
    if (value === undefined || value === null || String(value).trim() === "") {
      errors.push(`${key}为必填项`);
    }
  });

  if (payload["市场价"] !== undefined && asPositiveNumber(payload["市场价"]) === null) {
    errors.push("市场价必须为大于0的数字");
  }
  if (payload["面高"] !== undefined && asPositiveNumber(payload["面高"]) === null) {
    errors.push("面高必须为大于0的数字");
  }
  if (payload["额定阻抗"] !== undefined && !validateUnitField(payload["额定阻抗"], /^\d+(?:\.\d+)?\s*(?:Ω|ohm|OHM)$/)) {
    errors.push("额定阻抗格式应为数值+Ω");
  }
  if (payload["额定功率"] !== undefined && !validateUnitField(payload["额定功率"], /^\d+(?:\.\d+)?\s*[wW]$/)) {
    errors.push("额定功率格式应为数值+W");
  }
  if (payload["灵敏度"] !== undefined && !validateUnitField(payload["灵敏度"], /^\d+(?:\.\d+)?\s*dB$/i)) {
    errors.push("灵敏度格式应为数值+dB");
  }
  if (payload["最大声压级"] !== undefined && !validateUnitField(payload["最大声压级"], /^\d+(?:\.\d+)?\s*dB$/i)) {
    errors.push("最大声压级格式应为数值+dB");
  }

  const coverage = parseCoverageAngles(payload["覆盖角"]);
  if (!coverage.horizontal || !coverage.vertical) {
    errors.push("覆盖角格式应为 水平°×垂直°");
  }

  const fnList = normalizeSpeakerFunctionValue(payload["功能"]);
  if (fnList.length === 0) {
    errors.push("功能至少选择1项");
  }

  return errors;
};

const validateLineArraySupportPayload = (support = {}) => {
  const errors = [];
  const subwoofer = support?.subwoofer || {};
  const hanger = support?.hanger || {};

  const subwooferRequired = [
    "类型",
    "产品名称",
    "型号",
    "市场价",
    "额定阻抗",
    "额定功率",
    "灵敏度",
    "最大声压级",
    "覆盖角",
    "面高",
    "品牌"
  ];
  subwooferRequired.forEach((key) => {
    const value = subwoofer[key];
    if (value === undefined || value === null || String(value).trim() === "") {
      errors.push(`次低音音箱-${key}为必填项`);
    }
  });

  const hangerRequired = ["产品名称", "型号", "市场价"];
  hangerRequired.forEach((key) => {
    const value = hanger[key];
    if (value === undefined || value === null || String(value).trim() === "") {
      errors.push(`线阵列吊挂架-${key}为必填项`);
    }
  });

  if (subwoofer["市场价"] !== undefined && asPositiveNumber(subwoofer["市场价"]) === null) {
    errors.push("次低音音箱-市场价必须为大于0的数字");
  }
  if (hanger["市场价"] !== undefined && asPositiveNumber(hanger["市场价"]) === null) {
    errors.push("线阵列吊挂架-市场价必须为大于0的数字");
  }

  if (subwoofer["额定阻抗"] !== undefined && !validateUnitField(subwoofer["额定阻抗"], /^\d+(?:\.\d+)?\s*(?:Ω|ohm|OHM)$/)) {
    errors.push("次低音音箱-额定阻抗格式应为数值+Ω");
  }
  if (subwoofer["额定功率"] !== undefined && !validateUnitField(subwoofer["额定功率"], /^\d+(?:\.\d+)?\s*[wW]$/)) {
    errors.push("次低音音箱-额定功率格式应为数值+W");
  }
  if (subwoofer["灵敏度"] !== undefined && !validateUnitField(subwoofer["灵敏度"], /^\d+(?:\.\d+)?\s*dB$/i)) {
    errors.push("次低音音箱-灵敏度格式应为数值+dB");
  }
  if (subwoofer["最大声压级"] !== undefined && !validateUnitField(subwoofer["最大声压级"], /^\d+(?:\.\d+)?\s*dB$/i)) {
    errors.push("次低音音箱-最大声压级格式应为数值+dB");
  }

  const coverage = parseCoverageAngles(subwoofer["覆盖角"]);
  if (subwoofer["覆盖角"] !== undefined && (!coverage.horizontal || !coverage.vertical)) {
    errors.push("次低音音箱-覆盖角格式应为 水平°×垂直°");
  }

  return errors;
};

const validateInventoryPayloadByTable = (table, payload = {}) => {
  if (table === "音箱") {
    return validateSpeakerPayload(payload);
  }

  if (table === LINE_ARRAY_SUPPORT_TABLE) {
    const useCase = String(payload["用途"] || "").trim();
    if (useCase === "挂架") {
      const required = ["产品名称", "型号", "市场价"];
      return required
        .filter((key) => payload[key] === undefined || payload[key] === null || String(payload[key]).trim() === "")
        .map((key) => `挂架-${key}为必填项`);
    }

    const required = [
      "类型",
      "产品名称",
      "型号",
      "市场价",
      "额定阻抗",
      "额定功率",
      "灵敏度",
      "最大声压级",
      "覆盖角",
      "面高",
      "品牌"
    ];
    const errors = required
      .filter((key) => payload[key] === undefined || payload[key] === null || String(payload[key]).trim() === "")
      .map((key) => `线阵列配套-${key}为必填项`);

    if (payload["市场价"] !== undefined && asPositiveNumber(payload["市场价"]) === null) {
      errors.push("线阵列配套-市场价必须为大于0的数字");
    }
    return errors;
  }

  return [];
};

const resolvePhysicalTableName = (table) => {
  if (table === LOCAL_STATIC_RESOURCE_MANAGEMENT_TABLE) return LOCAL_STATIC_RESOURCE_TABLE;
  if (table === LOCAL_STATIC_RESOURCE_TABLE) return LOCAL_STATIC_RESOURCE_TABLE;
  if (table === SUBSYSTEM_TABLE) {
    return process.env.SUBSYSTEM_TABLE_NAME || SUBSYSTEM_TABLE;
  }
  return table;
};

const getSafeTableName = (table) => {
  if (!table || !ALLOWED_TABLES.has(table)) return null;
  return table;
};

const isLocalStaticResourceTable = (table) =>
  table === LOCAL_STATIC_RESOURCE_TABLE || table === LOCAL_STATIC_RESOURCE_MANAGEMENT_TABLE;

const getTableColumns = async (table) => {
  const physicalTable = resolvePhysicalTableName(table);
  const [rows] = await pool.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    [DB_CONFIG.database, physicalTable]
  );
  return rows.map((row) => row.COLUMN_NAME);
};

const getColumnType = async (table, columnName) => {
  const physicalTable = resolvePhysicalTableName(table);
  const [rows] = await pool.query(
    "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
    [DB_CONFIG.database, physicalTable, columnName]
  );
  return String(rows?.[0]?.COLUMN_TYPE || "").trim();
};

const isAutoIncrementColumn = async (table, columnName = "id") => {
  const physicalTable = resolvePhysicalTableName(table);
  const [rows] = await pool.query(
    "SELECT EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
    [DB_CONFIG.database, physicalTable, columnName]
  );
  const extra = String(rows?.[0]?.EXTRA || "").toLowerCase();
  return extra.includes("auto_increment");
};

const ensureManualIdForInsert = async (table, payload = {}, queryExecutor = pool) => {
  const next = { ...(payload || {}) };
  if (next.id !== undefined && next.id !== null && String(next.id).trim() !== "") {
    return next;
  }

  const columns = await getTableColumns(table);
  if (!columns.includes("id")) return next;

  const autoIncrement = await isAutoIncrementColumn(table, "id");
  if (autoIncrement) return next;

  const physicalTable = resolvePhysicalTableName(table);
  const [rows] = await queryExecutor.query(
    `SELECT COALESCE(MAX(\`id\`), 0) + 1 AS nextId FROM \`${physicalTable}\``
  );
  next.id = Number(rows?.[0]?.nextId || 1);
  return next;
};

const tableExists = async (table) => {
  const physicalTable = resolvePhysicalTableName(table);
  const [rows] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1",
    [DB_CONFIG.database, physicalTable]
  );
  return Array.isArray(rows) && rows.length > 0;
};

const parseEnumColumnOptions = (columnType) => {
  const text = String(columnType || "").trim();
  if (!/^enum\(/i.test(text)) return [];
  const body = text.replace(/^enum\((.*)\)$/i, "$1");
  if (!body) return [];
  return body
    .split(/','/)
    .map((item) => item.replace(/^'/, "").replace(/'$/, "").replace(/\\'/g, "'"))
    .map((item) => item.trim())
    .filter(Boolean);
};

const getColumnEnumOptions = async (table, columnName) => {
  const physicalTable = resolvePhysicalTableName(table);
  const [rows] = await pool.query(
    "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
    [DB_CONFIG.database, physicalTable, columnName]
  );
  return parseEnumColumnOptions(rows?.[0]?.COLUMN_TYPE);
};

const getDistinctColumnValues = async (table, columnName) => {
  if (!(await tableExists(table))) return [];
  const columns = await getTableColumns(table);
  if (!columns.includes(columnName)) return [];

  const physicalTable = resolvePhysicalTableName(table);
  const [rows] = await pool.query(
    `SELECT DISTINCT \`${columnName}\` AS value FROM \`${physicalTable}\` WHERE \`${columnName}\` IS NOT NULL AND \`${columnName}\` <> ''`
  );
  return (Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.value || "").trim())
    .filter(Boolean);
};

const getSpeakerMetadataOptions = async () => {
  const fallbackProductTypes = ["全频音箱", "线阵列音箱", "台唇音箱", "拉声像音箱", "返听音箱", "超低音箱"];
  const fallbackFunctions = ["主扩声", "返听", "辅助扩声", "次低频补偿", "吊装", "壁挂", "吸顶", "舞台监听"];

  let productTypeOptions = await getColumnEnumOptions("音箱", "产品类型");
  if (productTypeOptions.length === 0) {
    productTypeOptions = await getColumnEnumOptions("音箱", "类型");
  }
  if (productTypeOptions.length === 0) {
    productTypeOptions = await getDistinctColumnValues("音箱", "产品类型");
  }
  if (productTypeOptions.length === 0) {
    productTypeOptions = await getDistinctColumnValues("音箱", "类型");
  }

  let functionOptions = await getColumnEnumOptions("音箱", "功能");
  if (functionOptions.length === 0) {
    const functionTexts = await getDistinctColumnValues("音箱", "功能");
    functionOptions = functionTexts.flatMap((value) =>
      String(value || "")
        .split(/[、,，;；|/]/)
        .map((item) => item.trim())
        .filter(Boolean)
    );
  }

  const normalizedProductTypeOptions = productTypeOptions.length > 0
    ? Array.from(new Set(productTypeOptions))
    : fallbackProductTypes;

  const normalizedFunctionOptions = functionOptions.length > 0
    ? Array.from(new Set(functionOptions))
    : fallbackFunctions;

  return {
    productTypeOptions: normalizedProductTypeOptions,
    functionOptions: normalizedFunctionOptions
  };
};

const getMicrophoneTypeOptions = async () => {
  if (!(await tableExists("周边设备"))) return [];

  const columns = await getTableColumns("周边设备");
  const physicalTable = resolvePhysicalTableName("周边设备");
  const hasTypeColumn = columns.includes("类型");
  const hasNameColumn = columns.includes("产品名称");
  if (!hasTypeColumn || !hasNameColumn) return [];

  const [nameRows] = await pool.query(
    `SELECT DISTINCT \`产品名称\` AS value
     FROM \`${physicalTable}\`
     WHERE TRIM(COALESCE(\`类型\`, '')) = '话筒'
       AND \`产品名称\` IS NOT NULL
       AND TRIM(\`产品名称\`) <> ''
     ORDER BY value ASC`
  );

  return Array.from(
    new Set(
      (Array.isArray(nameRows) ? nameRows : [])
        .map((row) => String(row?.value || "").trim())
        .filter(Boolean)
    )
  );
};

const getPrimaryKey = async (table) => {
  const physicalTable = resolvePhysicalTableName(table);
  const [rows] = await pool.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'",
    [DB_CONFIG.database, physicalTable]
  );
  if (rows.length > 0) return rows[0].COLUMN_NAME;

  const columns = await getTableColumns(physicalTable);
  if (columns.includes("id")) return "id";
  if (columns.includes("序号")) return "序号";
  if (columns.includes("型号")) return "型号";
  if (columns.includes("产品名称")) return "产品名称";
  return "id";
};

const normalizeSceneLabel = (scenario) =>
  String(scenario || "") === "LECTURE_HALL" ? "报告厅" : "会议室";

const normalizeStaticResourceRows = (rows, scenarioLabel, validChapterTitleSet) =>
  (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      const enabled = Number(row?.enabled ?? row?.是否启用 ?? 1);
      if (enabled === 0) return false;
      const scene = String(row?.使用场景 || "").trim();
      if (!scene || scene === "通用") return true;
      return scene === scenarioLabel;
    })
    .map((row) => {
      const resourceName = String(row?.title || row?.图片名称 || row?.block_key || `本地静态资源${row?.id || ""}`).trim();
      const chapterSource = String(row?.插入章节 || row?.目标章节 || "").trim();
      const explain = String(row?.description || row?.图片解释 || "").trim();
      const chapterTitle = normalizeChapterTitle(chapterSource);
      const content = String(row?.content || row?.资源内容 || row?.图片文件 || "").trim();
      const resourceType = normalizeResourceType(row?.资源类型, inferResourceTypeFromContent(content));
      return {
        id: Number(row?.id || 0),
        resourceName,
        resourceType,
        chapterTitle,
        explain,
        content
      };
    })
    .filter((row) => !!row.content && !!row.chapterTitle && validChapterTitleSet.has(row.chapterTitle));

const normalizeInventoryRowForResponse = (table, row, index = 0) => {
  const next = { ...(row || {}) };
  if (next.id === undefined || next.id === null || next.id === "") {
    if (next["序号"] !== undefined && next["序号"] !== null && String(next["序号"]) !== "") {
      next.id = Number(next["序号"]);
    } else {
      next.id = index + 1;
    }
  }

  if (table === SUBSYSTEM_TABLE) {
    if (!next["类型"] && next["设备类型"]) {
      next["类型"] = next["设备类型"];
    }
  }

  if (isSpeakerLikeTable(table)) {
    if (!next["产品类型"] && next["类型"]) {
      next["产品类型"] = next["类型"];
    }
    const coverage = parseCoverageAngles(next["覆盖角"]);
    if (!next["水平覆盖角"] && coverage.horizontal) {
      next["水平覆盖角"] = coverage.horizontal;
    }
    if (!next["垂直覆盖角"] && coverage.vertical) {
      next["垂直覆盖角"] = coverage.vertical;
    }
    const functionList = normalizeSpeakerFunctionValue(next["功能"]);
    if (functionList.length > 0) {
      next["功能"] = functionList;
    }
  }

  if (isLocalStaticResourceTable(table)) {
    const content = String(next.content || next["资源内容"] || next["图片文件"] || "");
    const resourceType = normalizeResourceType(next["资源类型"], inferResourceTypeFromContent(content));
    return {
      id: Number(next.id || index + 1),
      图片名称: String(next.title || next.block_key || `本地静态资源${next.id || index + 1}`).trim(),
      插入章节: String(next["插入章节"] || next["目标章节"] || "").trim(),
      使用场景: String(next["使用场景"] || "通用").trim(),
      图片解释: String(next.description || next["图片解释"] || "").trim(),
      资源类型: resourceType,
      资源内容: content,
      是否启用: Number(next.enabled ?? 1) === 1 ? "是" : "否"
    };
  }

  return next;
};

const mapInventoryPayloadToTable = (table, payload = {}) => {
  const next = normalizeAcousticSpecUnits(payload || {});

  if (table === SUBSYSTEM_TABLE) {
    if (next["类型"] && !next["设备类型"]) {
      next["设备类型"] = next["类型"];
    }
  }

  if (isSpeakerLikeTable(table)) {
    if (next["产品类型"] && !next["类型"]) {
      next["类型"] = String(next["产品类型"]).trim();
    }
    const coverageText = buildCoverageText(next["水平覆盖角"], next["垂直覆盖角"]);
    if (coverageText) {
      next["覆盖角"] = coverageText;
    }

    if (Object.prototype.hasOwnProperty.call(next, "功能")) {
      const functionList = normalizeSpeakerFunctionValue(next["功能"]);
      next["功能"] = functionList.join("、");
    }
  }

  if (isLocalStaticResourceTable(table)) {
    const hasTitle = Object.prototype.hasOwnProperty.call(next, "图片名称") || Object.prototype.hasOwnProperty.call(next, "title");
    const hasChapter = Object.prototype.hasOwnProperty.call(next, "插入章节");
    const hasLegacyChapter = Object.prototype.hasOwnProperty.call(next, "目标章节");
    const hasScene = Object.prototype.hasOwnProperty.call(next, "使用场景");
    const hasDescription = Object.prototype.hasOwnProperty.call(next, "图片解释") || Object.prototype.hasOwnProperty.call(next, "description");
    const hasContent = Object.prototype.hasOwnProperty.call(next, "资源内容") || Object.prototype.hasOwnProperty.call(next, "content");
    const hasLegacyImageContent = Object.prototype.hasOwnProperty.call(next, "图片文件");
    const hasResourceType = Object.prototype.hasOwnProperty.call(next, "资源类型") || Object.prototype.hasOwnProperty.call(next, "resourceType");
    const hasSource = Object.prototype.hasOwnProperty.call(next, "来源文件") || Object.prototype.hasOwnProperty.call(next, "source_file");
    const hasEnabled = Object.prototype.hasOwnProperty.call(next, "是否启用") || Object.prototype.hasOwnProperty.call(next, "enabled");
    const hasBlockKey = Object.prototype.hasOwnProperty.call(next, "标识键") || Object.prototype.hasOwnProperty.call(next, "block_key");

    if (hasTitle) {
      next.title = String(next["图片名称"] ?? next.title ?? "").trim();
    }
    if (hasChapter || hasLegacyChapter) {
      const chapter = String(next["插入章节"] ?? next["目标章节"] ?? "").trim();
      next["插入章节"] = chapter;
      next["目标章节"] = chapter;
    }
    if (hasScene) {
      next["使用场景"] = String(next["使用场景"] ?? "通用").trim() || "通用";
    }
    if (hasDescription) {
      next.description = String(next["图片解释"] ?? next.description ?? "").trim();
    }
    if (hasContent || hasLegacyImageContent) {
      const unifiedContent = String(next["资源内容"] ?? next["图片文件"] ?? next.content ?? "").trim();
      next.content = unifiedContent;
    }
    if (hasResourceType || hasLegacyImageContent) {
      const fallbackType = hasLegacyImageContent ? RESOURCE_TYPE_IMAGE : inferResourceTypeFromContent(next.content);
      next["资源类型"] = normalizeResourceType(next["资源类型"] ?? next.resourceType, fallbackType);
    }
    if (hasSource) {
      next.source_file = String(next["来源文件"] ?? next.source_file ?? "manual").trim() || "manual";
    }
    if (hasBlockKey) {
      const blockKeySource = String(next["标识键"] ?? next.block_key ?? "").trim();
      next.block_key = ensureStaticBlockKey(blockKeySource);
    }
    if (hasEnabled) {
      const enabledInput = Object.prototype.hasOwnProperty.call(next, "是否启用") ? next["是否启用"] : next.enabled;
      next.enabled = normalizeEnabledValue(enabledInput) ? 1 : 0;
    }
  }

  return next;
};

const getDeviceImageTableCandidates = (type) => {
  const text = String(type || "");
  if (!text) return ["周边设备"];
  if (text.includes("功放")) return ["定阻功放"];
  if (text.includes("音箱") || text.includes("线阵列")) return ["音箱", LINE_ARRAY_SUPPORT_TABLE];
  if (["中控系统", "矩阵", "视频会议系统", "录播系统"].includes(text)) {
    return [SUBSYSTEM_TABLE, ...LEGACY_SUBSYSTEM_TABLES];
  }
  return ["周边设备", SUBSYSTEM_TABLE, ...LEGACY_SUBSYSTEM_TABLES];
};

const parseVersionParts = (rawValue) => {
  const text = String(rawValue || "").trim();
  if (!text) return { outside: [], inside: [] };

  const match = text.match(/^(.*?)(?:\((.*?)\))?$/);
  const outsideRaw = String(match?.[1] || "").trim();
  const insideRaw = String(match?.[2] || "").trim();

  const splitBySlash = (input) => {
    if (!input) return [];
    return input
      .split("/")
      .map((part) => String(part || "").trim())
      .filter(Boolean);
  };

  return {
    outside: splitBySlash(outsideRaw),
    inside: splitBySlash(insideRaw)
  };
};

const parsePowerValue = (value) => {
  const matched = String(value || "").match(/-?\d+(?:\.\d+)?/);
  if (!matched) return null;
  const n = Number(matched[0]);
  return Number.isFinite(n) ? n : null;
};

const parseChannelValue = (value) => {
  const matched = String(value || "").match(/\d+/);
  if (!matched) return null;
  const n = Number(matched[0]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

const normalizeOhmValue = (value) => {
  const matched = String(value || "").match(/-?\d+(?:\.\d+)?/);
  if (!matched) return "";
  return `${matched[0]}Ω`;
};

const buildAmplifierVersions = (row) => {
  const powerParts = parseVersionParts(row?.额定功率);
  const impedanceParts = parseVersionParts(row?.额定阻抗);
  const channelParts = parseVersionParts(row?.通道数);

  const build = (mode, powerList, impedanceList, channelList) => {
    const len = Math.min(powerList.length, impedanceList.length, channelList.length);
    if (len <= 0) return [];
    const result = [];
    for (let i = 0; i < len; i += 1) {
      const power = parsePowerValue(powerList[i]);
      const impedance = normalizeOhmValue(impedanceList[i]);
      const channels = parseChannelValue(channelList[i]);
      if (!power || !impedance || !channels) continue;
      result.push({
        mode,
        power,
        impedance,
        channels
      });
    }
    return result;
  };

  return [
    ...build("normal", powerParts.outside, impedanceParts.outside, channelParts.outside),
    ...build("bridged", powerParts.inside, impedanceParts.inside, channelParts.inside)
  ];
};

const getScenarioPowerMultiplier = (scenario) => {
  const normalized = String(scenario || "").toUpperCase();
  return normalized === "LECTURE_HALL" ? 2.0 : 1.5;
};

const getSpeakerMatchTableCandidates = () => ["音箱", LINE_ARRAY_SUPPORT_TABLE];

const queryInventoryRecordByModelOrName = async ({ table, model, name }) => {
  if (!(await tableExists(table))) return null;

  const columns = await getTableColumns(table);
  const conditions = [];
  const values = [];

  if (columns.includes("型号") && model) {
    conditions.push("`型号` = ?");
    values.push(model);
  }
  if (columns.includes("产品名称") && name) {
    conditions.push("`产品名称` = ?");
    values.push(name);
  }
  if (conditions.length === 0) return null;

  const [rows] = await pool.query(
    `SELECT * FROM \`${resolvePhysicalTableName(table)}\` WHERE ${conditions.join(" OR ")} LIMIT 1`,
    values
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
};

const resolveSpeakerForAmpMatch = async (speakerPayload = {}) => {
  const model = String(speakerPayload.model || "").trim();
  const name = String(speakerPayload.name || "").trim();
  const quantityRaw = Number(speakerPayload.quantity);
  const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.ceil(quantityRaw) : 1;

  let ratedPower = parsePowerValue(
    speakerPayload.ratedPower
      ?? speakerPayload["额定功率"]
      ?? speakerPayload.power
  );
  let ratedImpedance = normalizeOhmValue(
    speakerPayload.ratedImpedance
      ?? speakerPayload["额定阻抗"]
      ?? speakerPayload.impedance
  );

  let source = "payload";
  if (!(ratedPower && ratedImpedance) && (model || name)) {
    const candidates = getSpeakerMatchTableCandidates();
    for (const table of candidates) {
      try {
        const row = await queryInventoryRecordByModelOrName({ table, model, name });
        if (!row) continue;
        const rowPower = parsePowerValue(row?.额定功率);
        const rowImpedance = normalizeOhmValue(row?.额定阻抗);
        if (rowPower && rowImpedance) {
          ratedPower = rowPower;
          ratedImpedance = rowImpedance;
          source = table;
          break;
        }
      } catch (error) {
        console.warn(`⚠️ resolveSpeakerForAmpMatch failed on table ${table}:`, error.message);
      }
    }
  }

  return {
    model,
    name,
    quantity,
    ratedPower,
    ratedImpedance,
    source
  };
};

const findAmpMatchVersion = ({ versions, targetPower, targetImpedance }) => {
  if (!Array.isArray(versions) || versions.length === 0) return null;
  for (const mode of ["normal", "bridged"]) {
    for (const version of versions) {
      if (version.mode !== mode) continue;
      if (version.impedance !== targetImpedance) continue;
      if (version.power < targetPower) continue;
      return version;
    }
  }
  return null;
};

const serializeAmpMatchResult = (row, version, speakerQuantity) => {
  const channels = Number(version?.channels || 0);
  const quantity = channels > 0 ? Math.ceil(Number(speakerQuantity || 1) / channels) : null;
  return {
    id: Number(row?.id || 0),
    name: String(row?.产品名称 || "").trim(),
    model: String(row?.型号 || "").trim(),
    brand: String(row?.品牌 || "").trim(),
    unitPrice: Number(row?.市场价 || 0),
    mode: version?.mode || "normal",
    matchedVersion: {
      power: Number(version?.power || 0),
      impedance: String(version?.impedance || ""),
      channels: Number(version?.channels || 0)
    },
    requiredQuantity: quantity
  };
};

const isSpeakerPlanType = (value) => {
  const text = String(value || "");
  return text.includes("音箱") || text.includes("线阵列");
};

const isAmplifierPlanType = (value) => {
  const text = String(value || "");
  return text.includes("功放");
};

const findPairedSpeakerForAmplifier = (items, amplifierIndex) => {
  if (!Array.isArray(items) || amplifierIndex < 0) return null;
  for (let i = amplifierIndex - 1; i >= 0; i -= 1) {
    const type = String(items[i]?.type || "");
    if (isSpeakerPlanType(type)) return { index: i, item: items[i] };
    if (isAmplifierPlanType(type)) break;
  }
  return null;
};

const ensureColumnExists = async (table, columnName, sqlDefinition) => {
  const [rows] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
    [DB_CONFIG.database, table, columnName]
  );
  if (rows.length > 0) return false;
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${columnName}\` ${sqlDefinition}`);
  return true;
};

const ensureInventorySchema = async () => {
  for (const table of INVENTORY_TABLES) {
    const physicalTable = resolvePhysicalTableName(table);
    if (!(await tableExists(table))) {
      console.warn(`⚠️ Inventory table not found, skipped schema ensure: ${physicalTable}`);
      continue;
    }

    const columns = await getTableColumns(table);
    if (!columns.includes("id")) {
      await pool.query(`ALTER TABLE \`${physicalTable}\` ADD COLUMN \`id\` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST`);
    } else {
      const idColumnType = (await getColumnType(table, "id")) || "bigint";
      const [pkRows] = await pool.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'",
        [DB_CONFIG.database, physicalTable]
      );
      if (pkRows.length === 0) {
        try {
          await pool.query(`ALTER TABLE \`${physicalTable}\` MODIFY COLUMN \`id\` ${idColumnType} NOT NULL`);
          await pool.query(`ALTER TABLE \`${physicalTable}\` ADD PRIMARY KEY (\`id\`)`);
        } catch (error) {
          console.warn(`⚠️ Failed to promote id as primary key for ${physicalTable}:`, error.message);
        }
      }

      try {
        await pool.query(`ALTER TABLE \`${physicalTable}\` MODIFY COLUMN \`id\` ${idColumnType} NOT NULL AUTO_INCREMENT`);
      } catch (error) {
        const message = String(error?.message || "");
        if (!/foreign key constraint/i.test(message)) {
          console.warn(`⚠️ Failed to set id as auto_increment for ${physicalTable}:`, message);
        }
      }
    }

    await ensureColumnExists(physicalTable, "设备图片", "LONGTEXT NULL");
    await ensureColumnExists(physicalTable, "品牌", "TEXT NULL");
  }

  try {
    if (await tableExists("音箱")) {
      await ensureColumnExists("音箱", "功能", "TEXT NULL");
    }
    if (await tableExists(LINE_ARRAY_SUPPORT_TABLE)) {
      await ensureColumnExists(LINE_ARRAY_SUPPORT_TABLE, "功能", "TEXT NULL");
    }
  } catch (error) {
    console.warn("⚠️ Speaker extra columns ensure failed:", error.message);
  }

};

const ensureMergedStaticResourceSchemaAndMigrate = async () => {
  await ensureColumnExists(LOCAL_STATIC_RESOURCE_TABLE, "资源类型", "VARCHAR(32) NULL");

  await pool.query(
    `UPDATE \`${LOCAL_STATIC_RESOURCE_TABLE}\`
     SET \`资源类型\` = ?
     WHERE \`资源类型\` IS NULL OR \`资源类型\` = ''`,
    [RESOURCE_TYPE_TEXT]
  );

  await pool.query(
    `UPDATE \`${LOCAL_STATIC_RESOURCE_TABLE}\`
     SET \`资源类型\` = ?
     WHERE \`资源类型\` = '文字（表格）'`,
    [RESOURCE_TYPE_TEXT]
  );

  try {
    const [legacyTableRows] = await pool.query(
      "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1",
      [DB_CONFIG.database, LEGACY_IMAGE_RESOURCE_TABLE]
    );

    if (!Array.isArray(legacyTableRows) || legacyTableRows.length === 0) {
      return;
    }

    await pool.query(
      `INSERT INTO \`${LOCAL_STATIC_RESOURCE_TABLE}\` (
         block_key,
         title,
         description,
         source_file,
         content,
         \`插入章节\`,
         \`使用场景\`,
         \`资源类型\`,
         enabled
       )
       SELECT
         CONCAT('LEGACY_IMAGE_', CAST(\`id\` AS CHAR)),
         COALESCE(NULLIF(\`图片名称\`, ''), CONCAT('图片资源', \`id\`)),
         COALESCE(\`图片解释\`, ''),
         'legacy-image-resource',
         COALESCE(\`图片文件\`, ''),
         COALESCE(NULLIF(\`插入章节\`, ''), NULLIF(\`目标章节\`, ''), ''),
         COALESCE(NULLIF(\`使用场景\`, ''), '通用'),
         ?,
         1
       FROM \`${LEGACY_IMAGE_RESOURCE_TABLE}\`
       WHERE \`图片文件\` IS NOT NULL AND \`图片文件\` <> ''
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         description = VALUES(description),
         source_file = VALUES(source_file),
         content = VALUES(content),
         \`插入章节\` = VALUES(\`插入章节\`),
         \`使用场景\` = VALUES(\`使用场景\`),
         \`资源类型\` = VALUES(\`资源类型\`),
         enabled = VALUES(enabled)`,
      [RESOURCE_TYPE_IMAGE]
    );

    await pool.query(`DROP TABLE IF EXISTS \`${LEGACY_IMAGE_RESOURCE_TABLE}\``);
  } catch (error) {
    console.warn("⚠️ Legacy image resource migration skipped:", error.message);
  }
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

const ASSISTANT_PARAM_SCHEMA_KEYS = [
  "scenario",
  "length",
  "width",
  "height",
  "stageWidth",
  "stageDepth",
  "stageToNearAudience",
  "stageToFarAudience",
  "mics",
  "micsAction",
  "hasCentralControl",
  "hasMatrix",
  "hasVideoConf",
  "hasRecording",
  "extraRequirements",
  "scenarioConfirmed",
  "roomConfirmed",
  "stageConfirmed",
  "micsConfirmed",
  "subsystemsConfirmed",
  "extraRequirementsConfirmed"
];

const ASSISTANT_PARAM_SCHEMA_KEY_SET = new Set(ASSISTANT_PARAM_SCHEMA_KEYS);

const parseJsonFromModelContent = (content) => {
  if (content && typeof content === "object") return content;
  const text = String(content || "").trim();
  if (!text) return null;
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
};

const normalizeSchemaParamUpdates = (raw) => {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const key = String(item.key || "").trim();
      if (!ASSISTANT_PARAM_SCHEMA_KEY_SET.has(key)) return null;
      if (!Object.prototype.hasOwnProperty.call(item, "value")) return null;
      return { key, value: item.value };
    })
    .filter(Boolean);
};

const extractParamUpdatesBySchema = async ({ message, assistantText, currentParams, micTypeOptions }) => {
  const extractionPrompt = `你是参数抽取器。请从“用户输入 + 助手回复”中提取可用于更新左侧参数面板的结构化更新项。

要求：
1) 只输出明确可确认的参数，不要猜测。
2) 只允许输出 key 在给定枚举中的项。
3) 若没有可更新项，返回 {"updates":[]}。
4) mics 的 value 应为数组，元素示例：{"type":"一拖二无线手持话筒","count":2}。
5) micsAction 仅允许 replace/add/remove 之一。

当前参数快照：${JSON.stringify(currentParams || {})}
数据库话筒可选项：${JSON.stringify(Array.isArray(micTypeOptions) ? micTypeOptions : [])}
用户输入：${String(message || "")}
助手回复：${String(assistantText || "")}`;

  try {
    const extractionResp = await axios.post(
      LOCAL_LLM_URL,
      {
        model: LOCAL_LLM_MODEL,
        messages: [
          { role: "system", content: "你只做结构化参数抽取，严格输出 JSON。" },
          { role: "user", content: extractionPrompt }
        ],
        temperature: 0,
        stream: false,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "assistant_param_updates",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                updates: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      key: { type: "string", enum: ASSISTANT_PARAM_SCHEMA_KEYS },
                      value: { type: ["string", "number", "boolean", "object", "array", "null"] }
                    },
                    required: ["key", "value"]
                  }
                }
              },
              required: ["updates"]
            }
          }
        }
      },
      { timeout: 25000 }
    );

    const rawContent = extractionResp?.data?.choices?.[0]?.message?.content;
    const parsed = parseJsonFromModelContent(rawContent);
    if (!parsed || typeof parsed !== "object") return [];
    return normalizeSchemaParamUpdates(parsed.updates);
  } catch (error) {
    console.warn("⚠️ Schema param extraction failed:", error?.response?.data || error.message);
    return [];
  }
};
const ARK_API_URL = process.env.ARK_API_URL || "https://ark.cn-beijing.volces.com/api/v3/responses";
const ARK_MODEL = process.env.ARK_MODEL || "doubao-seed-2-0-pro-260215";
const PROMPT_TEMPLATE_FILE_URL = new URL("./大模型方案生成指导模板.md", import.meta.url);
const STATIC_BLOCKS_INDEX_FILE_URL = new URL("./static_blocks/index.json", import.meta.url);
const STATIC_BLOCKS_DIR_URL = new URL("./static_blocks/", import.meta.url);
const GENERATED_DOCS_DIR_URL = new URL("./generated_docs/", import.meta.url);
const PLAN_STREAM_CONCURRENCY = Math.max(1, Number(process.env.PLAN_STREAM_CONCURRENCY || 2));
const PLAN_BATCH_CONCURRENCY = Math.max(1, Number(process.env.PLAN_BATCH_CONCURRENCY || 2));
const PLAN_TRACE_LOG_ENABLED = String(process.env.PLAN_TRACE_LOG_ENABLED || "1") !== "0";
const PLAN_TRACE_FULL_TEXT = String(process.env.PLAN_TRACE_FULL_TEXT || "0") === "1";
const PLAN_TRACE_PREVIEW_MAX = Math.max(400, Number(process.env.PLAN_TRACE_PREVIEW_MAX || 2000));
const PLAN_ARK_MAX_ATTEMPTS = Math.max(1, Number(process.env.PLAN_ARK_MAX_ATTEMPTS || 1));

const createTraceId = (prefix = "trace") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const clipTraceText = (value) => {
  const text = String(value || "");
  if (PLAN_TRACE_FULL_TEXT || text.length <= PLAN_TRACE_PREVIEW_MAX) {
    return { text, totalLength: text.length, truncated: false };
  }
  return {
    text: `${text.slice(0, PLAN_TRACE_PREVIEW_MAX)}\n...[truncated ${text.length - PLAN_TRACE_PREVIEW_MAX} chars]`,
    totalLength: text.length,
    truncated: true
  };
};

const clipTraceJson = (value) => {
  try {
    return clipTraceText(JSON.stringify(value));
  } catch (error) {
    return clipTraceText(String(value));
  }
};

const tracePlanEvent = (stage, context = {}, details = {}) => {
  if (!PLAN_TRACE_LOG_ENABLED) return;
  const nowMs = Date.now();
  const payload = {
    tag: "PLAN_TRACE",
    stage,
    at: new Date(nowMs).toISOString(),
    ts: nowMs,
    ...context,
    ...details
  };
  try {
    console.log(`[PLAN_TRACE] ${JSON.stringify(payload)}`);
  } catch (error) {
    console.log("[PLAN_TRACE]", stage, context, details);
  }
};

const safeNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const shouldRetryArkRequest = (error) => {
  const status = Number(error?.response?.status || 0);
  if (status === 429 || status >= 500) return true;

  const code = String(error?.code || "").toUpperCase();
  return [
    "ECONNABORTED",
    "ETIMEDOUT",
    "ECONNRESET",
    "EPIPE",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED"
  ].includes(code);
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

const toWrappedImageToken = (token) => `{{${token}}}`;

const normalizeDevicePlaceholderName = (value = "") =>
  String(value || "")
    .replace(/[\s\u3000]+/g, "")
    .trim();

const sanitizeImageAltText = (text, fallback = "图片") => {
  const cleaned = String(text || "").replace(/[\[\]\r\n]/g, " ").trim();
  return cleaned || fallback;
};

const sanitizeResourceTitle = (text, fallback = "资源") => {
  const cleaned = String(text || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
};

const renderTypedResourceMarkdown = (asset = {}, token = "", captionCounter = { image: 0, table: 0 }) => {
  const resourceType = normalizeResourceType(asset.resourceType, inferResourceTypeFromContent(asset.content || asset.src));
  const rawContent = String(asset.content || asset.src || "").trim();
  if (!rawContent) return "";

  const resourceTitle = sanitizeResourceTitle(asset.title || asset.alt || token, "资源");
  if (resourceType === RESOURCE_TYPE_TEXT) {
    return rawContent;
  }

  if (resourceType === RESOURCE_TYPE_TABLE) {
    captionCounter.table += 1;
    return `表 ${captionCounter.table} ${resourceTitle}\n\n${rawContent}`;
  }

  captionCounter.image += 1;
  return `![${sanitizeImageAltText(asset.alt || resourceTitle, resourceTitle)}](${rawContent})\n\n图 ${captionCounter.image} ${resourceTitle}`;
};

const renderDeviceImageMarkdown = (asset = {}, deviceName = "", captionCounter = { image: 0, table: 0 }) => {
  const rawContent = String(asset.src || "").trim();
  if (!rawContent) return "";

  captionCounter.image += 1;
  const title = sanitizeResourceTitle(deviceName || asset.deviceName || asset.alt, "设备图片");
  return `![${sanitizeImageAltText(asset.alt || title, title)}](${rawContent})\n\n图 ${captionCounter.image} ${title}`;
};

const buildImagePromptSection = (imageContext = {}) => {
  const common = Array.isArray(imageContext?.commonImageGuidance) ? imageContext.commonImageGuidance : [];
  const deviceGuidance = Array.isArray(imageContext?.devicePlaceholderGuidance) ? imageContext.devicePlaceholderGuidance : [];
  if (common.length === 0 && deviceGuidance.length === 0) return "";

  const lines = [];
  lines.push("【本地静态资源占位符规则】");
  lines.push("A. 你只能使用后端提供的占位符，禁止编造任何新占位符。");
  lines.push("B. 资源类型为“图片”时，只能输出占位符 {{RES_IMAGE_xxx}}；不要输出 base64、URL 或 HTML 图片标签。");
  lines.push("C. 资源类型为“文字”时，只能输出占位符 {{RES_TEXT_xxx}}，后端会替换为对应 Markdown 内容。");
  lines.push("D. 资源类型为“表格”时，只能输出占位符 {{RES_TABLE_xxx}}，后端会替换为对应 Markdown 表格并自动添加表题。");
  lines.push("E. 输出资源占位符时建议先写“资源解释”文本，再单独一行输出占位符，便于后端排版。");
  lines.push("F. 设备名称必须与“可插入设备图片列表”逐字一致，设备占位符需单独成行，后端会替换为真实图片并自动添加图题。");

  if (common.length > 0) {
    lines.push("");
    lines.push("【本地静态资源（按章节）】");
    common.forEach((item) => {
      lines.push(`- 章节: ${item.chapterTitle}`);
      lines.push(`  资源名称: ${item.imageName}`);
      lines.push(`  资源类型: ${item.resourceType || RESOURCE_TYPE_TEXT}`);
      lines.push(`  资源解释: ${item.explain || "（无）"}`);
      lines.push(`  占位符: ${toWrappedImageToken(item.token)}`);
    });
  }

  if (deviceGuidance.length > 0) {
    const added = new Set();
    lines.push("");
    lines.push("【可插入设备图片列表（仅限以下设备）】");
    deviceGuidance.forEach((item) => {
      const deviceName = String(item?.deviceName || "").trim();
      if (!deviceName || added.has(deviceName)) return;
      added.add(deviceName);
      lines.push(`- ${deviceName} -> [图片占位符：${deviceName}]`);
    });
  } else {
    lines.push("");
    lines.push("【可插入设备图片列表】");
    lines.push("当前无可用设备图片，禁止输出任何 [图片占位符：...]。\n");
  }

  return lines.join("\n");
};

const buildPlanPrompt = ({ projectName, scenario, params, planTitle, items, imageContext = {} }) => {
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

  const imagePromptSection = buildImagePromptSection(imageContext);

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
    "7. 必须输出模板中要求的固定公式，并对每个公式给出不少于50字的原则与解释，解释另起一段不直接跟在公式后面。",
    "8. 可按模板建议使用静态块占位符，例如 {{INSERT:STANDARDS_TABLE}}、{{INSERT:FORMULAS_BLOCK}}。",
    "9. 设备清单中不包含图片字段，严禁输出 base64、图片 URL 或 HTML 图片标签。",
    "10. 本地静态资源的图片类型请使用 {{RES_IMAGE_xxx}}，文字类型请使用 {{RES_TEXT_xxx}}，表格类型请使用 {{RES_TABLE_xxx}}。",
    "11. 设备图片只能使用统一格式占位符 [图片占位符：设备名称]。",
    imagePromptSection,
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
  "3. 公式必须原样写在指定位置；设备图片统一使用 [图片占位符：设备名称]。",
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
        "无设备的系统整节删除，不出现文字。",
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
  items,
  imageContext = {},
  traceContext = {}
}) => {
  const prompt = buildPlanPrompt({
    projectName,
    scenario,
    params,
    planTitle,
    items,
    imageContext
  });

  let markdown = "";
  let finalError = null;
  for (let attempt = 0; attempt < PLAN_ARK_MAX_ATTEMPTS; attempt += 1) {
    try {
      markdown = await callArkMarkdown(prompt, {
        ...traceContext,
        attempt: attempt + 1
      });
      finalError = null;
      break;
    } catch (error) {
      finalError = error;
      console.warn(`⚠️ Plan ${planTitle} generation failed on attempt ${attempt + 1}:`, error.message);
      const canRetry = shouldRetryArkRequest(error);
      if (attempt < PLAN_ARK_MAX_ATTEMPTS - 1 && canRetry) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      } else {
        break;
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

const callArkMarkdown = async (prompt, traceContext = {}) => {
  const apiKey = process.env.ARK_API_KEY || "";
  if (!apiKey) {
    throw new Error("Missing ARK_API_KEY env variable");
  }

  const requestBody = {
    model: ARK_MODEL,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }]
      }
    ]
  };

  const requestStartAt = Date.now();
  tracePlanEvent("ark-request-send", traceContext, {
    arkUrl: ARK_API_URL,
    model: ARK_MODEL,
    prompt: clipTraceText(prompt),
    requestBody: clipTraceJson(requestBody)
  });

  let response;
  try {
    response = await axios.post(
      ARK_API_URL,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 180000
      }
    );
  } catch (error) {
    tracePlanEvent("ark-request-failed", traceContext, {
      elapsedMs: Date.now() - requestStartAt,
      message: error?.message || "Ark request failed",
      status: error?.response?.status,
      responseData: clipTraceJson(error?.response?.data || "")
    });
    throw error;
  }

  tracePlanEvent("ark-response-received", traceContext, {
    elapsedMs: Date.now() - requestStartAt,
    status: response.status,
    responseBody: clipTraceJson(response.data)
  });

  const markdown = extractArkMarkdown(response.data);
  tracePlanEvent("ark-markdown-extracted", traceContext, {
    markdown: clipTraceText(markdown)
  });
  if (!markdown) {
    throw new Error("Ark returned empty markdown content");
  }
  return markdown;
};

const loadCommonImageResources = async (scenario) => {
  const sceneLabel = normalizeSceneLabel(scenario);
  const validChapterTitleSet = new Set(PLAN_CHAPTER_TITLE_CANDIDATES.map((title) => normalizeChapterTitle(title)));
  try {
    const [rows] = await pool.query(
      `SELECT id, block_key, title, description, content, \`插入章节\`, \`使用场景\`, \`资源类型\`, enabled
       FROM \`${LOCAL_STATIC_RESOURCE_TABLE}\`
       WHERE content IS NOT NULL AND content <> ''`
    );
    return normalizeStaticResourceRows(rows, sceneLabel, validChapterTitleSet);
  } catch (error) {
    console.warn("⚠️ Load common image resources failed:", error.message);
    return [];
  }
};

const queryDeviceImageByItem = async (item) => {
  const tables = getDeviceImageTableCandidates(item?.type);
  const model = String(item?.model || "").trim();
  const name = String(item?.name || "").trim();

  for (const table of tables) {
    try {
      const columns = await getTableColumns(table);
      if (!columns.includes("设备图片")) continue;
      const hasModel = columns.includes("型号");
      const hasName = columns.includes("产品名称");
      if (!hasModel && !hasName) continue;

      const conditions = [];
      const values = [];
      if (hasModel && model) {
        conditions.push("`型号` = ?");
        values.push(model);
      }
      if (hasName && name) {
        conditions.push("`产品名称` = ?");
        values.push(name);
      }
      if (conditions.length === 0) continue;

      const [rows] = await pool.query(
        `SELECT 设备图片, 产品名称, 型号
         FROM \`${table}\`
         WHERE (${conditions.join(" OR ")}) AND 设备图片 IS NOT NULL AND 设备图片 <> ''
         LIMIT 1`,
        values
      );

      if (Array.isArray(rows) && rows.length > 0) {
        const first = rows[0] || {};
        return {
          imageData: String(first?.设备图片 || "").trim(),
          imageName: String(first?.产品名称 || name || first?.型号 || model || "设备图片").trim()
        };
      }
    } catch (error) {
      console.warn(`⚠️ Query device image failed (${table}):`, error.message);
    }
  }

  return null;
};

const buildPlanImageContext = async ({
  scenario,
  items,
  commonImageResources,
  deviceImageCache
}) => {
  const mediaAssetMap = {};
  const deviceImageByName = {};
  const devicePlaceholderGuidance = [];

  const commonImageGuidance = (Array.isArray(commonImageResources) ? commonImageResources : []).map((asset) => {
    const normalizedType = normalizeResourceType(asset.resourceType, inferResourceTypeFromContent(asset.content));
    let token = `RES_TEXT_${asset.id}`;
    if (normalizedType === RESOURCE_TYPE_IMAGE) {
      token = `RES_IMAGE_${asset.id}`;
    } else if (normalizedType === RESOURCE_TYPE_TABLE) {
      token = `RES_TABLE_${asset.id}`;
    }
    mediaAssetMap[token] = {
      resourceType: normalizedType,
      content: String(asset.content || "").trim(),
      alt: sanitizeImageAltText(asset.resourceName, "本地静态资源"),
      title: sanitizeResourceTitle(asset.resourceName, "本地静态资源")
    };
    return {
      chapterTitle: asset.chapterTitle,
      imageName: asset.resourceName,
      explain: asset.explain,
      token,
      resourceType: normalizedType
    };
  });

  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] || {};
    const cacheKey = `${String(item?.type || "")}||${String(item?.model || "")}||${String(item?.name || "")}`;
    let imageRecord = deviceImageCache.get(cacheKey);
    if (imageRecord === undefined) {
      imageRecord = await queryDeviceImageByItem(item);
      deviceImageCache.set(cacheKey, imageRecord || null);
    }

    if (!imageRecord || !imageRecord.imageData) continue;

    const deviceName = String(item?.name || item?.model || "").trim();
    const normalizedName = normalizeDevicePlaceholderName(deviceName);
    if (!normalizedName || deviceImageByName[normalizedName]) continue;

    deviceImageByName[normalizedName] = {
      src: imageRecord.imageData,
      alt: sanitizeImageAltText(imageRecord.imageName || deviceName || item?.model || "设备图片", "设备图片"),
      deviceName
    };
    devicePlaceholderGuidance.push({ deviceName });
  }

  return {
    mediaAssetMap,
    commonImageGuidance,
    deviceImageByName,
    devicePlaceholderGuidance
  };
};

const replaceMediaPlaceholders = (markdown, mediaAssetMap = {}, skipTokenSet = new Set(), captionCounter = { image: 0, table: 0 }) => {
  const replaced = [];
  const content = String(markdown || "").replace(/\{\{((?:IMG_[A-Z0-9_]+|RES_(?:IMAGE|TEXT|TABLE)_[A-Z0-9_]+))\}\}/g, (_, token) => {
    if (skipTokenSet.has(token)) {
      return `{{${token}}}`;
    }
    const asset = mediaAssetMap[token];
    if (!asset) {
      return `<!-- WARNING: resource placeholder '${token}' not found -->`;
    }

    const rawContent = String(asset.content || asset.src || "").trim();
    if (!rawContent) {
      return `<!-- WARNING: resource placeholder '${token}' has empty content -->`;
    }

    replaced.push(token);
    return renderTypedResourceMarkdown(asset, token, captionCounter);
  });
  return { content, replaced };
};

const stripCommonImagePlaceholders = (markdown, tokens = []) => {
  const tokenSet = new Set(Array.isArray(tokens) ? tokens : []);
  if (tokenSet.size === 0) return markdown;
  return String(markdown || "").replace(/\{\{((?:IMG_[A-Z0-9_]+|RES_(?:IMAGE|TEXT|TABLE)_[A-Z0-9_]+))\}\}/g, (_, token) => {
    if (tokenSet.has(token)) return "";
    return `{{${token}}}`;
  });
};

const replaceDeviceImagePlaceholders = (markdown, deviceImageByName = {}, captionCounter = { image: 0, table: 0 }) => {
  const replaced = [];
  const missing = [];
  const content = String(markdown || "").replace(/\[图片占位符[：:]\s*([^\]\r\n]+?)\s*\]/g, (full, rawName) => {
    const deviceName = String(rawName || "").trim();
    const normalizedName = normalizeDevicePlaceholderName(deviceName);
    const asset = normalizedName ? deviceImageByName[normalizedName] : null;
    if (!asset?.src) {
      if (deviceName) missing.push(deviceName);
      return full;
    }
    replaced.push(deviceName || String(asset?.deviceName || ""));
    return renderDeviceImageMarkdown(asset, deviceName, captionCounter);
  });

  return {
    content,
    replaced: Array.from(new Set(replaced.filter(Boolean))),
    missing: Array.from(new Set(missing.filter(Boolean)))
  };
};

const insertCommonImagesByChapterTitle = (markdown, commonImageGuidance = [], mediaAssetMap = {}, replacedTokens = [], captionCounter = { image: 0, table: 0 }) => {
  const lines = String(markdown || "").split(/\r?\n/);
  const replacedSet = new Set(Array.isArray(replacedTokens) ? replacedTokens : []);
  const inserted = [];

  const pendingByChapter = new Map();
  (Array.isArray(commonImageGuidance) ? commonImageGuidance : []).forEach((item) => {
    const token = String(item?.token || "").trim();
    const chapterTitle = normalizeChapterTitle(item?.chapterTitle || "");
    const asset = mediaAssetMap[token];
    const rawContent = String(asset?.content || asset?.src || "").trim();
    if (!token || !chapterTitle || !asset || !rawContent || replacedSet.has(token)) return;
    if (!pendingByChapter.has(chapterTitle)) {
      pendingByChapter.set(chapterTitle, []);
    }
    pendingByChapter.get(chapterTitle).push(item);
  });

  if (pendingByChapter.size === 0) {
    return { content: lines.join("\n"), inserted, skipped: [] };
  }

  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const matched = lines[i].match(/^(#{2,6})\s+(.+)$/);
    if (!matched) continue;
    headings.push({
      index: i,
      level: matched[1].length,
      title: matched[2].trim(),
      normalizedTitle: normalizeChapterTitle(matched[2].trim())
    });
  }

  const operations = [];
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    const chapterAssets = pendingByChapter.get(heading.normalizedTitle);
    if (!chapterAssets || chapterAssets.length === 0) continue;

    const chunks = [];
    chapterAssets.forEach((item) => {
      const token = String(item?.token || "").trim();
      const asset = mediaAssetMap[token];
      if (!token || !asset || replacedSet.has(token)) return;

      const renderedAssetMarkdown = renderTypedResourceMarkdown(
        {
          ...asset,
          title: String(asset.title || item?.imageName || token).trim()
        },
        token,
        captionCounter
      );
      if (!renderedAssetMarkdown) return;

      const explain = String(item?.explain || "").trim();
      if (explain) chunks.push(explain);
      chunks.push(renderedAssetMarkdown);
      inserted.push(token);
      replacedSet.add(token);
    });

    if (chunks.length === 0) continue;

    let insertAt = lines.length;
    for (let j = i + 1; j < headings.length; j += 1) {
      if (headings[j].level <= heading.level) {
        insertAt = headings[j].index;
        break;
      }
    }

    const insertLines = ["", chunks.join("\n\n"), ""];
    operations.push({ insertAt, insertLines });
    pendingByChapter.delete(heading.normalizedTitle);
  }

  operations
    .sort((a, b) => b.insertAt - a.insertAt)
    .forEach((operation) => {
      lines.splice(operation.insertAt, 0, ...operation.insertLines);
    });

  const skipped = [];
  pendingByChapter.forEach((chapterAssets) => {
    chapterAssets.forEach((item) => {
      const token = String(item?.token || "").trim();
      if (token && !replacedSet.has(token)) skipped.push(token);
    });
  });

  return {
    content: lines.join("\n"),
    inserted,
    skipped
  };
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

const postProcessMarkdown = (markdown, blockMap, mediaAssetMap = {}, commonImageGuidance = [], deviceImageByName = {}) => {
  const { content, injected } = injectStaticBlocks(markdown, blockMap);
  const withToc = insertToc(content);
  const captionCounter = { image: 0, table: 0 };
  const commonTokens = (Array.isArray(commonImageGuidance) ? commonImageGuidance : [])
    .map((item) => String(item?.token || "").trim())
    .filter(Boolean);
  const commonTokenSet = new Set(commonTokens);
  const { content: withImages, replaced } = replaceMediaPlaceholders(withToc, mediaAssetMap, commonTokenSet, captionCounter);
  const {
    content: withChapterImages,
    inserted: chapterInserted,
    skipped: chapterSkipped
  } = insertCommonImagesByChapterTitle(withImages, commonImageGuidance, mediaAssetMap, replaced, captionCounter);
  const cleanedMarkdown = stripCommonImagePlaceholders(withChapterImages, commonTokens);
  const {
    content: withDeviceImages,
    replaced: deviceReplaced,
    missing: deviceMissing
  } = replaceDeviceImagePlaceholders(cleanedMarkdown, deviceImageByName, captionCounter);
  const replacedAll = Array.from(new Set([...(Array.isArray(replaced) ? replaced : []), ...chapterInserted]));
  return {
    markdownProcessed: withDeviceImages,
    postProcessReport: {
      injected_blocks: injected,
      toc_added: withToc !== content,
      replaced_resource_placeholders: replacedAll,
      chapter_inserted_resources: chapterInserted,
      chapter_skipped_resources: chapterSkipped,
      replaced_image_placeholders: replacedAll,
      chapter_inserted_images: chapterInserted,
      chapter_skipped_images: chapterSkipped,
      replaced_device_placeholders: deviceReplaced,
      missing_device_placeholders: deviceMissing,
      figure_caption_count: captionCounter.image,
      table_caption_count: captionCounter.table
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
  let dbMicTypeOptions = [];
  try {
    dbMicTypeOptions = await getMicrophoneTypeOptions();
  } catch (error) {
    console.warn("⚠️ Load microphone types for assistant failed:", error.message);
  }

  const micTypeHint = Array.isArray(dbMicTypeOptions) && dbMicTypeOptions.length > 0
    ? dbMicTypeOptions.join('、')
    : '暂无可选话筒（数据库中未查询到话筒数据）';

  const normalizedMicOptions = Array.from(new Set(
    (Array.isArray(dbMicTypeOptions) ? dbMicTypeOptions : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
  const scenarioForSuggestion = currentParams.scenario === 'LECTURE_HALL' ? 'LECTURE_HALL' : 'MEETING_ROOM';
  const preferredMicTypes = scenarioForSuggestion === 'LECTURE_HALL'
    ? ['一拖二无线手持话筒', '一拖二无线鹅颈麦克风']
    : ['一拖二无线手持话筒'];

  const defaultMicLines = preferredMicTypes
    .filter((name) => normalizedMicOptions.includes(name))
    .map((name) => `${name} 2个`);

  const micDefaultSuggestion = defaultMicLines.length > 0
    ? defaultMicLines.join('；')
    : '当前场景的默认话筒在数据库中不存在，请直接从可选话筒数据库中选择并填写数量。';

  const promptParams = {
    ...currentParams,
    micTypeOptions: dbMicTypeOptions
  };

  const systemPrompt = `你是一位专业的声学专家，负责引导用户补齐声学方案设计所需的各项参数。

【当前系统状态】
当前场景：${currentParams.scenario === 'MEETING_ROOM' ? '会议室' : (currentParams.scenario === 'LECTURE_HALL' ? '报告厅' : '未定')}
当前参数完整状态：${JSON.stringify(promptParams)}
可选话筒数据库：${micTypeHint}

【核心对话原则】
每次回复**只允许针对一个参数部分（即一个未确认的阶段）进行提问**，**绝不要**一次性抛出多个环节的问题，以免给用户造成压迫感。你需要根据当前的确认状态按顺序推进。
每轮最多只提出一个待确认点；未完成当前阶段前，禁止跨阶段追问。
当某些参数已通过 [UPDATE_PARAM] 更新到左侧参数面板后，不要在后续回复中反复粘贴完整参数清单；只简短说明“已更新到左侧面板，请确认/继续下一项”。
回答需保持简洁、专业。不要输出 eterminate标签。

【分步引导流程】（严格按顺序检查，停留在第一个为 false 的阶段）

**阶段 1：场景确认 (scenarioConfirmed)**
- 检查当前场景。如果场景未定，请先确认用户需要设计的是“会议室”还是“报告厅”。
- 确认后记录场景，并进入下一阶段。

**阶段 2：场地尺寸确认 (roomConfirmed)**
- 询问场地的长、宽、高。
- 收集齐全后确认本阶段，并进入下一阶段。

**阶段 3：舞台参数确认 (stageConfirmed)**
- **差异化处理**：
  - 如果场景是**“会议室”**：忽略所有舞台参数，直接将 stageConfirmed 设为 true，并跳至阶段 4。
  - 如果场景是**“报告厅”**：必须询问舞台相关参数（舞台宽 stageWidth、舞台深 stageDepth、舞台到最近观众距离 stageToNearAudience、舞台到最远观众距离 stageToFarAudience）。

**阶段 4：话筒配置确认 (micsConfirmed)**
- 当进入此阶段时，**首先**向用户展示数据库中可选的话筒类型：${micTypeHint}。每种类型输出后换行以清晰展示
- **然后**仅基于数据库话筒类型给出默认建议并询问用户是否采用或修改：${micDefaultSuggestion}
- 严禁编造数据库中不存在的话筒类型、型号或名称；若数据库为空，必须明确告知“暂无可选话筒”。
- **话筒更新模式（必须区分）**：
   - 默认是**完全替换**：即删除原来的话筒列表，输出 micsAction=replace，并在 mics 中给出替换后的完整列表；
   - 用户明确说“新增/再加”时：输出 micsAction=add，mics 只放新增项；
   - 用户明确说“减少/删除/去掉”时：输出 micsAction=remove，mics 只放要减少/删除的项；
   - 话筒示例：
     [UPDATE_PARAM: {"key":"micsAction","value":"add"}]
     [UPDATE_PARAM: {"key":"mics","value":[{"type":"一拖二无线手持话筒","count":2}]}]
   - 话筒类型必须严格来自数据库可选项，严禁编造。

**阶段 5：子系统确认 (subsystemsConfirmed)**
- 询问用户对控制、矩阵、视讯、录播等子系统的需求。

**阶段 6：其他需求确认 (extraRequirementsConfirmed)**
- 询问是否还有其他特殊声学或设备要求。
- 若用户明确提出品牌偏好/品牌要求（例如“品牌为声可达”），必须视为其他需求的一部分，不能只写进话筒或设备描述里。

**阶段 7：总结与方案启动**
- 只有当上述所有阶段的关键参数和需求都已确认完毕时，才执行此阶段：
  - **首先**：在输出的最开头，一次性输出所有最终确认的参数标记（见下方标记规则）。
  - **然后**：给出一份详细、清晰、结构化的参数总结清单。
  - **补充要求**：如果 extraRequirements 不为空，必须在总结中单独增加一行“其他需求：...”；即使品牌偏好同时影响了话筒或其他设备，也不要把它只合并到设备描述里。
  - **保留要求**：如果前文已经出现过其他需求内容，进行全量参数更新时必须尽量保留并同步输出，不要因为未单独询问就把它省略。
  - **约束**：参数总结只能输出一次，禁止重复输出“参数总结如下/确认后的参数”等第二份总结。
  - **最后**：引导用户：“先等待5s进行参数校准，并优先查看左侧参数面板确认；若信息确认无误，请点击页面下方的‘启动方案设计’按钮。”

【参数更新与标记规则（非常重要）】
1. **输出标记**：在对话收集参数的阶段，只要用户提供了有效参数，就**需要**在回复中输出 [UPDATE_PARAM: {"key": "键名", "value": 值}] 标记更新对应数据及对应的 xxxConfirmed: true 状态。
2. **键名参考**：scenario, length, width, height, stageWidth, stageDepth, stageToNearAudience, stageToFarAudience, mics, micsAction, hasCentralControl, hasMatrix, hasVideoConf, hasRecording, extraRequirements, scenarioConfirmed, roomConfirmed, stageConfirmed, micsConfirmed, subsystemsConfirmed, extraRequirementsConfirmed。
3. **话筒更新模式（必须区分）**：
   - 默认是**完全替换**：删除原来的话筒列表，输出 micsAction=replace，并在 mics 中给出替换后的完整列表；
   - 用户明确说“新增/再加”时：输出 micsAction=add，mics 只放新增项；
   - 用户明确说“减少/删除/去掉”时：输出 micsAction=remove，mics 只放要减少/删除的项；
   - 话筒示例：
     [UPDATE_PARAM: {"key":"micsAction","value":"add"}]
     [UPDATE_PARAM: {"key":"mics","value":[{"type":"一拖二无线手持话筒","count":2}]}]
   - 话筒类型必须严格来自数据库可选项，严禁编造。
4. **子系统快照逻辑**：针对用户填写的子系统要求，默认完全替换。每次输出子系统更新时，**必须一次性**给出 4 个布尔键（hasCentralControl, hasMatrix, hasVideoConf, hasRecording）的完整快照，不遗漏任何一个。
5. **参数修改与回退**：如果用户在后续对话中修改了已确认过的某组参数，你需要将该组对应的确认状态（xxxConfirmed）改回 false（如果还需要追问），或者更新参数后重新设为 true。
6. **场景切换重置**：如果用户**切换了场景**（如从会议室换成报告厅），必须将除 scenario 之外的**所有**参数确认状态全部重置为 false，并重新从阶段 2 开始引导。
7. **其他需求入面板**：当用户提出“其他需求/特殊要求”时，必须输出：
  - [UPDATE_PARAM: {"key":"extraRequirements","value":"用户原话或整理后的需求"}]
  - [UPDATE_PARAM: {"key":"extraRequirementsConfirmed","value":true}]
  并在文字中提示“已写入左侧参数面板的其他需求”。`;

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
        stop: ["ändig", "ground", "|im_end|"], 
        num_predict: 100
      }
    }, { 
      timeout: 120000,
      responseType: 'stream' 
    });

    let assistantFullText = "";

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
              assistantFullText += content;
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
          } catch (e) {
            // 解析失败时忽略
          }
        }
      }
    });

    response.data.on('end', async () => {
      const schemaUpdates = await extractParamUpdatesBySchema({
        message,
        assistantText: assistantFullText,
        currentParams,
        micTypeOptions: dbMicTypeOptions
      });

      if (schemaUpdates.length > 0) {
        res.write(`data: ${JSON.stringify({ type: "param_update", payloads: schemaUpdates })}\n\n`);
      }
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
  const DIFY_API_KEY = "app-f3xzV8aGpe4crb7ezMFiSnwi"; // ← 已替换为最新 key
  // const DIFY_API_KEY = "app-rmJ6pmkpBuf4KGAChHYrcZBP";
  const DIFY_CHAT_API_URL = process.env.DIFY_CHAT_API_URL || "http://115.231.236.153:20000/v1/chat-messages";
  const queryText = "请执行声学方案设计流程。";
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

app.post("/api/plan/amplifier-match-analysis", async (req, res) => {
  const scenario = req.body?.scenario;
  const speakerInput = req.body?.speaker || {};
  const currentAmplifierInput = req.body?.currentAmplifier || null;
  const planItems = Array.isArray(req.body?.items) ? req.body.items : [];
  const amplifierIndex = Number(req.body?.amplifierIndex);

  let effectiveSpeakerInput = speakerInput;
  if ((!speakerInput?.model && !speakerInput?.name) && planItems.length > 0 && Number.isInteger(amplifierIndex)) {
    const paired = findPairedSpeakerForAmplifier(planItems, amplifierIndex);
    if (paired?.item) {
      effectiveSpeakerInput = {
        model: paired.item.model,
        name: paired.item.name,
        quantity: paired.item.quantity
      };
    }
  }

  try {
    const speaker = await resolveSpeakerForAmpMatch(effectiveSpeakerInput);
    if (!speaker.ratedPower || !speaker.ratedImpedance) {
      return res.status(400).json({
        error: "SPEAKER_SPEC_MISSING",
        message: "无法解析音箱额定功率/阻抗，请先完善音箱型号对应参数。"
      });
    }

    const powerMultiplier = getScenarioPowerMultiplier(scenario);
    const targetPower = Number((speaker.ratedPower * powerMultiplier).toFixed(3));
    const targetImpedance = speaker.ratedImpedance;

    if (!(await tableExists("定阻功放"))) {
      return res.json({
        ok: true,
        speaker,
        powerMultiplier,
        targetPower,
        targetImpedance,
        current: null,
        recommended: [],
        recommendation: null,
        needsConfirmation: false
      });
    }

    const [ampRows] = await pool.query(`SELECT * FROM \`${resolvePhysicalTableName("定阻功放")}\``);
    const amps = Array.isArray(ampRows) ? ampRows : [];

    const recommended = amps
      .map((row) => {
        const versions = buildAmplifierVersions(row);
        const matchedVersion = findAmpMatchVersion({
          versions,
          targetPower,
          targetImpedance
        });
        if (!matchedVersion) return null;
        return serializeAmpMatchResult(row, matchedVersion, speaker.quantity);
      })
      .filter(Boolean)
      .sort((a, b) => {
        const modeRank = (mode) => (mode === "normal" ? 0 : 1);
        const rankDiff = modeRank(a.mode) - modeRank(b.mode);
        if (rankDiff !== 0) return rankDiff;
        return Number(a.unitPrice || 0) - Number(b.unitPrice || 0);
      });

    const dedupRecommended = [];
    const seenModel = new Set();
    for (const item of recommended) {
      const model = String(item?.model || "");
      if (!model || seenModel.has(model)) continue;
      seenModel.add(model);
      dedupRecommended.push(item);
    }

    let current = null;
    if (currentAmplifierInput && (currentAmplifierInput.model || currentAmplifierInput.name)) {
      const model = String(currentAmplifierInput.model || "").trim();
      const name = String(currentAmplifierInput.name || "").trim();
      const matchedRow = amps.find((row) => {
        const rowModel = String(row?.型号 || "").trim();
        const rowName = String(row?.产品名称 || "").trim();
        if (model && rowModel === model) return true;
        if (name && rowName === name) return true;
        return false;
      });

      if (matchedRow) {
        const versions = buildAmplifierVersions(matchedRow);
        const matchedVersion = findAmpMatchVersion({
          versions,
          targetPower,
          targetImpedance
        });
        if (matchedVersion) {
          current = {
            matched: true,
            reason: "",
            ...serializeAmpMatchResult(matchedRow, matchedVersion, speaker.quantity)
          };
        } else {
          current = {
            matched: false,
            reason: "当前功放与音箱阻抗/功率不匹配",
            id: Number(matchedRow?.id || 0),
            name: String(matchedRow?.产品名称 || "").trim(),
            model: String(matchedRow?.型号 || "").trim(),
            brand: String(matchedRow?.品牌 || "").trim(),
            unitPrice: Number(matchedRow?.市场价 || 0),
            requiredQuantity: null,
            mode: null
          };
        }
      } else {
        current = {
          matched: false,
          reason: "未找到当前功放型号对应库存记录",
          id: 0,
          name: String(name || ""),
          model: String(model || ""),
          brand: "",
          unitPrice: 0,
          requiredQuantity: null,
          mode: null
        };
      }
    }

    const recommendation = dedupRecommended[0] || null;
    const needsConfirmation = Boolean(current && current.matched === false && recommendation);

    res.json({
      ok: true,
      speaker,
      powerMultiplier,
      targetPower,
      targetImpedance,
      current,
      recommended: dedupRecommended,
      recommendation,
      needsConfirmation
    });
  } catch (error) {
    console.error("❌ Amplifier match analysis failed:", error.message);
    res.status(500).json({
      error: "AMPLIFIER_MATCH_ANALYSIS_FAILED",
      message: error.message
    });
  }
});

const extractJsonPayloadFromText = (text) => {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const firstArrayStart = cleaned.indexOf("[");
  const lastArrayEnd = cleaned.lastIndexOf("]");
  if (firstArrayStart >= 0 && lastArrayEnd > firstArrayStart) {
    const arrayText = cleaned.slice(firstArrayStart, lastArrayEnd + 1);
    try {
      return JSON.parse(arrayText);
    } catch (error) {
      // Ignore and try object payload
    }
  }

  const firstObjStart = cleaned.indexOf("{");
  const lastObjEnd = cleaned.lastIndexOf("}");
  if (firstObjStart >= 0 && lastObjEnd > firstObjStart) {
    const objText = cleaned.slice(firstObjStart, lastObjEnd + 1);
    try {
      return JSON.parse(objText);
    } catch (error) {
      return null;
    }
  }

  return null;
};

const normalizeBatchItems = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === "object");
  if (Array.isArray(payload.items)) return payload.items.filter((item) => item && typeof item === "object");
  if (payload && typeof payload === "object") return [payload];
  return [];
};

const buildInventoryParsePrompt = ({ table, inputType, text }) => {
  const baseRules = [
    "你是设备信息结构化抽取助手。",
    `目标数据表：${table}。`,
    "请从输入内容中提取一个或多个设备，输出严格 JSON。",
    "输出格式必须是 JSON 数组，每个元素是一个设备对象。",
    "禁止输出任何解释性文字、markdown或代码块。",
    "字段名称必须使用中文数据库字段名。",
    "若无法识别字段，用空字符串。"
  ];

  if (table === "音箱") {
    baseRules.push(
      "音箱字段至少包含：产品类型、品牌、产品名称、型号、市场价、额定阻抗、额定功率、灵敏度、最大声压级、水平覆盖角、垂直覆盖角、面高、功能。",
      "若产品类型是线阵列音箱，额外返回 lineArraySupport 字段，包含 subwoofer 与 hanger 两个对象。",
      "subwoofer 字段至少包含：类型、产品名称、型号、市场价、额定阻抗、额定功率、灵敏度、最大声压级、水平覆盖角、垂直覆盖角、面高、品牌。",
      "hanger 字段至少包含：产品名称、型号、市场价。"
    );
  }

  if (inputType === "image") {
    baseRules.push("请直接基于图片内容识别设备参数并结构化输出。");
  }

  if (inputType === "chat") {
    baseRules.push("用户可能同时提供了文字描述和图片，请综合识别后结构化输出。");
  }

  baseRules.push("输入内容如下：");
  baseRules.push(String(text || "").trim() || "（仅图片，无文本补充）");

  return baseRules.join("\n");
};

const parseInventoryBatchByArk = async ({ table, inputType, text, imageData }) => {
  const apiKey = process.env.ARK_API_KEY || "";
  if (!apiKey) {
    throw new Error("Missing ARK_API_KEY env variable");
  }

  const prompt = buildInventoryParsePrompt({ table, inputType, text });
  const content = [{ type: "input_text", text: prompt }];

  if (String(imageData || "").trim()) {
    content.unshift({
      type: "input_image",
      image_url: String(imageData || "").trim()
    });
  }

  const requestBody = {
    model: ARK_MODEL,
    input: [
      {
        role: "user",
        content
      }
    ]
  };

  const response = await axios.post(ARK_API_URL, requestBody, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    timeout: 120000
  });

  const raw = extractArkMarkdown(response.data);
  const parsed = extractJsonPayloadFromText(raw);
  const items = normalizeBatchItems(parsed);
  if (items.length === 0) {
    throw new Error("LLM did not return valid JSON items");
  }
  return items;
};

app.post("/api/inventory/parse-batch", async (req, res) => {
  const table = getSafeTableName(req.body?.table);
  if (!table) {
    return res.status(400).json({ error: "Invalid table name" });
  }

  const inputType = String(req.body?.inputType || "chat").trim().toLowerCase();
  const text = String(req.body?.text || "").trim();
  const imageData = String(req.body?.imageData || "").trim();
  const clientItems = normalizeBatchItems(req.body?.items);

  try {
    let rawItems = clientItems;

    if (rawItems.length === 0 && text) {
      rawItems = normalizeBatchItems(extractJsonPayloadFromText(text));
    }

    if (rawItems.length === 0) {
      rawItems = await parseInventoryBatchByArk({ table, inputType, text, imageData });
    }

    const items = rawItems.map((item, index) => {
      const mapped = mapInventoryPayloadToTable(table, item || {});
      const errors = validateInventoryPayloadByTable(table, mapped);
      return {
        id: index + 1,
        payload: normalizeInventoryRowForResponse(table, mapped, index),
        errors,
        complete: errors.length === 0
      };
    });

    res.json({ items });
  } catch (error) {
    console.error("❌ Parse inventory batch failed:", error.message);
    res.status(422).json({
      error: "Failed to parse batch inventory",
      details: error.message,
      items: []
    });
  }
});

app.get("/api/inventory/speaker-metadata", async (req, res) => {
  try {
    const metadata = await getSpeakerMetadataOptions();
    res.json(metadata);
  } catch (error) {
    console.error("❌ Load speaker metadata failed:", error.message);
    res.status(500).json({
      error: "Failed to load speaker metadata",
      productTypeOptions: ["全频音箱", "线阵列音箱", "台唇音箱", "拉声像音箱", "返听音箱", "超低音箱"],
      functionOptions: ["主扩声", "返听", "辅助扩声", "次低频补偿", "吊装", "壁挂", "吸顶", "舞台监听"]
    });
  }
});

app.get("/api/inventory/microphone-types", async (req, res) => {
  try {
    const options = await getMicrophoneTypeOptions();
    res.json({ options });
  } catch (error) {
    console.error("❌ Load microphone types failed:", error.message);
    res.status(500).json({
      error: "Failed to load microphone types",
      options: []
    });
  }
});

// 库存管理 CRUD
app.get("/api/inventory/:table", async (req, res) => {
  const table = getSafeTableName(req.params.table);
  if (!table) return res.status(400).json({ error: "Invalid table name" });
  const physicalTable = resolvePhysicalTableName(table);

  try {
    const columns = await getTableColumns(table);
    const orderColumn = columns.includes("序号") ? "序号" : (columns.includes("id") ? "id" : "");
    const sql = orderColumn
      ? `SELECT * FROM \`${physicalTable}\` ORDER BY \`${orderColumn}\` ASC`
      : `SELECT * FROM \`${physicalTable}\``;
    const [rows] = await pool.query(sql);
    const normalized = (Array.isArray(rows) ? rows : []).map((row, index) =>
      normalizeInventoryRowForResponse(table, row, index)
    );
    res.json(normalized);
  } catch (error) {
    console.error("❌ Fetch inventory failed:", error.message);
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

app.get("/api/inventory/:table/detail", async (req, res) => {
  const table = getSafeTableName(req.params.table);
  if (!table) return res.status(400).json({ error: "Invalid table name" });
  const physicalTable = resolvePhysicalTableName(table);

  const { model, name } = req.query;
  if (!model && !name) {
    return res.status(400).json({ error: "Missing model or name" });
  }

  try {
    const columns = await getTableColumns(table);
    const conditions = [];
    const values = [];
    if (model && columns.includes("型号")) {
      conditions.push("`型号` = ?");
      values.push(model);
    }
    if (name && columns.includes("产品名称")) {
      conditions.push("`产品名称` = ?");
      values.push(name);
    }

    if (conditions.length === 0) {
      return res.status(400).json({ error: "No matched searchable columns in target table" });
    }

    const [rows] = await pool.query(
      `SELECT * FROM \`${physicalTable}\` WHERE ${conditions.join(" OR ")} LIMIT 1`,
      values
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    res.json(normalizeInventoryRowForResponse(table, rows[0], 0));
  } catch (error) {
    console.error("❌ Fetch inventory detail failed:", error.message);
    res.status(500).json({ error: "Failed to fetch inventory detail" });
  }
});

app.post("/api/inventory/:table", async (req, res) => {
  const table = getSafeTableName(req.params.table);
  if (!table) return res.status(400).json({ error: "Invalid table name" });
  const physicalTable = resolvePhysicalTableName(table);

  const rawBody = req.body || {};
  const payload = mapInventoryPayloadToTable(table, rawBody);
  const rawLineArraySupport = rawBody?.lineArraySupport || payload?.lineArraySupport || null;
  delete payload.lineArraySupport;

  try {
    if (isLocalStaticResourceTable(table)) {
      if (!payload.block_key) {
        payload.block_key = createManualResourceBlockKey(payload.title || payload["图片名称"] || "");
      }
      if (!Object.prototype.hasOwnProperty.call(payload, "source_file")) {
        payload.source_file = "manual";
      }
      if (!Object.prototype.hasOwnProperty.call(payload, "content")) {
        payload.content = String(payload.description || "");
      }
      if (!Object.prototype.hasOwnProperty.call(payload, "资源类型")) {
        payload["资源类型"] = normalizeResourceType("", inferResourceTypeFromContent(payload.content));
      }
      if (!Object.prototype.hasOwnProperty.call(payload, "enabled")) {
        payload.enabled = 1;
      }
      if (!Object.prototype.hasOwnProperty.call(payload, "使用场景")) {
        payload["使用场景"] = "通用";
      }
    }

    const validationErrors = validateInventoryPayloadByTable(table, payload);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: "Inventory payload validation failed",
        details: validationErrors
      });
    }

    const isLineArraySpeaker =
      table === "音箱" &&
      String(payload["类型"] || payload["产品类型"] || "").trim() === "线阵列音箱";

    let normalizedLineArraySupport = null;
    if (isLineArraySpeaker) {
      const supportPayload = rawLineArraySupport || {};
      const subwooferForValidation = mapInventoryPayloadToTable(LINE_ARRAY_SUPPORT_TABLE, {
        ...(supportPayload.subwoofer || {}),
        用途: "次低音箱"
      });
      const hangerForValidation = mapInventoryPayloadToTable(LINE_ARRAY_SUPPORT_TABLE, {
        ...(supportPayload.hanger || {}),
        类型: "线阵列音箱吊挂架",
        品牌: String((supportPayload.hanger || {}).品牌 || payload["品牌"] || "").trim(),
        用途: "挂架"
      });

      normalizedLineArraySupport = {
        subwoofer: subwooferForValidation,
        hanger: hangerForValidation
      };

      const supportErrors = validateLineArraySupportPayload(normalizedLineArraySupport);
      if (supportErrors.length > 0) {
        return res.status(400).json({
          error: "Line array support payload validation failed",
          details: supportErrors
        });
      }
    }

    const payloadForInsert = await ensureManualIdForInsert(table, payload);

    const columns = await getTableColumns(table);
    const keys = Object.keys(payloadForInsert).filter((key) => columns.includes(key));
    if (keys.length === 0) {
      return res.status(400).json({ error: "No valid columns in payload" });
    }

    const buildInsertSql = (targetTable, fieldKeys) => {
      const placeholders = fieldKeys.map(() => "?").join(", ");
      const fields = fieldKeys.map((key) => `\`${key}\``).join(", ");
      return `INSERT INTO \`${targetTable}\` (${fields}) VALUES (${placeholders})`;
    };

    if (!isLineArraySpeaker) {
      const values = keys.map((key) => payloadForInsert[key]);
      const [result] = await pool.query(buildInsertSql(physicalTable, keys), values);
      const createdId = Number(payloadForInsert.id || result.insertId || 0);
      return res.json({ id: createdId });
    }

    if (!(await tableExists(LINE_ARRAY_SUPPORT_TABLE))) {
      return res.status(400).json({ error: `Missing table: ${LINE_ARRAY_SUPPORT_TABLE}` });
    }

    const supportColumns = await getTableColumns(LINE_ARRAY_SUPPORT_TABLE);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const values = keys.map((key) => payloadForInsert[key]);
      const [mainResult] = await connection.query(buildInsertSql(physicalTable, keys), values);
      const mainId = Number(payloadForInsert.id || mainResult?.insertId || 0);

      const subwooferPayload = {
        ...((normalizedLineArraySupport && normalizedLineArraySupport.subwoofer) || {}),
        main_id: mainId
      };

      const hangerPayload = {
        ...((normalizedLineArraySupport && normalizedLineArraySupport.hanger) || {}),
        main_id: mainId
      };

      let insertedSupports = 0;
      const supportRows = [subwooferPayload, hangerPayload];
      for (const supportRow of supportRows) {
        const supportPayloadWithId = await ensureManualIdForInsert(LINE_ARRAY_SUPPORT_TABLE, supportRow, connection);
        const supportKeys = Object.keys(supportPayloadWithId).filter((key) => supportColumns.includes(key));
        if (supportKeys.length === 0) continue;
        const supportValues = supportKeys.map((key) => supportPayloadWithId[key]);
        await connection.query(buildInsertSql(LINE_ARRAY_SUPPORT_TABLE, supportKeys), supportValues);
        insertedSupports += 1;
      }

      await connection.commit();
      return res.json({
        id: mainId,
        lineArraySupportInserted: insertedSupports
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("❌ Create inventory failed:", error.message);
    res.status(500).json({ error: "Failed to create inventory" });
  }
});

app.put("/api/inventory/:table/:id", async (req, res) => {
  const table = getSafeTableName(req.params.table);
  if (!table) return res.status(400).json({ error: "Invalid table name" });
  const physicalTable = resolvePhysicalTableName(table);

  const payload = mapInventoryPayloadToTable(table, req.body || {});
  delete payload.lineArraySupport;
  const recordId = req.params.id;

  try {
    const validationErrors = validateInventoryPayloadByTable(table, payload);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: "Inventory payload validation failed",
        details: validationErrors
      });
    }

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
      `UPDATE \`${physicalTable}\` SET ${setClause} WHERE \`${primaryKey}\` = ?`,
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
  const physicalTable = resolvePhysicalTableName(table);

  const recordId = req.params.id;
  try {
    const primaryKey = await getPrimaryKey(table);
      if (table !== "音箱") {
        const [result] = await pool.query(
          `DELETE FROM \`${physicalTable}\` WHERE \`${primaryKey}\` = ?`,
          [recordId]
        );
        return res.json({ affectedRows: result.affectedRows });
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        let supportDeleted = 0;
        if (await tableExists(LINE_ARRAY_SUPPORT_TABLE)) {
          const supportColumns = await getTableColumns(LINE_ARRAY_SUPPORT_TABLE);
          if (supportColumns.includes("main_id")) {
            const [supportDeleteResult] = await connection.query(
              `DELETE FROM \`${LINE_ARRAY_SUPPORT_TABLE}\` WHERE \`main_id\` = ?`,
              [recordId]
            );
            supportDeleted = Number(supportDeleteResult?.affectedRows || 0);
          }
        }

        const [mainDeleteResult] = await connection.query(
          `DELETE FROM \`${physicalTable}\` WHERE \`${primaryKey}\` = ?`,
          [recordId]
        );

        await connection.commit();
        return res.json({
          affectedRows: Number(mainDeleteResult?.affectedRows || 0),
          lineArraySupportDeleted: supportDeleted
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
  } catch (error) {
    console.error("❌ Delete inventory failed:", error.message);
    res.status(500).json({ error: "Failed to delete inventory" });
  }
});

app.post("/api/inventory/:table/batch-delete", async (req, res) => {
  const table = getSafeTableName(req.params.table);
  if (!table) return res.status(400).json({ error: "Invalid table name" });
  const physicalTable = resolvePhysicalTableName(table);

  const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = Array.from(
    new Set(
      rawIds
        .map((value) => String(value ?? "").trim())
        .filter((value) => /^\d+$/.test(value))
    )
  );

  if (ids.length === 0) {
    return res.status(400).json({ error: "Missing valid ids" });
  }

  try {
    const primaryKey = await getPrimaryKey(table);
      const placeholders = ids.map(() => "?").join(", ");

      if (table !== "音箱") {
        const [result] = await pool.query(
          `DELETE FROM \`${physicalTable}\` WHERE \`${primaryKey}\` IN (${placeholders})`,
          ids
        );

        return res.json({
          affectedRows: Number(result?.affectedRows || 0),
          requestedRows: ids.length
        });
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        let supportDeleted = 0;
        if (await tableExists(LINE_ARRAY_SUPPORT_TABLE)) {
          const supportColumns = await getTableColumns(LINE_ARRAY_SUPPORT_TABLE);
          if (supportColumns.includes("main_id")) {
            const [supportDeleteResult] = await connection.query(
              `DELETE FROM \`${LINE_ARRAY_SUPPORT_TABLE}\` WHERE \`main_id\` IN (${placeholders})`,
              ids
            );
            supportDeleted = Number(supportDeleteResult?.affectedRows || 0);
          }
        }

        const [result] = await connection.query(
          `DELETE FROM \`${physicalTable}\` WHERE \`${primaryKey}\` IN (${placeholders})`,
          ids
        );

        await connection.commit();
        return res.json({
          affectedRows: Number(result?.affectedRows || 0),
          requestedRows: ids.length,
          lineArraySupportDeleted: supportDeleted
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
  } catch (error) {
    console.error("❌ Batch delete inventory failed:", error.message);
    res.status(500).json({ error: "Failed to batch delete inventory" });
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

app.post("/api/history/batch-delete", async (req, res) => {
  const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = Array.from(
    new Set(
      rawIds
        .map((value) => String(value ?? "").trim())
        .filter((value) => /^\d+$/.test(value))
    )
  );

  if (ids.length === 0) {
    return res.status(400).json({ error: "Missing valid ids" });
  }

  try {
    const placeholders = ids.map(() => "?").join(", ");
    const [result] = await pool.query(
      `DELETE FROM design_history WHERE id IN (${placeholders})`,
      ids
    );

    res.json({
      affectedRows: Number(result?.affectedRows || 0),
      requestedRows: ids.length
    });
  } catch (error) {
    console.error("❌ Batch delete history failed:", error.message);
    res.status(500).json({ error: "Failed to batch delete history" });
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

app.get("/api/plan/chapter-options", (req, res) => {
  const scenario = String(req.query.scenario || "MEETING_ROOM");
  const chapters = PLAN_CHAPTERS.map((chapter) => chapter.title);
  res.json({
    scenario,
    chapters
  });
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
  const routeTrace = {
    traceId: createTraceId("plan-stream"),
    route: "/api/plan/generate-markdowns-stream",
    projectName: String(projectName || ""),
    scenario: String(scenario || "")
  };

  tracePlanEvent("request-received", routeTrace, {
    planCount: Array.isArray(plans) ? plans.length : 0
  });

  if (!projectName || !scenario || !params || !Array.isArray(plans) || plans.length === 0) {
    tracePlanEvent("request-invalid", routeTrace, {
      reason: "Missing required fields: projectName, scenario, params, plans"
    });
    return res.status(400).json({ error: "Missing required fields: projectName, scenario, params, plans" });
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const sendSse = (payload) => {
    const withServerTime = {
      ...payload,
      serverSentAt: new Date().toISOString(),
      serverSentTs: Date.now(),
      traceId: routeTrace.traceId
    };
    const serialized = JSON.stringify(withServerTime);
    tracePlanEvent("frontend-payload-sent", {
      ...routeTrace,
      planId: payload?.planId,
      planTitle: payload?.title
    }, {
      event: payload?.event || "unknown",
      payloadBytes: Buffer.byteLength(serialized, "utf8")
    });
    res.write(`data: ${serialized}\n\n`);
  };

  let closed = false;
  req.on("close", () => {
    closed = true;
    tracePlanEvent("frontend-connection-closed", routeTrace);
  });

  try {
    const staticBlocksStartAt = Date.now();
    const staticBlockMap = await loadEffectiveStaticBlockMap();
    tracePlanEvent("static-blocks-loaded", routeTrace, {
      elapsedMs: Date.now() - staticBlocksStartAt,
      blockCount: Object.keys(staticBlockMap || {}).length
    });

    const commonImagesStartAt = Date.now();
    const commonImageResources = await loadCommonImageResources(String(scenario));
    tracePlanEvent("common-images-loaded", routeTrace, {
      elapsedMs: Date.now() - commonImagesStartAt,
      count: commonImageResources.length
    });
    const deviceImageCache = new Map();

    const planResults = await runWithConcurrency(plans, PLAN_STREAM_CONCURRENCY, async (plan) => {
      if (closed) {
        return { status: "aborted" };
      }

      const planStartAt = Date.now();
      const planId = plan?.id;
      const planTitle = String(plan?.title || "方案");
      const items = Array.isArray(plan?.items) ? plan.items : [];
      const planTrace = {
        ...routeTrace,
        planId,
        planTitle
      };

      tracePlanEvent("plan-start", planTrace, {
        itemCount: items.length
      });

      try {
        const imageContextStartAt = Date.now();
        const imageContext = await buildPlanImageContext({
          scenario: String(scenario),
          items,
          commonImageResources,
          deviceImageCache
        });
        tracePlanEvent("plan-image-context-ready", planTrace, {
          elapsedMs: Date.now() - imageContextStartAt,
          mediaCount: Object.keys(imageContext.mediaAssetMap || {}).length,
          commonImageCount: imageContext.commonImageGuidance?.length || 0,
          deviceImageCount: Object.keys(imageContext.deviceImageByName || {}).length
        });

        const markdownRaw = await generatePlanMarkdownByChapters({
          projectName: String(projectName),
          scenario: String(scenario),
          params,
          planTitle,
          items,
          imageContext,
          traceContext: planTrace,
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

        const postProcessStartAt = Date.now();
        tracePlanEvent("post-process-start", planTrace);
        const { markdownProcessed, postProcessReport } = postProcessMarkdown(
          markdownRaw,
          staticBlockMap,
          imageContext.mediaAssetMap,
          imageContext.commonImageGuidance,
          imageContext.deviceImageByName
        );
        tracePlanEvent("post-process-end", planTrace, {
          elapsedMs: Date.now() - postProcessStartAt,
          postProcessReport
        });

        const saveDocStartAt = Date.now();
        const { docLink } = saveGeneratedDoc({
          projectName: String(projectName),
          planTitle,
          markdownProcessed
        });
        tracePlanEvent("doc-saved", planTrace, {
          elapsedMs: Date.now() - saveDocStartAt,
          docLink
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

        tracePlanEvent("plan-success", planTrace, {
          totalElapsedMs: Date.now() - planStartAt,
          markdownRawLength: String(markdownRaw || "").length,
          markdownProcessedLength: String(markdownProcessed || "").length
        });

        return { status: "success" };
      } catch (error) {
        console.error(`❌ Plan stream generation failed (${planTitle}):`, error.response?.data || error.message);
        tracePlanEvent("plan-failed", planTrace, {
          totalElapsedMs: Date.now() - planStartAt,
          message: error?.message || "Plan stream generation failed",
          responseData: clipTraceJson(error?.response?.data || "")
        });
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
      tracePlanEvent("request-complete", routeTrace, {
        summary
      });
      res.end();
    }
  } catch (error) {
    console.error("❌ Generate markdown stream failed:", error.response?.data || error.message);
    tracePlanEvent("request-failed", routeTrace, {
      message: error?.message || "Generate markdown stream failed",
      responseData: clipTraceJson(error?.response?.data || "")
    });
    if (!closed) {
      sendSse({ event: "fatal-error", message: error.message });
      res.end();
    }
  }
});

app.post("/api/plan/generate-markdowns", async (req, res) => {
  const { projectName, scenario, params, plans } = req.body || {};
  const routeTrace = {
    traceId: createTraceId("plan-batch"),
    route: "/api/plan/generate-markdowns",
    projectName: String(projectName || ""),
    scenario: String(scenario || "")
  };

  tracePlanEvent("request-received", routeTrace, {
    planCount: Array.isArray(plans) ? plans.length : 0
  });

  if (!projectName || !scenario || !params || !Array.isArray(plans) || plans.length === 0) {
    tracePlanEvent("request-invalid", routeTrace, {
      reason: "Missing required fields: projectName, scenario, params, plans"
    });
    return res.status(400).json({ error: "Missing required fields: projectName, scenario, params, plans" });
  }

  try {
    const staticBlocksStartAt = Date.now();
    const staticBlockMap = await loadEffectiveStaticBlockMap();
    tracePlanEvent("static-blocks-loaded", routeTrace, {
      elapsedMs: Date.now() - staticBlocksStartAt,
      blockCount: Object.keys(staticBlockMap || {}).length
    });

    const commonImagesStartAt = Date.now();
    const commonImageResources = await loadCommonImageResources(String(scenario));
    tracePlanEvent("common-images-loaded", routeTrace, {
      elapsedMs: Date.now() - commonImagesStartAt,
      count: commonImageResources.length
    });
    const deviceImageCache = new Map();

    const planResults = await runWithConcurrency(plans, PLAN_BATCH_CONCURRENCY, async (plan) => {
      const planStartAt = Date.now();
      const planTitle = String(plan?.title || "方案");
      const items = Array.isArray(plan?.items) ? plan.items : [];
      const planTrace = {
        ...routeTrace,
        planId: plan?.id,
        planTitle
      };

      tracePlanEvent("plan-start", planTrace, {
        itemCount: items.length
      });

      try {
        const imageContextStartAt = Date.now();
        const imageContext = await buildPlanImageContext({
          scenario: String(scenario),
          items,
          commonImageResources,
          deviceImageCache
        });
        tracePlanEvent("plan-image-context-ready", planTrace, {
          elapsedMs: Date.now() - imageContextStartAt,
          mediaCount: Object.keys(imageContext.mediaAssetMap || {}).length,
          commonImageCount: imageContext.commonImageGuidance?.length || 0,
          deviceImageCount: Object.keys(imageContext.deviceImageByName || {}).length
        });

        const markdownRaw = await generatePlanMarkdownByChapters({
          projectName: String(projectName),
          scenario: String(scenario),
          params,
          planTitle,
          items,
          imageContext,
          traceContext: planTrace
        });

        const postProcessStartAt = Date.now();
        tracePlanEvent("post-process-start", planTrace);
        const { markdownProcessed, postProcessReport } = postProcessMarkdown(
          markdownRaw,
          staticBlockMap,
          imageContext.mediaAssetMap,
          imageContext.commonImageGuidance,
          imageContext.deviceImageByName
        );
        tracePlanEvent("post-process-end", planTrace, {
          elapsedMs: Date.now() - postProcessStartAt,
          postProcessReport
        });

        const saveDocStartAt = Date.now();
        const { docLink } = saveGeneratedDoc({
          projectName: String(projectName),
          planTitle,
          markdownProcessed
        });
        tracePlanEvent("doc-saved", planTrace, {
          elapsedMs: Date.now() - saveDocStartAt,
          docLink
        });

        tracePlanEvent("plan-success", planTrace, {
          totalElapsedMs: Date.now() - planStartAt,
          markdownRawLength: String(markdownRaw || "").length,
          markdownProcessedLength: String(markdownProcessed || "").length
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
        tracePlanEvent("plan-failed", planTrace, {
          totalElapsedMs: Date.now() - planStartAt,
          message: error?.message || "Plan generation failed",
          responseData: clipTraceJson(error?.response?.data || "")
        });
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
      tracePlanEvent("request-failed", routeTrace, {
        reason: "all plans failed",
        failedCount: failed.length
      });
      return res.status(500).json({
        error: "Failed to generate markdowns",
        failed,
        trace: {
          requestId: routeTrace.traceId,
          responseSentAt: new Date().toISOString(),
          responseSentTs: Date.now()
        }
      });
    }

    const responsePayload = {
      ok: true,
      projectName,
      generated,
      failed,
      documents: generated,
      trace: {
        requestId: routeTrace.traceId,
        responseSentAt: new Date().toISOString(),
        responseSentTs: Date.now()
      }
    };

    tracePlanEvent("frontend-payload-sent", routeTrace, {
      successCount: generated.length,
      failedCount: failed.length,
      payloadBytes: Buffer.byteLength(JSON.stringify(responsePayload), "utf8")
    });
    tracePlanEvent("request-complete", routeTrace, {
      successCount: generated.length,
      failedCount: failed.length
    });

    res.json(responsePayload);
  } catch (error) {
    console.error("❌ Generate markdowns failed:", error.response?.data || error.message);
    tracePlanEvent("request-failed", routeTrace, {
      message: error?.message || "Generate markdowns failed",
      responseData: clipTraceJson(error?.response?.data || "")
    });
    res.status(500).json({
      error: "Failed to generate markdowns",
      details: error.message,
      trace: {
        requestId: routeTrace.traceId,
        responseSentAt: new Date().toISOString(),
        responseSentTs: Date.now()
      }
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

const backendDir = fileURLToPath(new URL("./", import.meta.url));
try {
  await ensureInventorySchema();
  console.log("✅ Inventory schema ready");
} catch (error) {
  console.warn("⚠️ Inventory schema init failed:", error.message);
}

try {
  await ensureStaticBlockTableAndSeed(pool, backendDir);
  console.log("✅ Static markdown blocks ready");
} catch (error) {
  console.warn("⚠️ Static markdown blocks init failed:", error.message);
}

try {
  await ensureMergedStaticResourceSchemaAndMigrate();
  console.log("✅ Merged static resource schema ready");
} catch (error) {
  console.warn("⚠️ Merged static resource schema init failed:", error.message);
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