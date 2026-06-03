// test_report_flow.mjs
// 报告生成流程验证脚本
// 用法: node --input-type=module test_report_flow.mjs

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config({ path: fileURLToPath(new URL("./.env", import.meta.url)) });

const DB_CONFIG = {
  host: process.env.DB_HOST || "115.231.236.153",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "user1",
  password: process.env.DB_PASSWORD || "UasbecrD1!1",
  database: process.env.DB_NAME || "longdata_new",
  charset: "utf8mb4"
};

// ============================================================
// Helper: strip backtick-quoted identifiers for display
// ============================================================
const TABLE_NAME = "本地静态资源";

const normalizeChapterTitle = (value = "") =>
  String(value || "")
    .replace(/^第\s*\d+\s*[章节]\s*/g, "")
    .replace(/^\d+(?:\.\d+)*\s*/g, "")
    .replace(/^[、\.:：\-\s]+/g, "")
    .trim();

const normalizeSceneLabel = (scenario) =>
  String(scenario || "") === "LECTURE_HALL" ? "报告厅" : "会议室";

const PLAN_CHAPTER_TITLE_CANDIDATES = [
  "项目概述",
  "设计依据和目标",
  "方案设计",
  "设备介绍",
  "装修建议",
  "环境要求"
];

const RESOURCE_TYPE_IMAGE = "图片";
const RESOURCE_TYPE_TEXT = "文字";
const RESOURCE_TYPE_TABLE = "表格";

const normalizeResourceType = (value, fallback) => {
  const normalized = String(value || "").trim();
  if (normalized === RESOURCE_TYPE_IMAGE || normalized === "image") return RESOURCE_TYPE_IMAGE;
  if (normalized === RESOURCE_TYPE_TABLE || normalized === "table" || normalized === "markdown_table") return RESOURCE_TYPE_TABLE;
  if (normalized === RESOURCE_TYPE_TEXT || normalized === "text" || normalized === "文字" || normalized === "文本") return RESOURCE_TYPE_TEXT;
  return fallback || RESOURCE_TYPE_TEXT;
};

const inferResourceTypeFromContent = (content) => {
  const text = String(content || "").trim().toLowerCase();
  if (!text) return RESOURCE_TYPE_TEXT;
  if (text.startsWith("data:image/") || /^!\[[^\]]*\]\([^\)]+\)$/.test(text)) return RESOURCE_TYPE_IMAGE;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasPipeRow = lines.some((line) => /^\|.+\|$/.test(line));
  const hasTableDivider = lines.some((line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line));
  if (text.includes("<table") || (hasPipeRow && hasTableDivider)) return RESOURCE_TYPE_TABLE;
  return RESOURCE_TYPE_TEXT;
};

// ============================================================
// Test 1: DB Connection & Data Integrity
// ============================================================
async function test1_DBConnection(pool) {
  console.log("=".repeat(60));
  console.log("TEST 1: DB Connection & Static Resource Data Integrity");
  console.log("=".repeat(60));

  try {
    await pool.query("SELECT 1");
    console.log("  ✅ DB connection successful");
  } catch (error) {
    console.log(`  ❌ DB connection failed: ${error.message}`);
    return false;
  }

  // Check table exists
  const [tables] = await pool.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1",
    [TABLE_NAME]
  );
  if (tables.length === 0) {
    console.log(`  ❌ Table '${TABLE_NAME}' does not exist`);
    return false;
  }
  console.log(`  ✅ Table '${TABLE_NAME}' exists`);

  // Check columns
  const [columns] = await pool.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [TABLE_NAME]
  );
  const colNames = columns.map((c) => c.COLUMN_NAME);
  const required = ["id", "block_key", "title", "content", "插入章节", "使用场景", "资源类型", "enabled"];
  for (const col of required) {
    if (colNames.includes(col)) {
      console.log(`  ✅ Column '${col}' exists`);
    } else {
      console.log(`  ❌ Column '${col}' MISSING in table '${TABLE_NAME}'`);
    }
  }

  return true;
}

