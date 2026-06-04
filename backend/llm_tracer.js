// llm_tracer.js — 大模型交互日志模块
// 每次 LLM 调用都保存到两个位置:
//   1. backend/llm_traces/  — 历史归档（按时间戳命名）
//   2. 项目根目录 最新一次大模型对话.md — 始终保存最新一次对话，方便直接查看
import { mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

const TRACE_DIR = fileURLToPath(new URL("./llm_traces", import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url)).replace(/\/+$/, "");
const LATEST_CONVERSATION_FILE = `${PROJECT_ROOT}/最新一次大模型对话.md`;

try { mkdirSync(TRACE_DIR, { recursive: true }); } catch (e) {}

let traceCounter = 0;
let sessionId = Date.now().toString(36);

export function resetSession() {
  sessionId = Date.now().toString(36);
  traceCounter = 0;
}

/**
 * 保存一次 LLM 交互
 * @param {Object} opts
 * @param {string} opts.stage - 阶段标识 (plan-generation, sim-context-check 等)
 * @param {string} opts.planTitle - 方案标题
 * @param {string} opts.prompt - 发给大模型的完整提示词
 * @param {string} opts.response - 大模型返回的完整内容
 * @param {Object} opts.simulationContext - 仿真上下文
 * @param {Error}  opts.error - 错误信息
 * @param {Object} opts.metadata - 额外元数据
 */
export function traceLlmCall({ stage, planTitle, prompt, response, simulationContext, error, metadata }) {
  traceCounter += 1;
  const prefix = `${sessionId}-${String(traceCounter).padStart(3, "0")}-${stage}`;
  const now = new Date().toISOString();
  const label = planTitle || "未命名方案";

  // === 1. 历史归档: llm_traces/ 目录 ===
  if (prompt) {
    writeFileSync(`${TRACE_DIR}/${prefix}-prompt.txt`, String(prompt), "utf-8");
  }
  if (response) {
    writeFileSync(`${TRACE_DIR}/${prefix}-response.md`, String(response), "utf-8");
  }
  if (simulationContext && typeof simulationContext === "object") {
    writeFileSync(`${TRACE_DIR}/${prefix}-sim-context.json`, JSON.stringify({
      hasImages: !!(simulationContext.images?.side || simulationContext.images?.top),
      hasMetrics: !!(simulationContext.metrics && Object.keys(simulationContext.metrics).length > 0),
      hasStandards: !!(Array.isArray(simulationContext.standards) && simulationContext.standards.length > 0),
      speakerCount: Array.isArray(simulationContext.speakers) ? simulationContext.speakers.length : 0,
      metricsKeys: simulationContext.metrics ? Object.keys(simulationContext.metrics) : [],
      standardsCount: Array.isArray(simulationContext.standards) ? simulationContext.standards.length : 0
    }, null, 2), "utf-8");
  } else if (stage === "sim-context-check") {
    writeFileSync(`${TRACE_DIR}/${prefix}-sim-context.json`,
      JSON.stringify({ status: "null_or_missing", note: "simulationContext 为空 — 仿真章节不会生成" }, null, 2), "utf-8");
  }
  if (metadata || planTitle) {
    writeFileSync(`${TRACE_DIR}/${prefix}-meta.json`,
      JSON.stringify({ planTitle: label, stage, timestamp: now, ...(metadata || {}) }, null, 2), "utf-8");
  }
  if (error) {
    writeFileSync(`${TRACE_DIR}/${prefix}-error.txt`, String(error.message || error), "utf-8");
  }

  // === 2. 项目根目录: 最新一次大模型对话.md（始终覆盖为最新） ===
  if (prompt && response) {
    const simStatus = simulationContext && typeof simulationContext === "object"
      ? `✅ 有仿真数据 (图片:${simulationContext.images?.side ? "有" : "无"}, 指标:${simulationContext.metrics ? Object.keys(simulationContext.metrics).length : 0}项, 国标:${Array.isArray(simulationContext.standards) ? simulationContext.standards.length : 0}条)`
      : "❌ 无仿真数据 (simulationContext 为空)";

    const preview = String(response).slice(0, 500);
    const conversationMd = [
      `# 最新一次大模型方案生成对话`,
      "",
      `> 生成时间: ${now}`,
      `> 方案名称: ${label}`,
      `> 阶段: ${stage}`,
      `> 会话ID: ${sessionId}`,
      `> 仿真状态: ${simStatus}`,
      "",
      "---",
      "",
      "## 📤 发送给大模型的 Prompt",
      "",
      "```",
      String(prompt).slice(0, 30000),
      String(prompt).length > 30000 ? "\n\n... (prompt 超过30000字符，完整版见 llm_traces/ 目录)" : "",
      "```",
      "",
      "---",
      "",
      "## 📥 大模型返回的 Response",
      "",
      `> 总长度: ${String(response).length} 字符`,
      "",
      "### 前500字预览:",
      "",
      preview,
      "",
      "---",
      "",
      "### 完整 Response:",
      "",
      String(response),
      "",
      "---",
      "",
      `> 完整 prompt/response 归档: \`backend/llm_traces/${prefix}-*\``,
      "",
    ].join("\n");

    writeFileSync(LATEST_CONVERSATION_FILE, conversationMd, "utf-8");
    console.log(`[llm_tracer] ✅ 最新对话已保存: ${LATEST_CONVERSATION_FILE}`);
  }
}

export function traceFinalReport(planTitle, markdownRaw, markdownProcessed, simulationChapter) {
  const now = new Date().toISOString();
  const label = planTitle || "未命名方案";

  // 归档
  writeFileSync(`${TRACE_DIR}/${sessionId}-final-raw.md`, String(markdownRaw || ""), "utf-8");
  writeFileSync(`${TRACE_DIR}/${sessionId}-final-processed.md`, String(markdownProcessed || ""), "utf-8");
  if (simulationChapter) {
    writeFileSync(`${TRACE_DIR}/${sessionId}-final-simulation-chapter.md`, String(simulationChapter), "utf-8");
  }
  writeFileSync(`${TRACE_DIR}/${sessionId}-final-meta.json`, JSON.stringify({
    planTitle: label, timestamp: now,
    rawLength: String(markdownRaw || "").length,
    processedLength: String(markdownProcessed || "").length,
    hasSimulationChapter: !!simulationChapter,
    simulationChapterLength: String(simulationChapter || "").length
  }, null, 2), "utf-8");

  // 也保存到项目根目录
  writeFileSync(`${PROJECT_ROOT}/最新一次方案报告_最终版.md`, String(markdownProcessed || ""), "utf-8");

  console.log(`[llm_tracer] ✅ 最终报告已保存: ${PROJECT_ROOT}/最新一次方案报告_最终版.md`);
}

console.log(`[llm_tracer] 日志目录: ${TRACE_DIR}`);
console.log(`[llm_tracer] 最新对话: ${LATEST_CONVERSATION_FILE}`);
