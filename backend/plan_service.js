import axios from "axios";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

const ARK_URL = process.env.ARK_API_URL || "https://ark.cn-beijing.volces.com/api/v3/responses";
const ARK_MODEL = process.env.ARK_MODEL || "doubao-seed-2-0-pro-260215";
export const LOCAL_STATIC_RESOURCE_TABLE = "本地静态资源";
const LEGACY_STATIC_RESOURCE_TABLE = "static_markdown_blocks";

const SYSTEM_KEYWORDS = {
  "扩声系统": ["音箱", "功放", "调音台", "处理器", "反馈抑制器", "线阵列", "台唇", "返听", "超低"],
  "中控系统": ["中控"],
  "录播系统": ["录播"],
  "矩阵系统": ["矩阵"],
  "视频会议系统": ["视频会议", "视讯", "会议终端", "摄像头"],
  "话筒": ["话筒", "麦克风", "鹅颈", "手持", "领夹", "吊装"]
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slugify(value) {
  return String(value || "document")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "document";
}

function headingToAnchor(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s\-\u4e00-\u9fa5]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function sanitizeStaticBlockKey(value) {
  const normalized = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized || `BLOCK_${Date.now()}`;
}

function generateToc(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const toc = [];
  for (const line of lines) {
    const m = line.match(/^(#{2,6})\s+(.+)$/);
    if (!m) continue;
    const level = m[1].length;
    const title = m[2].trim();
    const indent = "  ".repeat(level - 2);
    toc.push(`${indent}- [${title}](#${headingToAnchor(title)})`);
  }
  if (toc.length < 2) return "";
  return toc.join("\n");
}

function insertToc(markdown) {
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

  const tocSection = ["", "## 目录", "", toc, "", "---", ""];
  lines.splice(insertAt, 0, ...tocSection);
  return lines.join("\n");
}

function stripStaticBlockPlaceholders(markdown) {
  return String(markdown || "").replace(/\{\{INSERT:[A-Z0-9_]+\}\}/g, () => {
    return "<!-- Note: static content has been automatically inserted by chapter via the database resource pipeline -->";
  });
}

function postProcessMarkdown(markdown) {
  const content = stripStaticBlockPlaceholders(markdown);
  const withToc = insertToc(content);
  return {
    markdown: withToc,
    report: {
      toc_added: withToc !== content
    }
  };
}

function markdownToDocHtml(markdown, title) {
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
}

function classifySystem(item) {
  const sample = `${item.type || ""} ${item.name || ""} ${item.model || ""}`;
  for (const [system, words] of Object.entries(SYSTEM_KEYWORDS)) {
    if (words.some((word) => sample.includes(word))) {
      return system;
    }
  }
  return "未归类";
}

function buildEquipmentJson(items) {
  const normalized = (Array.isArray(items) ? items : []).map((item) => ({
    系统: classifySystem(item),
    设备分类: item.type || "",
    设备名称: item.name || "",
    品牌: item.brand || "",
    型号: item.model || "",
    参数: item.specs || "",
    数量: Number(item.quantity || 0),
    单位: item.unit || "台"
  }));
  return JSON.stringify(normalized, null, 2);
}

function buildSelectedSystems(params, items) {
  const systems = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => systems.add(classifySystem(item)));
  if (params?.hasCentralControl) systems.add("中控系统");
  if (params?.hasMatrix) systems.add("矩阵系统");
  if (params?.hasVideoConf) systems.add("视频会议系统");
  if (params?.hasRecording) systems.add("录播系统");
  const micCount = Number(params?.micHandheld || 0) + Number(params?.micGooseneck || 0) + Number(params?.micOmni || 0) + Number(params?.micLavalier || 0) + Number(params?.micCeiling || 0);
  if (micCount > 0 || (Array.isArray(params?.mics) && params.mics.length > 0)) systems.add("话筒");
  systems.delete("未归类");
  return Array.from(systems);
}

function buildUserInput({ scenario, params, items }) {
  const selectedSystems = buildSelectedSystems(params, items);
  return {
    scene: scenario === "LECTURE_HALL" ? "报告厅" : "会议室",
    length: Number(params?.length || 0),
    width: Number(params?.width || 0),
    height: Number(params?.height || 0),
    stage_to_near_audience: Number(params?.stageToNearAudience || 0),
    stage_to_far_audience: Number(params?.stageToFarAudience || 0),
    stage_width: Number(params?.stageWidth || 0),
    stage_depth: Number(params?.stageDepth || 0),
    selected_systems: selectedSystems,
    extra_requirements: String(params?.extraRequirements || "")
  };
}

function buildPrompt({ projectName, planTitle, userInput, items }) {
  const equipmentJson = buildEquipmentJson(items);

  return [
    `你是专业声学顾问，请为项目生成完整 Markdown 方案文档。`,
    `项目名称: ${projectName}`,
    `方案标题: ${planTitle}`,
    "",
    "用户输入(JSON):",
    JSON.stringify(userInput, null, 2),
    "",
    "设备清单(JSON):",
    equipmentJson,
    "",
    "输出要求:",
    "1. 必须输出 Markdown，不要输出 JSON。",
    "2. 标题结构至少包含：项目概述、设计依据、系统设计、设备清单、结论。",
    "3. 所有设备型号和数量必须与设备清单一致，禁止编造设备。",
    "4. 会议室或报告厅应根据用户输入准确匹配。",
    "5. 国标对照表、声学公式等静态内容由后端按章节自动插入，你不需要为它们生成占位符或章节。",
    "6. 正文请充分展开，不要只给表格。",
    ""
  ].join("\n");
}

function extractArkText(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;

  if (Array.isArray(data.output)) {
    const texts = [];
    for (const item of data.output) {
      if (!item) continue;
      if (typeof item.text === "string") texts.push(item.text);
      if (Array.isArray(item.content)) {
        for (const part of item.content) {
          if (typeof part?.text === "string") texts.push(part.text);
        }
      }
    }
    const merged = texts.join("\n").trim();
    if (merged) return merged;
  }

  if (Array.isArray(data.content)) {
    const merged = data.content.map((x) => x?.text || "").join("\n").trim();
    if (merged) return merged;
  }

  return "";
}

async function callArkForMarkdown(prompt) {
  const apiKey = process.env.ARK_API_KEY || "";
  if (!apiKey) {
    throw new Error("Missing ARK_API_KEY env variable");
  }

  const response = await axios.post(
    ARK_URL,
    {
      model: ARK_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            }
          ]
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

  const markdown = extractArkText(response.data);
  if (!markdown) {
    throw new Error("Ark returned empty markdown content");
  }
  return markdown;
}

export async function ensureStaticBlockTableAndSeed(pool, _backendDir) {
  try {
    const [legacyRows] = await pool.query(
      "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1",
      [LEGACY_STATIC_RESOURCE_TABLE]
    );
    const [currentRows] = await pool.query(
      "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1",
      [LOCAL_STATIC_RESOURCE_TABLE]
    );

    if (legacyRows.length > 0 && currentRows.length === 0) {
      await pool.query(`RENAME TABLE \`${LEGACY_STATIC_RESOURCE_TABLE}\` TO \`${LOCAL_STATIC_RESOURCE_TABLE}\``);
    }
  } catch (error) {
    console.warn("⚠️ Static resource table rename skipped:", error.message);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`${LOCAL_STATIC_RESOURCE_TABLE}\` (
      id INT AUTO_INCREMENT PRIMARY KEY,
      block_key VARCHAR(64) NOT NULL UNIQUE,
      title VARCHAR(255) NOT NULL DEFAULT '',
      description VARCHAR(512) NOT NULL DEFAULT '',
      source_file VARCHAR(255) NOT NULL DEFAULT '',
      content MEDIUMTEXT NOT NULL,
      \`插入章节\` VARCHAR(255) NULL,
      \`使用场景\` VARCHAR(32) NULL,
      \`资源类型\` VARCHAR(32) NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Ensure optional columns exist
  const ensureColumn = async (table, col, def) => {
    try {
      await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
    } catch (e) { /* column already exists */ }
  };
  await ensureColumn(LOCAL_STATIC_RESOURCE_TABLE, "插入章节", "VARCHAR(255) NULL");
  await ensureColumn(LOCAL_STATIC_RESOURCE_TABLE, "使用场景", "VARCHAR(32) NULL");
  await ensureColumn(LOCAL_STATIC_RESOURCE_TABLE, "资源类型", "VARCHAR(32) NULL");
}

export async function listStaticBlocks(pool) {
  const [rows] = await pool.query(
    `SELECT id, block_key, title, description, source_file, content, \`插入章节\`, \`使用场景\`, enabled, updated_at
     FROM \`${LOCAL_STATIC_RESOURCE_TABLE}\`
     ORDER BY block_key ASC`
  );
  return rows;
}

export async function updateStaticBlock(pool, blockKey, payload) {
  const fields = [];
  const values = [];

  if (Object.prototype.hasOwnProperty.call(payload, "title")) {
    fields.push("title = ?");
    values.push(String(payload.title || ""));
  }
  if (Object.prototype.hasOwnProperty.call(payload, "description")) {
    fields.push("description = ?");
    values.push(String(payload.description || ""));
  }
  if (Object.prototype.hasOwnProperty.call(payload, "content")) {
    fields.push("content = ?");
    values.push(String(payload.content || ""));
  }
  if (Object.prototype.hasOwnProperty.call(payload, "enabled")) {
    fields.push("enabled = ?");
    values.push(payload.enabled ? 1 : 0);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "insertChapter")) {
    fields.push("`插入章节` = ?");
    values.push(String(payload.insertChapter || ""));
  }
  if (Object.prototype.hasOwnProperty.call(payload, "usageScene")) {
    fields.push("`使用场景` = ?");
    values.push(String(payload.usageScene || ""));
  }

  if (fields.length === 0) {
    return { updated: false, reason: "No updatable fields" };
  }

  values.push(sanitizeStaticBlockKey(blockKey));
  const [result] = await pool.query(
    `UPDATE \`${LOCAL_STATIC_RESOURCE_TABLE}\` SET ${fields.join(", ")} WHERE block_key = ?`,
    values
  );

  return { updated: result.affectedRows > 0 };
}

export async function loadEnabledStaticBlockMap(pool) {
  const [rows] = await pool.query(
    `SELECT block_key, content FROM \`${LOCAL_STATIC_RESOURCE_TABLE}\` WHERE enabled = 1`
  );
  const map = {};
  for (const row of rows) {
    map[row.block_key] = String(row.content || "");
  }
  return map;
}

export async function generatePlanDocuments({
  pool,
  backendDir,
  projectName,
  scenario,
  params,
  plans
}) {
  const outDir = path.join(backendDir, "generated_docs");
  mkdirSync(outDir, { recursive: true });

  const results = [];

  for (const plan of plans) {
    const title = plan?.title || "方案";
    const items = Array.isArray(plan?.items) ? plan.items : [];
    const userInput = buildUserInput({ scenario, params, items });
    const prompt = buildPrompt({
      projectName,
      planTitle: title,
      userInput,
      items
    });

    const markdownRaw = await callArkForMarkdown(prompt);
    const { markdown: markdownProcessed, report } = postProcessMarkdown(markdownRaw);

    const fileBase = `${Date.now()}-${slugify(projectName)}-${slugify(title)}`;
    const fileName = `${fileBase}.doc`;
    const filePath = path.join(outDir, fileName);
    const docHtml = markdownToDocHtml(markdownProcessed, `${projectName} - ${title}`);
    writeFileSync(filePath, docHtml, "utf-8");

    results.push({
      id: plan?.id,
      title,
      markdownRaw,
      markdownProcessed,
      docLink: `/api/plan/documents/${fileName}`,
      postProcessReport: report
    });
  }

  return results;
}