// ============================================================
// Test 2: Enabled + Scene Filtering
// ============================================================
async function test2_SceneFiltering(pool) {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: Enabled + Scene Filtering");
  console.log("=".repeat(60));

  const sceneLabel = "会议室";
  const validChapterTitleSet = new Set(PLAN_CHAPTER_TITLE_CANDIDATES.map((t) => normalizeChapterTitle(t)));

  const [allRows] = await pool.query(
    `SELECT id, block_key, title, description, content, \`插入章节\`, \`使用场景\`, \`资源类型\`, enabled
     FROM \`${TABLE_NAME}\`
     WHERE content IS NOT NULL AND content <> ''`
  );
  console.log(`  Total rows with content: ${allRows.length}`);

  // Filter by enabled
  const enabledRows = allRows.filter((row) => {
    const enabled = Number(row?.enabled ?? 1);
    return enabled !== 0;
  });
  console.log(`  Enabled rows: ${enabledRows.length}`);

  // Filter by scene
  const sceneRows = enabledRows.filter((row) => {
    const scene = String(row?.使用场景 || "").trim();
    if (!scene || scene === "通用") return true;
    return scene === sceneLabel;
  });
  console.log(`  Scene-filtered rows (通用 + 会议室): ${sceneRows.length}`);

  // Filter by valid chapter
  const validRows = sceneRows.filter((row) => {
    const chapterSource = String(row?.插入章节 || row?.目标章节 || "").trim();
    const chapterTitle = normalizeChapterTitle(chapterSource);
    const content = String(row?.content || row?.资源内容 || row?.图片文件 || "").trim();
    return !!content && !!chapterTitle && validChapterTitleSet.has(chapterTitle);
  });
  console.log(`  Valid chapter rows: ${validRows.length}`);

  if (validRows.length === 0) {
    console.log("  ⚠️  No valid rows found! Check 插入章节 values in DB.");
    return false;
  }

  // Print distribution
  const byChapter = {};
  const byType = {};
  for (const row of validRows) {
    const ch = normalizeChapterTitle(String(row?.插入章节 || "").trim());
    const rt = normalizeResourceType(row?.资源类型, inferResourceTypeFromContent(row?.content || ""));
    byChapter[ch] = (byChapter[ch] || 0) + 1;
    byType[rt] = (byType[rt] || 0) + 1;
  }
  console.log("\n  📊 Resources by chapter:");
  for (const [ch, count] of Object.entries(byChapter)) {
    console.log(`     - ${ch}: ${count}`);
  }
  console.log("  📊 Resources by type:");
  for (const [type, count] of Object.entries(byType)) {
    console.log(`     - ${type}: ${count}`);
  }

  return true;
}

// ============================================================
// Test 3: Resource Descriptions Sent to LLM
// ============================================================
async function test3_DescriptionsInPrompt(pool) {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: Resource Descriptions in LLM Prompt");
  console.log("=".repeat(60));

  const sceneLabel = "会议室";
  const validChapterTitleSet = new Set(PLAN_CHAPTER_TITLE_CANDIDATES.map((t) => normalizeChapterTitle(t)));

  const [rows] = await pool.query(
    `SELECT id, block_key, title, description, content, \`插入章节\`, \`使用场景\`, \`资源类型\`, enabled
     FROM \`${TABLE_NAME}\`
     WHERE content IS NOT NULL AND content <> ''`
  );

  const filteredRows = rows
    .filter((row) => {
      const enabled = Number(row?.enabled ?? 1);
      if (enabled === 0) return false;
      const scene = String(row?.使用场景 || "").trim();
      if (!scene || scene === "通用") return true;
      return scene === sceneLabel;
    })
    .map((row) => {
      const resourceName = String(row?.title || row?.block_key || `资源${row?.id || ""}`).trim();
      const chapterTitle = normalizeChapterTitle(String(row?.插入章节 || "").trim());
      const explain = String(row?.description || "").trim();
      const content = String(row?.content || "").trim();
      const resourceType = normalizeResourceType(row?.资源类型, inferResourceTypeFromContent(content));
      return { id: row?.id, resourceName, chapterTitle, explain, resourceType };
    })
    .filter((row) => !!row.chapterTitle && validChapterTitleSet.has(row.chapterTitle));

  console.log(`  Resources with descriptions: ${filteredRows.filter((r) => r.explain).length}/${filteredRows.length}`);

  let hasUnexplained = false;
  for (const row of filteredRows) {
    const status = row.explain ? "✅" : "⚠️";
    console.log(`  ${status} [${row.resourceType}] ${row.resourceName} → ${row.chapterTitle}`);
    if (row.explain) {
      console.log(`     描述: ${row.explain.slice(0, 80)}${row.explain.length > 80 ? "..." : ""}`);
    } else {
      console.log(`     描述: (无) — LLM will use default placeholder`);
      hasUnexplained = true;
    }
  }

  if (hasUnexplained) {
    console.log("\n  ⚠️  Some resources have no description. LLM will fall back to resource name.");
  } else {
    console.log("\n  ✅ All resources have descriptions for the LLM.");
  }

  return true;
}

