const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const SCRIPT = '/home/ubuntu/zdh/manage_backend.sh';

app.use(cors());
app.use(express.json());

app.get('/api/system/ai-status', (req, res) => {
    exec(`${SCRIPT} status`, (err, stdout) => {
        const isRunning = stdout.includes('正在运行');
        res.json({ isRunning, raw: stdout });
    });
});

app.post('/api/system/ai-toggle', (req, res) => {
    const { action } = req.body;
    exec(`${SCRIPT} ${action}`, (err, stdout) => {
        res.json({ success: !err, message: stdout });
    });
});

app.listen(4000, '0.0.0.0', () => {
    console.log('🛡️ Daemon Manager on 4000');
});
