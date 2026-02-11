const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 1. 配置数据库连接
const db = mysql.createPool({
  host: 'localhost',
  user: 'root',      // 你的数据库用户名
  password: '你的数据库密码', // ！！！这里填入你 MySQL 的真实密码
  database: '你的数据库名',   // ！！！这里填入你的数据库名称
  waitForConnections: true,
  connectionLimit: 10
});

// 2. 获取列表接口 (GET)
app.get('/api/inventory', (req, res) => {
  const { tableName } = req.query; // 接收前端传来的表名
  // 安全起见，这里可以做一个表名白名单检查
  const sql = `SELECT * FROM ??`; 
  db.query(sql, [tableName], (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

// 3. 录入设备接口 (POST)
app.post('/api/inventory', (req, res) => {
  const { tableName, data } = req.body;
  const sql = `INSERT INTO ?? SET ?`;
  db.query(sql, [tableName, data], (err, result) => {
    if (err) return res.status(500).send(err);
    res.json({ id: result.insertId, ...data });
  });
});

// 4. 启动服务器
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`后端服务已启动：http://localhost:${PORT}`);
});