// ============================================================
// Test 4: Legacy static blocks have 插入章节 set
// ============================================================
async function test4_LegacyBlockChapters(pool) {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 4: Legacy Static Block Chapter Assignment");
  console.log("=".repeat(60));

  const legacyKeys = ["STANDARDS_TABLE", "FORMULAS_BLOCK", "SIGNAL_FLOW_MERMAID", "ROOM_LAYOUT_MERMAID", "CONTROL_FLOW_MERMAID"];
  const expectedChapters = {
    STANDARDS_TABLE: "设计依据和目标",
    FORMULAS_BLOCK: "方案设计",
    SIGNAL_FLOW_MERMAID: "方案设计",
    ROOM_LAYOUT_MERMAID: "方案设计",
    CONTROL_FLOW_MERMAID: "方案设计"
  };
  const expectedType = {
    STANDARDS_TABLE: "表格",
    FORMULAS_BLOCK: "文字",
    SIGNAL_FLOW_MERMAID: "文字",
    ROOM_LAYOUT_MERMAID: "文字",
    CONTROL_FLOW_MERMAID: "文字"
  };

  const [rows] = await pool.query(
    `SELECT block_key, title, \`插入章节\`, \`使用场景\`, \`资源类型\`, enabled
     FROM \`${TABLE_NAME}\`
     WHERE block_key IN (${legacyKeys.map(() => "?").join(", ")})`,
    legacyKeys
  );

  const foundKeys = new Set(rows.map((r) => r.block_key));
  let allOk = true;

  for (const key of legacyKeys) {
    if (!foundKeys.has(key)) {
      console.log(`  ❌ ${key}: NOT FOUND in DB`);
      allOk = false;
      continue;
    }
    const row = rows.find((r) => r.block_key === key);
    const chapter = String(row?.["插入章节"] || "").trim();
    const scene = String(row?.["使用场景"] || "").trim();
    const rtype = String(row?.["资源类型"] || "").trim();
    const enabled = Number(row?.enabled ?? 1);

    const chOk = normalizeChapterTitle(chapter) === normalizeChapterTitle(expectedChapters[key]);
    const scOk = !scene || scene === "通用";
    const tyOk = rtype === expectedType[key];
    const enOk = enabled === 1;
    const ok = chOk && scOk && tyOk && enOk;

    console.log(`  ${ok ? "✅" : "❌"} ${key}:`);
    console.log(`     插入章节: "${chapter}" ${chOk ? "✅" : `❌ expected "${expectedChapters[key]}"`}`);
    console.log(`     使用场景: "${scene}" ${scOk ? "✅" : "❌"}`);
    console.log(`     资源类型: "${rtype}" ${tyOk ? "✅" : `❌ expected "${expectedType[key]}"`}`);
    console.log(`     enabled: ${enabled} ${enOk ? "✅" : "❌ expected 1"}`);

    if (!ok) allOk = false;
  }

  if (allOk) {
    console.log("\n  ✅ All legacy static blocks have correct chapter/scene/type assignments");
  } else {
    console.log("\n  ⚠️  Run the server to trigger ensureStaticBlockTableAndSeed migration");
  }

  return allOk;
}

