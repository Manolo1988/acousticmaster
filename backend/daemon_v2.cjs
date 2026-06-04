const express = require('express');
const cors = require('cors');
const path = require('path');
const { exec, spawn } = require('child_process');

const app = express();
const SCRIPT = path.join(__dirname, '..', 'manage_backend.sh');
const DOCKER_COMPOSE_MANAGED = process.env.DOCKER_COMPOSE_MANAGED === 'true';
const PROJECT_ROOT = process.env.PROJECT_ROOT || '/app';
const SERVER_ENTRY = path.join(PROJECT_ROOT, 'server.js');
const AI_BACKEND_PORT = String(process.env.AI_BACKEND_PORT || '3003');
const AI_DAEMON_PORT = Number(process.env.AI_DAEMON_PORT || '4000');

let aiProcess = null;

app.use(cors());
app.use(express.json());

const isManagedProcessRunning = () => !!aiProcess && aiProcess.exitCode === null && !aiProcess.killed;

const startManagedBackend = () => {
    if (isManagedProcessRunning()) {
        return { success: true, message: 'Service is already running.' };
    }

    aiProcess = spawn('node', [SERVER_ENTRY], {
        cwd: PROJECT_ROOT,
        env: {
            ...process.env,
            PORT: AI_BACKEND_PORT
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    aiProcess.stdout.on('data', (chunk) => {
        process.stdout.write(`[ai-backend] ${chunk}`);
    });

    aiProcess.stderr.on('data', (chunk) => {
        process.stderr.write(`[ai-backend] ${chunk}`);
    });

    aiProcess.on('exit', (code, signal) => {
        console.log(`[ai-backend] exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`);
        aiProcess = null;
    });

    return { success: true, message: `AI backend started on port ${AI_BACKEND_PORT}.` };
};

const stopManagedBackend = () => {
    if (!isManagedProcessRunning()) {
        return { success: true, message: 'Service is already stopped.' };
    }

    aiProcess.kill('SIGTERM');
    return { success: true, message: 'Stopping service...' };
};

const getManagedStatus = () => ({
    isRunning: isManagedProcessRunning(),
    raw: isManagedProcessRunning()
        ? `🟢 服务当前状态: 正在运行 (PID: ${aiProcess.pid})\n📍 监听端口: ${AI_BACKEND_PORT}\n`
        : '❌ 服务当前状态: 已停止\n'
});

app.get('/api/system/ai-status', (req, res) => {
    if (DOCKER_COMPOSE_MANAGED) {
        return res.json(getManagedStatus());
    }

    exec(`${SCRIPT} status`, (err, stdout) => {
        const isRunning = stdout.includes('正在运行');
        res.json({ isRunning, raw: stdout });
    });
});

app.post('/api/system/ai-toggle', (req, res) => {
    const { action } = req.body;

    if (!['start', 'stop'].includes(action)) {
        return res.status(400).json({ success: false, message: 'Invalid action.' });
    }

    if (DOCKER_COMPOSE_MANAGED) {
        const result = action === 'start' ? startManagedBackend() : stopManagedBackend();
        return res.json(result);
    }

    exec(`${SCRIPT} ${action}`, (err, stdout) => {
        res.json({ success: !err, message: stdout });
    });
});

if (DOCKER_COMPOSE_MANAGED && process.env.AUTO_START_AI !== 'false') {
    const result = startManagedBackend();
    console.log(`[daemon] ${result.message}`);
}

const shutdown = () => {
    if (isManagedProcessRunning()) {
        aiProcess.kill('SIGTERM');
    }
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(AI_DAEMON_PORT, '0.0.0.0', () => {
    console.log(`🛡️ Daemon Manager on ${AI_DAEMON_PORT}`);
});
