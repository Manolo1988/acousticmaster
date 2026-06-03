// generate_report_with_simulation.mjs
// 调用真实 LLM 生成报告 + 注入仿真数据 + 保存为 PDF
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import axios from "axios";

dotenv.config({ path: fileURLToPath(new URL("./.env", import.meta.url)) });

const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_API_URL = process.env.ARK_API_URL || "https://ark.cn-beijing.volces.com/api/v3/responses";
const ARK_MODEL = process.env.ARK_MODEL || "doubao-seed-2-0-pro-260215";

// ============================================================
// Mock simulation context (simulating a completed simulation)
// ============================================================
const MOCK_SIMULATION_CONTEXT = {
  scenario: "LECTURE_HALL",
  room: { length: 25, width: 18, height: 8 },
  images: {
    side: "", // Will be filled from a file if available, or use a placeholder
    top: ""
  },
  metrics: {
    feasible: true,
    minSpl: 75.5, avgSpl: 82.3, maxSpl: 88.1,
    minSplTarget: 75,
    nonuniformity: 5.2, nonuniformityTarget: 8,
    headroom: 3.5, headroomTarget: 3
  },
  standards: [
    { name: "最大声压级", standard: "≥85dB (GB 50371-2006一级)", value: "88.1dB", pass: true },
    { name: "声场不均匀度", standard: "≤8dB (GB 50371-2006一级)", value: "5.2dB", pass: true },
    { name: "传输频率特性", standard: "125Hz~4kHz 允差±4dB", value: "±3.2dB", pass: true },
    { name: "系统总噪声级", standard: "≤NR-25", value: "NR-22", pass: true }
  ],
  speakers: [
    { label: "主扩声音箱 L", model: "LA-208", role: "主扩声", position: [-3.5, 2.0, 6.0], pitch: -5, yaw: 15, gainDb: 0, coverageH: 100, coverageV: 15 },
    { label: "主扩声音箱 R", model: "LA-208", role: "主扩声", position: [3.5, 2.0, 6.0], pitch: -5, yaw: -15, gainDb: 0, coverageH: 100, coverageV: 15 },
    { label: "台唇补声音箱 L", model: "TS-112", role: "台唇补声", position: [-2.0, 1.5, 1.2], pitch: 5, yaw: 10, gainDb: -3, coverageH: 90, coverageV: 60 },
    { label: "台唇补声音箱 R", model: "TS-112", role: "台唇补声", position: [2.0, 1.5, 1.2], pitch: 5, yaw: -10, gainDb: -3, coverageH: 90, coverageV: 60 },
    { label: "超低音箱 L", model: "SUB-218", role: "低频补偿", position: [-2.5, 0.5, 1.5], pitch: 0, yaw: 0, gainDb: 3, coverageH: 360, coverageV: 360 },
    { label: "超低音箱 R", model: "SUB-218", role: "低频补偿", position: [2.5, 0.5, 1.5], pitch: 0, yaw: 0, gainDb: 3, coverageH: 360, coverageV: 360 }
  ]
};

// ============================================================
// Database connection
// ============================================================
const pool = mysql.createPool({
  host: process.env.DB_HOST || "115.231.236.153",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "user1",
  password: process.env.DB_PASSWORD || "UasbecrD1!1",
  database: process.env.DB_NAME || "longdata_new",
  charset: "utf8mb4"
});

const LOCAL_STATIC_RESOURCE_TABLE = "本地静态资源";
const RESOURCE_TYPE_IMAGE = "图片";
const RESOURCE_TYPE_TEXT = "文字";
const RESOURCE_TYPE_TABLE = "表格";
const PLAN_CHAPTER_TITLE_CANDIDATES = ["项目概述", "设计依据和目标", "方案设计", "设备介绍", "装修建议", "环境要求"];

