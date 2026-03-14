// daemon_manager.js - AI 引擎状态监控与启动服务 (监听 4000)
import express from "express";
import cors from "cors";
import { exec } from "child_process";

const app = express();
const PORT = 4000;
const SCRIPT_PATH = "/home/ubuntu/zdh/manage_backend.sh";

app.use(cors());
app.use(express.json());

// 1. 查询状态接口 (即便是 AI 关了，这个 4000 也会返回 isRunning: false)
app.get("/api/system/ai-status", (req, res) => {
  exec(`${SCRIPT_PATH} status`, (error, stdout) => {
    const isRunning = stdout.includes("正在运行");
    res.json({ isRunning, raw: stdout });
  });
});

// 2. 切换状态接口 (由 4000 端口代为拉起或杀死 3003 端口的进程)
app.post("/api/system/ai-toggle", (req, res) => {
  const { action } = req.body; // 'start' or 'stop'
  if (!['start', 'stop'].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  console.log(`[Daemon] Executing ${action} on AI Engine...`);
  exec(`${SCRIPT_PATH} ${action}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`[Daemon] Error: ${stderr || error.message}`);
      return res.status(500).json({ error: stderr || error.message });
    }
    res.json({ success: true, message: stdout });
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🛡️  Daemon Manager is running on http://0.0.0.0:${PORT}`);
  console.log(`📍 Controlling script: ${SCRIPT_PATH}`);
});