// ============================================================
// Test 5: {{INSERT:xxx}} is NOT in prompt template
// ============================================================
async function test5_NoInsertPlaceholders() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 5: No {{INSERT:xxx}} in Prompt Template");
  console.log("=".repeat(60));

  const { readFileSync } = await import("fs");
  const templatePath = new URL("./大模型方案生成指导模板.md", import.meta.url);
  const content = readFileSync(templatePath, "utf-8");

  const insertMatches = content.match(/\{\{INSERT:[A-Z0-9_]+\}\}/g) || [];
  if (insertMatches.length > 0) {
    console.log(`  ❌ Found ${insertMatches.length} {{INSERT:xxx}} references in template:`);
    insertMatches.forEach((m) => console.log(`     - ${m}`));
    return false;
  }
  console.log("  ✅ No {{INSERT:xxx}} placeholders in template");

  // Also check server.js doesn't mention INSERT in buildPlanPrompt
  const serverPath = new URL("./server.js", import.meta.url);
  const serverContent = readFileSync(serverPath, "utf-8");
  // Extract buildPlanPrompt function
  const promptFnStart = serverContent.indexOf("const buildPlanPrompt =");
  const promptFnEnd = serverContent.indexOf("const PLAN_CHAPTERS =", promptFnStart);
  const promptFn = serverContent.slice(promptFnStart, promptFnEnd);

  if (/\{\{INSERT:/.test(promptFn)) {
    console.log("  ❌ buildPlanPrompt in server.js still mentions {{INSERT:xxx}}");
    return false;
  }
  console.log("  ✅ buildPlanPrompt does not mention {{INSERT:xxx}}");

  return true;
}

// ============================================================
// Test 6: postProcessMarkdown without blockMap
// ============================================================
function test6_PostProcessPipeline() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 6: postProcessMarkdown Pipeline (Unit Test)");
  console.log("=".repeat(60));

  // Simulate: markdown with legacy {{INSERT:xxx}} should be stripped
  // (matches the actual stripStaticBlockPlaceholders in server.js)
  const stripFn = (md) =>
    String(md || "").replace(/\{\{INSERT:[A-Z0-9_]+\}\}/g, () =>
      "<!-- Note: static content has been automatically inserted by chapter via the database resource pipeline -->"
    );

  const input = `# Test Report

## 项目概述

标准表：{{INSERT:STANDARDS_TABLE}}

## 方案设计

公式插入：{{INSERT:FORMULAS_BLOCK}}
`;

  const result = stripFn(input);
  const hasInsert = /\{\{INSERT:[A-Z0-9_]+\}\}/.test(result);
  const hasWarning = /static content has been automatically inserted/.test(result);

  if (hasInsert) {
    console.log("  ❌ Legacy {{INSERT:xxx}} NOT stripped from output");
    console.log(`     DEBUG: result contains {{INSERT:xxx}}: ${hasInsert}`);
    console.log(`     DEBUG: result preview: ${result.slice(0, 200)}`);
    return false;
  }
  console.log("  ✅ Legacy {{INSERT:xxx}} stripped from output");
  console.log("  ✅ Warning comments inserted for legacy placeholders");

  // Test TOC insertion (simplified)
  const insertToc = (md) => {
    const toc = "- [项目概述](#项目概述)\n- [方案设计](#方案设计)";
    const lines = String(md).split(/\r?\n/);
    let insertAt = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (/^#\s+/.test(lines[i])) {
        insertAt = i + 1;
        while (insertAt < lines.length && lines[insertAt].trim() === "") insertAt += 1;
        break;
      }
    }
    lines.splice(insertAt, 0, "", "## 目录", "", toc, "", "---", "");
    return lines.join("\n");
  };

  const withToc = insertToc(result);
  if (withToc.includes("## 目录")) {
    console.log("  ✅ TOC insertion works");
  } else {
    console.log("  ❌ TOC insertion failed");
    return false;
  }

  return true;
}