// ============================================================
// Helper functions (mirrored from server.js)
// ============================================================
const normalizeChapterTitle = (v) => String(v || "").replace(/^第\s*\d+\s*[章节]\s*/g, "").replace(/^\d+(?:\.\d+)*\s*/g, "").replace(/^[、\.:：\-\s]+/g, "").trim();
const normalizeSceneLabel = (s) => String(s || "") === "LECTURE_HALL" ? "报告厅" : "会议室";
const sanitizeSimulationDataUrl = (v) => { const r = String(v || "").trim(); if (!r) return ""; if (!/^data:image\/(png|jpg|jpeg|webp);base64,/i.test(r)) return ""; return r.length > 20*1024*1024 ? "" : r; };
const toFiniteNumberOrNull = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const formatDbValue = (v, d=1, u="") => { const n = toFiniteNumberOrNull(v); if (n==null) return "--"; return n.toFixed(d)+u; };
const toMarkdownTableCell = (v) => String(v==null?"":v).replace(/\|/g,"\\|").replace(/\r?\n/g," ").trim();

// ============================================================
// buildSimulationAnalysisChapter (mirrored from server.js)
// ============================================================
const buildBlueprintAnalysis = (side, top, sceneLabel) => {
  const views = [];
  if (side) views.push("侧视渲染图展示了扬声器在垂直剖面上的覆盖形态，可直观观察主扩声波束的投射路径、近场与远场声能分布以及是否存在明显声影区");
  if (top) views.push("俯视平面图呈现了扬声器在水平面上的声场覆盖范围，可评估声场均匀性、各区域声压分布差异以及相邻扬声器之间的覆盖重叠情况");
  if (views.length === 0) return "暂无仿真图纸素材。";
  const sc = (sceneLabel||"会议室").replace(/厅$/,"厅");
  return `${sc}逆向声学仿真的渲染图纸如上所示。${views.join("；")}。两张图纸从正交双视角完整呈现了本方案声场设计的空间覆盖特性，为后续设备安装定位与角度调试提供了可视化依据。`;
};

const buildSpeakerAnalysis = (speakers, sceneLabel) => {
  if (!Array.isArray(speakers)||speakers.length===0) return "暂无音箱设备数据。";
  const n=speakers.length, models=[...new Set(speakers.map(s=>s?.model||"").filter(Boolean))];
  const sc=(sceneLabel||"会议室").replace(/厅$/,"厅");
  return `本方案在${sc}场景下共部署 ${n} 只音箱，涉及型号：${models.join("、")}。各音箱的安装坐标、指向角度及增益参数均通过逆向声学优化算法自动求解，确保服务区内声压级满足设计目标、声场不均匀度控制在国标限值以内。`;
};

const buildMetricAnalysis = (metrics, sceneLabel) => {
  const sc=(sceneLabel||"会议室").replace(/厅$/,"厅");
  const mn=toFiniteNumberOrNull(metrics?.minSpl), mx=toFiniteNumberOrNull(metrics?.maxSpl);
  const nu=toFiniteNumberOrNull(metrics?.nonuniformity), nut=toFiniteNumberOrNull(metrics?.nonuniformityTarget);
  const hr=toFiniteNumberOrNull(metrics?.headroom);
  const f=metrics?.feasible===true?"满足设计要求":metrics?.feasible===false?"暂未达到设计目标":"待进一步验证";
  const parts = [
    mn!=null&&mx!=null?`服务区声压级范围为 ${mn.toFixed(1)}～${mx.toFixed(1)} dB`:"",
    nu!=null?`稳态声场不均匀度为 ${nu.toFixed(1)} dB${nut!=null?`（目标 ≤ ${nut.toFixed(1)} dB）`:""}`:"",
    hr!=null?`最低点声压余量为 ${hr.toFixed(1)} dB，确保了系统在峰值节目信号下仍具备充足的动态储备`:""
  ].filter(Boolean);
  return `${sc}声场仿真结果如上表所示。${parts.join("；")}。综合各维度指标，该方案仿真结论为：${f}。以上参数可作为方案评审与施工验收的量化依据。`;
};

const buildComplianceAnalysis = (standards, sceneLabel) => {
  if (!Array.isArray(standards)||standards.length===0) return "暂无国标合规校验数据。";
  const ps=standards.filter(s=>s?.pass===true).length, fs=standards.filter(s=>s?.pass===false).length;
  const sc=(sceneLabel||"会议室").replace(/厅$/,"厅");
  let s=`本方案针对${sc}场景，逐条对照现行国家标准（GB 50371-2006《厅堂扩声系统设计规范》及 GB/T 15381-94《会议系统电声性能要求》）进行了合规性校验。在 ${standards.length} 项关键指标中，${ps} 项达标`;
  if(fs>0) s+=`，${fs} 项暂未达标，建议对未达标项进行设计复核或设备参数调整`;
  s+="。国标合规校验是方案通过评审验收的必要前提。";
  return s;
};

