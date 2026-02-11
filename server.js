// server.js
import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());

// 全局变量（仅演示用）
let latestAcousticIntent = null;
let latestDifyResult = null;

// 保存 Acoustic Intent（和你原来一样）
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

  try {
    console.log("🚀 Calling Dify Chatflow with intent:", latestAcousticIntent);

    const response = await axios.post(
      DIFY_CHAT_API_URL,
      {
        inputs: latestAcousticIntent,
        query: "请执行声学方案设计流程。", // 👈 改为非空（避免 400）
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

// （可选）调试接口
app.get("/api/dify-result/latest", (req, res) => {
  res.json(latestDifyResult || { message: "No result yet" });
});

app.get("/api/acoustic-intent/latest", (req, res) => {
  res.json(latestAcousticIntent || {});
});

// 启动
const PORT = 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🎧 Server running on http://0.0.0.0:${PORT}`);
});