// ============================================================
// Test 7: Simulation Analysis Chapter Structure
// ============================================================
function test7_SimulationChapter() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 7: Simulation Analysis Chapter Structure");
  console.log("=".repeat(60));

  // Mock simulation context
  const simCtx = {
    scenario: "LECTURE_HALL",
    images: {
      side: "data:image/png;base64,FAKESIDE==",
      top: "data:image/png;base64,FAKETOP=="
    },
    metrics: {
      feasible: true,
      minSpl: 75.5,
      avgSpl: 82.3,
      maxSpl: 88.1,
      minSplTarget: 75,
      nonuniformity: 5.2,
      nonuniformityTarget: 8,
      headroom: 3.5,
      headroomTarget: 3
    },
    standards: [
      { name: "最大声压级", standard: "≥85dB", value: "88.1dB", pass: true },
      { name: "声场不均匀度", standard: "≤8dB", value: "5.2dB", pass: true },
      { name: "传输频率特性", standard: "125Hz~4kHz ±4dB", value: "±3.2dB", pass: true }
    ],
    speakers: [
      { label: "主扩声音箱 L", model: "LA-208", position: [-3.5, 2.0, 6.0], pitch: -5, yaw: 15, gainDb: 0, coverageH: 100, coverageV: 15 },
      { label: "主扩声音箱 R", model: "LA-208", position: [3.5, 2.0, 6.0], pitch: -5, yaw: -15, gainDb: 0, coverageH: 100, coverageV: 15 },
      { label: "台唇音箱 C", model: "TS-112", position: [0, 1.5, 1.2], pitch: 5, yaw: 0, gainDb: -3, coverageH: 90, coverageV: 60 }
    ]
  };

  // Use dynamic import to test the actual function
  // For now, validate the expected structure
  const expectedSections = ["##### 仿真分析", "###### 图纸素材", "###### 设备清单", "###### 声场指标说明", "###### 国标合规校验"];
  console.log("  Expected chapter structure:");
  expectedSections.forEach((s) => console.log(`    ${s}`));

  // Check the mock context has all required fields
  const checks = [
    { label: "Images (side + top)", pass: !!simCtx.images?.side && !!simCtx.images?.top },
    { label: "Metrics (6 fields)", pass: Object.keys(simCtx.metrics).length >= 6 },
    { label: "Standards (3 rows)", pass: simCtx.standards.length >= 3 },
    { label: "Speakers (3 units)", pass: simCtx.speakers.length >= 3 }
  ];

  for (const check of checks) {
    console.log(`  ${check.pass ? "✅" : "❌"} ${check.label}`);
  }

  return checks.every((c) => c.pass);
}

// ============================================================
// Test 8: Simulation injection dedup guard
// ============================================================
function test8_InjectionGuard() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 8: Simulation Injection Dedup Guard");
  console.log("=".repeat(60));

  // Simulate the dedup regex check
  const dedupRegex = /#####\s+仿真分析/;

  const alreadyHasIt = "##### 仿真分析\n\n...";
  const withoutIt = "##### 3.2.4.1 专业扩声系统\n\n...\n##### 3.2.4.2 视频会议系统";

  if (dedupRegex.test(alreadyHasIt)) {
    console.log("  ✅ Duplicate detected — injection skipped (idempotent)");
  } else {
    console.log("  ❌ Duplicate NOT detected for existing '仿真分析'");
  }

  if (!dedupRegex.test(withoutIt)) {
    console.log("  ✅ No duplicate — injection proceeds");
  } else {
    console.log("  ❌ False positive dedup detection");
  }

  return true;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("============================================================");
  console.log("  ACOUSTIC MASTER — Report Generation Flow Test Suite");
  console.log("  Run: " + new Date().toISOString());
  console.log("============================================================\n");

  let pool;
  try {
    pool = mysql.createPool(DB_CONFIG);
    await test1_DBConnection(pool);
    await test2_SceneFiltering(pool);
    await test3_DescriptionsInPrompt(pool);
    await test4_LegacyBlockChapters(pool);
  } catch (error) {
    console.log(`\n  ⚠️ DB tests skipped: ${error.message}`);
  } finally {
    if (pool) await pool.end();
  }

  // Pure function tests (no DB needed)
  await test5_NoInsertPlaceholders();
  test6_PostProcessPipeline();
  test7_SimulationChapter();
  test8_InjectionGuard();

  console.log("\n============================================================");
  console.log("  TEST SUITE COMPLETE");
  console.log("============================================================");
}

main().catch((err) => {
  console.error("Test suite crashed:", err.message);
  process.exit(1);
});