const buildSimulationAnalysisChapter = (simCtx, scenario) => {
  if (!simCtx||typeof simCtx!=="object") return "";
  const metrics=simCtx?.metrics&&typeof simCtx.metrics==="object"?simCtx.metrics:{};
  const standards=Array.isArray(simCtx?.standards)?simCtx.standards:[];
  const speakers=Array.isArray(simCtx?.speakers)?simCtx.speakers:[];
  const images=simCtx?.images&&typeof simCtx.images==="object"?simCtx.images:{};
  const sideImg=sanitizeSimulationDataUrl(images?.side);
  const topImg=sanitizeSimulationDataUrl(images?.top);
  const hasMetric=[metrics?.minSpl,metrics?.avgSpl,metrics?.maxSpl,metrics?.nonuniformity,metrics?.headroom].some(v=>toFiniteNumberOrNull(v)!=null);
  if(!sideImg&&!topImg&&standards.length===0&&speakers.length===0&&!hasMetric) return "";

  const sc=normalizeSceneLabel(String(simCtx?.scenario||scenario||""));
  const lines=[];
  lines.push("##### 仿真分析","",
    `本仿真分析基于${sc}逆向声学设计结果，从图纸素材、设备清单、声场指标和国标合规四个维度，系统验证专业扩声系统设计的可行性、声场覆盖质量与国家现行标准的达标情况。以下各项数据均由三维声场仿真引擎自动计算生成，可作为方案评审与工程验收的客观技术依据。`,"");
  // 1. 图纸素材
  lines.push("###### 图纸素材","");
  if(sideImg){lines.push(`![逆向设计侧视渲染图](${sideImg})`,"","图 仿真-1 逆向设计侧视渲染图","");}
  if(topImg){lines.push(`![逆向设计俯视渲染图](${topImg})`,"","图 仿真-2 逆向设计俯视平面图","");}
  if(!sideImg&&!topImg)lines.push("> 未采集到仿真渲染图，请先在逆向设计页面完成渲染后再生成报告。","");
  lines.push(buildBlueprintAnalysis(sideImg,topImg,sc),"");
  // 2. 设备清单
  lines.push("###### 设备清单","");
  if(speakers.length>0){
    lines.push("| 序号 | 名称 | 型号 | 关键声学参数 | 安装坐标 (x,y,z m) | 指向 (俯仰/偏航) | 增益 |","| --- | --- | --- | --- | --- | --- | --- |");
    speakers.forEach((sp,i)=>{
      const pos=Array.isArray(sp?.position)?sp.position:[];
      const covH=sp?.coverageH!=null?`${Number(sp.coverageH).toFixed(0)}°`:"--";
      const covV=sp?.coverageV!=null?`${Number(sp.coverageV).toFixed(0)}°`:"--";
      lines.push(`| ${i+1} | ${toMarkdownTableCell(sp?.label||`音箱#${i+1}`)} | ${toMarkdownTableCell(sp?.model||"")} | 覆盖角 ${covH}×${covV} | (${formatDbValue(pos[0],2)}, ${formatDbValue(pos[1],2)}, ${formatDbValue(pos[2],2)}) | ${formatDbValue(sp?.pitch,1,"°")} / ${formatDbValue(sp?.yaw,1,"°")} | ${formatDbValue(sp?.gainDb,1," dB")} |`);
    });
  }else{lines.push("> 暂无音箱布置参数。","");}
  lines.push("",buildSpeakerAnalysis(speakers,sc),"");
  // 3. 声场指标说明
  lines.push("###### 声场指标说明","");
  const ft=metrics?.feasible===true?"达标":metrics?.feasible===false?"未达标":"待确认";
  lines.push("| 指标 | 仿真值 | 目标值 | 判定 |","| --- | --- | --- | --- |");
  lines.push(`| 服务区最小声压级 | ${formatDbValue(metrics?.minSpl)} dB | ${formatDbValue(metrics?.minSplTarget)} dB | ${formatDbValue(metrics?.minSpl)!=="--"?ft:"--"} |`);
  lines.push(`| 服务区平均声压级 | ${formatDbValue(metrics?.avgSpl)} dB | -- | -- |`);
  lines.push(`| 服务区最大声压级 | ${formatDbValue(metrics?.maxSpl)} dB | -- | -- |`);
  lines.push(`| 稳态声场不均匀度 | ${formatDbValue(metrics?.nonuniformity)} dB | ≤ ${formatDbValue(metrics?.nonuniformityTarget)} dB | ${formatDbValue(metrics?.nonuniformity)!=="--"?(toFiniteNumberOrNull(metrics?.nonuniformity)<=toFiniteNumberOrNull(metrics?.nonuniformityTarget)?"达标":"未达标"):"--"} |`);
  lines.push(`| 最低点声压余量 | ${formatDbValue(metrics?.headroom)} dB | ≥ ${formatDbValue(metrics?.headroomTarget)} dB | ${formatDbValue(metrics?.headroom)!=="--"?(toFiniteNumberOrNull(metrics?.headroom)>=toFiniteNumberOrNull(metrics?.headroomTarget)?"达标":"未达标"):"--"} |`);
  lines.push("",buildMetricAnalysis(metrics,sc),"");
  // 4. 国标合规校验
  lines.push("###### 国标合规校验","");
  if(standards.length>0){
    lines.push("| 规范条文 | 国标限值 | 本方案测量值 | 合规情况 |","| --- | --- | --- | --- |");
    standards.forEach(r=>{const p=r?.pass===true?"达标":r?.pass===false?"不达标":"--";lines.push(`| ${toMarkdownTableCell(r?.name||"")} | ${toMarkdownTableCell(r?.standard||"")} | ${toMarkdownTableCell(r?.value||"")} | ${p} |`);});
  }else{lines.push("> 暂无标准对比明细。","");}
  lines.push("",buildComplianceAnalysis(standards,sc),"");
  return lines.join("\n").trim();
};

// ============================================================
// Design effect section builder (simulation image + description)
// ============================================================
const buildDesignEffectEnhancement = (simCtx, scenario) => {
  if (!simCtx||typeof simCtx!=="object") return "";
  const images=simCtx?.images&&typeof simCtx.images==="object"?simCtx.images:{};
  const speakers=Array.isArray(simCtx?.speakers)?simCtx.speakers:[];
  const sideImg=sanitizeSimulationDataUrl(images?.side);
  if (!sideImg && speakers.length === 0) return "";

  const sc=normalizeSceneLabel(String(simCtx?.scenario||scenario||""));
  const lines=[];
  if (sideImg) {
    lines.push("", `![仿真声场侧视渲染图](${sideImg})`, "", "图 3-2-2-1 逆向声学仿真侧视渲染图", "");
  }
  if (speakers.length > 0) {
    const count = speakers.length;
    const positions = speakers.map(s => {
      const pos = Array.isArray(s?.position) ? s.position : [];
      return `${s?.label||s?.model||""}位于坐标(${pos[0]?.toFixed(1)||"?"}, ${pos[1]?.toFixed(1)||"?"}, ${pos[2]?.toFixed(1)||"?"})m`;
    });
    lines.push(`本方案通过三维逆向声学仿真验证，在${sc}场景下共计使用 ${count} 只扩声音箱。${positions.slice(0,4).join("；")}。各音箱通过优化算法自动确定最佳安装位置与指向角度，确保在整个服务区域内声场覆盖均匀、无明显声影区，关键声学指标均达到国标一级设计要求。`);
  }
  return lines.join("\n").trim();
};

// ============================================================
// Injection helpers
// ============================================================
const injectSimulationIntoProfessionalSection = (markdown, simMd) => {
  const source=String(markdown||"").trim(), addon=String(simMd||"").trim();
  if(!addon) return source; if(!source) return addon;
  if(/#####\s+仿真分析/.test(source)) return source;
  const lines=source.split(/\r?\n/), headings=[];
  for(let i=0;i<lines.length;i++){const m=lines[i].match(/^(#{1,6})\s+(.+)$/);if(m) headings.push({index:i,level:m[1].length,title:m[2].trim()});}
  const nrm=(v="")=>String(v||"").replace(/\s+/g,"");
  let anchor=headings.find(h=>{const t=nrm(h.title);return /3\.2\.[34]\.1/.test(t)&&t.includes("专业扩声系统");});
  if(!anchor) anchor=headings.find(h=>/3\.2\.[34]\.1/.test(nrm(h.title)));
  if(!anchor) anchor=headings.find(h=>{const t=nrm(h.title);return /3\.2\.[34]/.test(t)&&t.includes("系统设计");});
  if(!anchor) return `${source}\n\n${addon}\n`;
  let sectionEnd=lines.length;
  for(const h of headings){if(h.index<=anchor.index) continue; if(h.level<=anchor.level){sectionEnd=h.index;break;}}
  lines.splice(sectionEnd,0,"",addon,"");
  return lines.join("\n").replace(/\n{3,}/g,"\n\n").trim();
};

const injectDesignEffect = (markdown, enhancementMd) => {
  const source=String(markdown||"").trim(), addon=String(enhancementMd||"").trim();
  if(!addon) return source;
  const lines=source.split(/\r?\n/), headings=[];
  for(let i=0;i<lines.length;i++){const m=lines[i].match(/^(#{1,6})\s+(.+)$/);if(m) headings.push({index:i,level:m[1].length,title:m[2].trim()});}
  const nrm=(v="")=>String(v||"").replace(/\s+/g,"");
  // Find 3.2.2 设计效果 heading
  let anchor=headings.find(h=>{const t=nrm(h.title);return /3\.2\.2/.test(t)&&(t.includes("设计效果")||t.includes("效果"));});
  if(!anchor) anchor=headings.find(h=>/3\.2\.2/.test(nrm(h.title)));
  if(!anchor) return source; // Can't find the section
  let sectionEnd=lines.length;
  for(const h of headings){if(h.index<=anchor.index) continue; if(h.level<=anchor.level){sectionEnd=h.index;break;}}
  lines.splice(sectionEnd,0,"",addon,"");
  return lines.join("\n").replace(/\n{3,}/g,"\n\n").trim();
};

// ============================================================
// Call LLM to generate report
// ============================================================
async function callArkForMarkdown(prompt) {
  console.log("📡 Calling Ark API...");
  const response = await axios.post(ARK_API_URL, {
    model: ARK_MODEL,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
  }, {
    headers: { Authorization: `Bearer ${ARK_API_KEY}`, "Content-Type": "application/json" },
    timeout: 300000
  });
  const data = response.data;
  // Extract markdown text from Ark response
  let text = "";
  if (typeof data.output_text === "string" && data.output_text.trim()) text = data.output_text;
  else if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (typeof item?.text === "string") text += item.text + "\n";
      if (Array.isArray(item?.content)) {
        for (const part of item.content) { if (typeof part?.text === "string") text += part.text + "\n"; }
      }
    }
  } else if (Array.isArray(data.content)) {
    text = data.content.map(x => x?.text || "").join("\n");
  }
  text = text.trim();
  // Strip markdown fences
  text = text.replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return text;
}

// ============================================================
// Load static resources from DB for prompt
// ============================================================
async function loadResources(scenario) {
  const sceneLabel = normalizeSceneLabel(scenario);
  const validSet = new Set(PLAN_CHAPTER_TITLE_CANDIDATES.map(t => normalizeChapterTitle(t)));
  const [rows] = await pool.query(
    `SELECT id, block_key, title, description, content, \`插入章节\`, \`使用场景\`, \`资源类型\`, enabled
     FROM \`${LOCAL_STATIC_RESOURCE_TABLE}\`
     WHERE content IS NOT NULL AND content <> ''`
  );
  return rows
    .filter(r => { const e = Number(r?.enabled ?? 1); if (e === 0) return false; const s = String(r?.["使用场景"] || "").trim(); return !s || s === "通用" || s === sceneLabel; })
    .map(r => {
      const ct = normalizeResourceType(r?.["资源类型"], inferResourceTypeFromContent(r?.content || ""));
      return { id: r?.id, name: String(r?.title || r?.block_key || ""), chapter: normalizeChapterTitle(String(r?.["插入章节"] || "")), desc: String(r?.description || "").trim(), content: String(r?.content || "").trim(), type: ct };
    })
    .filter(r => r.content && r.chapter && validSet.has(r.chapter));
}

function normalizeResourceType(v, fb) {
  const n = String(v || "").trim();
  if (n === RESOURCE_TYPE_IMAGE || n === "image") return RESOURCE_TYPE_IMAGE;
  if (n === RESOURCE_TYPE_TABLE || n === "table") return RESOURCE_TYPE_TABLE;
  return fb || RESOURCE_TYPE_TEXT;
}

function inferResourceTypeFromContent(c) {
  const t = String(c || "").trim().toLowerCase();
  if (!t) return RESOURCE_TYPE_TEXT;
  if (t.startsWith("data:image/")) return RESOURCE_TYPE_IMAGE;
  const ls = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (ls.some(l => /^\|.+\|$/.test(l)) && ls.some(l => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(l))) return RESOURCE_TYPE_TABLE;
  return RESOURCE_TYPE_TEXT;
}

// ============================================================
// Build prompt (mirrored from server.js)
// ============================================================
function buildPrompt(resources) {
  const resourceSection = resources.length > 0
    ? "\n【本地静态资源（按章节）】\n" + resources.map(r =>
        `- 章节: ${r.chapter}\n  资源名称: ${r.name}\n  资源类型: ${r.type}\n  资源描述: ${r.desc || "（无）"}\n  占位符: {{RES_${r.type==="表格"?"TABLE":r.type==="图片"?"IMAGE":"TEXT"}_${r.id}}}`
      ).join("\n")
    : "";

  const template = readFileSync(new URL("./大模型方案生成指导模板.md", import.meta.url), "utf-8").slice(0, 8000);

  return [
    "你是专业声学顾问，请根据输入生成可直接用于投标/验收的正式 Markdown 方案。",
    "项目名称: 某市政府多功能报告厅",
    "方案标题: 线阵列扩声系统设计方案",
    "",
    "【用户输入】",
    JSON.stringify({ scene: "报告厅", length: 25, width: 18, height: 8, stage_to_near_audience: 3, stage_to_far_audience: 20, stage_width: 12, stage_depth: 6, selected_systems: ["扩声系统","中控系统","视频会议系统"], extra_requirements: "需满足大型会议、文艺演出需求" }, null, 2),
    "",
    "【设备清单】",
    JSON.stringify([
      { 设备分类: "音箱", 设备名称: "线阵列主扩声音箱", 品牌: "LA", 型号: "LA-208", 数量: 8, 单位: "只" },
      { 设备分类: "音箱", 设备名称: "台唇补声音箱", 品牌: "TS", 型号: "TS-112", 数量: 4, 单位: "只" },
      { 设备分类: "音箱", 设备名称: "超低音箱", 品牌: "SUB", 型号: "SUB-218", 数量: 2, 单位: "只" },
      { 设备分类: "功放", 设备名称: "四通道数字功放", 品牌: "PA", 型号: "PA-4800", 数量: 4, 单位: "台" },
      { 设备分类: "处理器", 设备名称: "数字音频处理器", 品牌: "DSP", 型号: "DSP-1608", 数量: 1, 单位: "台" },
      { 设备分类: "调音台", 设备名称: "数字调音台", 品牌: "MIX", 型号: "MIX-32", 数量: 1, 单位: "台" },
      { 设备分类: "中控", 设备名称: "中控主机", 品牌: "CTRL", 型号: "CTRL-PRO", 数量: 1, 单位: "台" },
      { 设备分类: "视频会议", 设备名称: "高清会议终端", 品牌: "VC", 型号: "VC-4K", 数量: 1, 单位: "台" },
      { 设备分类: "话筒", 设备名称: "一拖二无线手持话筒", 品牌: "MIC", 型号: "MIC-U2", 数量: 4, 单位: "套" },
      { 设备分类: "话筒", 设备名称: "一拖四无线鹅颈麦克风", 品牌: "MIC", 型号: "MIC-G4", 数量: 2, 单位: "套" }
    ], null, 2),
    "",
    "【输出约束】",
    "1. 仅输出 Markdown，不要输出 JSON。",
    "2. 设备型号和数量必须与设备清单一致，不得增删编造。",
    "3. 内容必须与场景匹配。",
    "4. 必须严格遵守模板中的目录结构和章节顺序。",
    "5. 只保留设备清单中实际存在的系统章节，3.2.2 设计效果章节要保留。",
    "6. 必须包含完整工程化文字描述。",
    "7. 必须输出声压计算公式，并对每个公式给出不少于50字的原则说明。",
    "8. 国标对照表、声学公式、仿真分析等静态和计算内容由后端按章节自动插入，你不需要为它们生成占位符或章节。",
    "9. 禁止输出 base64、图片 URL 或 HTML 图片标签。",
    "10. 本地静态资源请使用后端提供的占位符 {{RES_TEXT_xxx}} {{RES_TABLE_xxx}}，占位符建议单独成行且前面写资源解释文本。",
    "11. 设备图片统一使用格式 [图片占位符：设备名称]。",
    `12. 每个子模块正文不少于 200 字（不含表格与公式）。`,
    resourceSection,
    "",
    "【参考模板（节选）】",
    template
  ].join("\n");
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("=".repeat(60));
  console.log("  报告生成 + 仿真注入 + PDF 输出");
  console.log("=".repeat(60));

  // Step 1: Load DB resources
  console.log("\n📊 Loading DB static resources...");
  const resources = await loadResources("LECTURE_HALL");
  console.log(`  Found ${resources.length} resources from DB`);
  for (const r of resources) {
    console.log(`    [${r.type}] ${r.name} → 章节: ${r.chapter}, 占位符: {{RES_${r.type==="表格"?"TABLE":r.type==="图片"?"IMAGE":"TEXT"}_${r.id}}}`);
  }

  // Step 2: Call LLM
  console.log("\n🤖 Generating report via LLM...");
  const prompt = buildPrompt(resources);
  let markdownRaw;
  try {
    markdownRaw = await callArkForMarkdown(prompt);
    console.log(`  LLM returned ${markdownRaw.length} chars`);
  } catch (error) {
    console.error("  LLM call failed:", error.message);
    console.log("  Using fallback mock markdown...");
    markdownRaw = readFileSync(new URL("./大模型方案生成指导模板.md", import.meta.url), "utf-8");
  }

  // Step 3: Inject simulation chapter
  console.log("\n🔬 Building simulation chapter...");
  const simChapter = buildSimulationAnalysisChapter(MOCK_SIMULATION_CONTEXT, "LECTURE_HALL");
  console.log(`  Simulation chapter: ${simChapter.length} chars`);
  if (simChapter) {
    console.log("  Sections:", simChapter.match(/^#{5,6}\s+.+$/gm)?.join(", ") || "none");
  }

  const markdownWithSim = injectSimulationIntoProfessionalSection(markdownRaw, simChapter);
  const simInjected = markdownWithSim !== markdownRaw;
  console.log(`  Simulation injected: ${simInjected ? "✅ YES" : "❌ NO (check anchor matching)"}`);

  // Step 4: Inject design effect enhancement (simulation image + description)
  console.log("\n🎨 Building design effect enhancement...");
  const designEffectEnh = buildDesignEffectEnhancement(MOCK_SIMULATION_CONTEXT, "LECTURE_HALL");
  console.log(`  Design effect enhancement: ${designEffectEnh.length} chars`);

  let markdownFinal = markdownWithSim;
  if (designEffectEnh) {
    markdownFinal = injectDesignEffect(markdownWithSim, designEffectEnh);
    console.log(`  Design effect injected: ${markdownFinal !== markdownWithSim ? "✅ YES" : "❌ NO"}`);
  }

  // Step 5: TOC insertion
  console.log("\n📑 Generating TOC...");
  const tocLines = [];
  const tocLinesRaw = markdownFinal.split(/\r?\n/);
  for (const line of tocLinesRaw) {
    const m = line.match(/^(#{2,6})\s+(.+)$/);
    if (m) tocLines.push(`${"  ".repeat(m[1].length - 2)}- [${m[2].trim()}](#${m[2].trim().toLowerCase().replace(/[^\w\s一-龥]/g,"").trim().replace(/\s+/g,"-")})`);
  }
  if (tocLines.length >= 2) {
    const tocSection = ["", "## 目录", "", tocLines.join("\n"), "", "---", ""];
    const ls = markdownFinal.split(/\r?\n/);
    let insertAt = 0;
    for (let i = 0; i < ls.length; i++) { if (/^#\s+/.test(ls[i])) { insertAt = i+1; while(insertAt<ls.length&&ls[insertAt].trim()==="") insertAt++; break; } }
    ls.splice(insertAt, 0, ...tocSection);
    markdownFinal = ls.join("\n");
  }

  // Step 6: Save markdown and HTML
  console.log("\n💾 Saving output...");
  const outDir = new URL("./generated_docs/", import.meta.url);
  try { mkdirSync(outDir, { recursive: true }); } catch(e) {}

  // Save markdown
  const mdPath = new URL(`./generated_docs/${Date.now()}-report-with-simulation.md`, import.meta.url);
  writeFileSync(mdPath, markdownFinal, "utf-8");
  console.log(`  Markdown saved: ${mdPath.pathname}`);

  // Convert to HTML
  const escaped = markdownFinal
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "<br/>")
    .replace(/!\[([^\]]*)\]\((data:image\/[^)]+)\)/gi, (_, alt, src) => `<br/><figure style="margin:14px 0"><img src="${src}" alt="${alt}" style="max-width:100%;height:auto;border:1px solid #cbd5e1;border-radius:6px"/><figcaption style="margin-top:6px;font-size:11pt;color:#334155">${alt}</figcaption></figure><br/>`);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>某市政府多功能报告厅-线阵列扩声系统设计方案</title>
<style>
body{font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif;line-height:1.75;color:#1f2937;font-size:13pt;margin:24px}
h1,h2,h3,h4,h5,h6{color:#0f172a}
pre{white-space:pre-wrap;word-wrap:break-word;background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:6px}
@media print{body{margin:0;padding:12mm}}
</style></head><body>
<h1>某市政府多功能报告厅 - 线阵列扩声系统设计方案</h1>
<pre>${escaped}</pre>
</body></html>`;

  const htmlPath = new URL(`./generated_docs/${Date.now()}-report-with-simulation.html`, import.meta.url);
  writeFileSync(htmlPath, html, "utf-8");
  console.log(`  HTML saved: ${htmlPath.pathname}`);

  // Step 7: Verification
  console.log("\n🔍 Verification:");
  const checks = [
    ["Has '仿真分析' chapter", /仿真分析/.test(markdownFinal) ? "✅" : "❌"],
    ["Has '图纸素材' subsection", /图纸素材/.test(markdownFinal) ? "✅" : "❌"],
    ["Has '设备清单' subsection", /设备清单/.test(markdownFinal) ? "✅" : "❌"],
    ["Has '声场指标说明' subsection", /声场指标说明/.test(markdownFinal) ? "✅" : "❌"],
    ["Has '国标合规校验' subsection", /国标合规校验/.test(markdownFinal) ? "✅" : "❌"],
    ["Has speaker model LA-208", /LA-208/.test(markdownFinal) ? "✅" : "❌"],
    ["Has speaker model SUB-218", /SUB-218/.test(markdownFinal) ? "✅" : "❌"],
    ["Has SPL 75.5 dB", /75\\.5\\s*dB/.test(markdownFinal) ? "✅" : "❌"],
    ["Has GB 50371-2006", /50371/.test(markdownFinal) ? "✅" : "❌"],
    ["Has TOC", /## 目录/.test(markdownFinal) ? "✅" : "❌"],
    ["Simulation chapter present", simInjected ? "✅" : "❌"],
    ["Total markdown length", `${markdownFinal.length} chars (>5000: ${markdownFinal.length > 5000 ? "✅" : "❌"})`],
  ];
  for (const [label, result] of checks) console.log(`  ${result} ${label}`);

  // Step 8: Print file paths
  console.log("\n📁 Output files:");
  console.log(`  MD:  ${mdPath.pathname}`);
  console.log(`  HTML: ${htmlPath.pathname}`);
  console.log("\n  To view: open the HTML file in a browser and Print → Save as PDF");

  await pool.end();
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
