// server.js
import express from "express";
import cors from "cors";
import axios from "axios";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

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
  database: process.env.DB_NAME || "longdata_new",
  charset: "utf8mb4",
  connectionLimit: 10
};

const pool = mysql.createPool(DB_CONFIG);
const isProduction = process.env.NODE_ENV === 'production';
const ALLOWED_TABLES = new Set([
  "音箱",
  "线阵列配套",
  "定阻功放",
  "周边设备",
  "其他设备"
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
const LOCAL_LLM_URL = process.env.LOCAL_LLM_URL || "http://115.231.236.153:11434/v1/chat/completions";
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || "qwen3:32b"; 

app.post("/api/chat-assistant", async (req, res) => {
  const { message, history = [], currentParams = {} } = req.body;

  const systemPrompt = `你是一位专业的声学系统设计师。你的任务是通过对话引导用户提供设计方案所需的关键信息。
当前已掌握参数: ${JSON.stringify(currentParams)}

所需关键信息清单：
1. 空间类型 (会议室/报告厅)
2. 空间尺寸 (长、宽、高) [单位: 米]
3. 核心功能需求 (如：是否有远程视频、是否需要录制、中控一键切换等)
4. 话筒偏好 (如：手持、鹅颈、阵列等)

人性化交互指南：
- 像在茶水间沟通一样亲切自然，不要给人填表的感觉。
- 如果用户说“很大”、“很宽”，可以尝试询问“大概能坐多少人？”来反推面积，并回复 [UPDATE_PARAM: {"length": x, "width": y}]。
- 当你检测到任何数值或设定变化时，必须输出 [UPDATE_PARAM: {"key": value}]，放在回复的最末尾（不要加在正文中）。
- 所有对话内容必须简洁，每轮对话尽量只关注一个新信息点。
- 请直接输出建议，不要输出任何思考过程（绝对不要包含 <think> 标签）。
- 当信息集齐到可以出方案时，请热情地邀请用户点击“生成方案”并给出你的专业简评。`;

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
      temperature: 0.7,
      stream: true, // 👈 开启流式输出
      options: {
        num_ctx: 4096,
        top_k: 40,
        top_p: 0.9
      }
    }, { 
      timeout: 120000,
      responseType: 'stream' // 👈 接收流
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
  try {
    latestAcousticIntent = JSON.parse(JSON.stringify(acousticIntent));
    console.log("✅ Acoustic Intent saved:", latestAcousticIntent);
    res.json(latestAcousticIntent);
  } catch (err) {
    res.status(500).json({ error: "Serialization failed" });
  }
});

// 🔥 修改：直接返回 Dify 的原始 answer，不做任何 JSON 解析
app.post("/api/run-dify-chatflow", async (req, res) => {
  if (!latestAcousticIntent) {
    return res.status(400).json({ error: "No acoustic intent submitted yet." });
  }

  // === ⚠️ 替换为你自己的 Dify 信息 ===
  const DIFY_API_KEY = "app-TUFsI5nY9v9e6ZEUXiNvISuZ"; // ← 已保留你的 key
  const DIFY_CHAT_API_URL = "http://115.231.236.153:20000/v1/chat-messages"; // 自建地址
  const queryText = isProduction ? "请执行声学方案设计流程。" : "请执行声学方案设计流程（测试）。";
  console.log(`🎯 Running Dify Chatflow in ${isProduction ? 'production' : 'development'} mode with query: "${queryText}"`);
  try {
    console.log("🚀 Calling Dify Chatflow with intent:", latestAcousticIntent);

    const response = await axios.post(
      DIFY_CHAT_API_URL,
      {
        inputs: latestAcousticIntent,
        query: queryText, // 👈 改为非空（避免 400）
        response_mode: "blocking",
        user: "acoustic_user_001"
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
    latestDifyResult = output;
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

// （可选）调试接口
app.get("/api/dify-result/latest", (req, res) => {
  res.json(latestDifyResult || { message: "No result yet" });
});

app.get("/api/acoustic-intent/latest", (req, res) => {
  res.json(latestAcousticIntent || {});
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

// 启动 - 支持环境变量动态指定端口
// 强制设置一个未被占用的端口 3003 (原 3002 被系统进程占用)
const PORT = 3003;
const DIFY_INTENT_HOST = process.env.DIFY_INTENT_HOST || "115.231.236.153";
const difyIntentUrl = `http://${DIFY_INTENT_HOST}:${PORT}/api/acoustic-intent/latest`;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🎧 Server running on http://0.0.0.0:${PORT}`);
  console.log(`🎯 Current environment: ${isProduction ? 'production' : 'development'}`);
  console.log(`🤖 Dify should request: ${difyIntentUrl}`);
});