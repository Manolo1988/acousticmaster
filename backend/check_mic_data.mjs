import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });

const pool = mysql.createPool({
  host: process.env.DB_HOST || '115.231.236.153',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'user1',
  password: process.env.DB_PASSWORD || 'UasbecrD1!1',
  database: process.env.DB_NAME || 'longdata_new',
  charset: 'utf8mb4'
});

const [typeRows] = await pool.query("SELECT TRIM(COALESCE(`类型`, '')) AS type_value, COUNT(*) AS cnt FROM `周边设备` GROUP BY TRIM(COALESCE(`类型`, '')) ORDER BY cnt DESC LIMIT 50");
console.log('TYPE_DIST_ROWS=' + typeRows.length);
console.table(typeRows);

const [micEqRows] = await pool.query("SELECT `类型`, `产品名称`, `型号` FROM `周边设备` WHERE TRIM(COALESCE(`类型`, '')) = '话筒' LIMIT 50");
console.log('MIC_EQ_ROWS=' + micEqRows.length);
console.table(micEqRows);

const [micLikeRows] = await pool.query("SELECT `类型`, `产品名称`, `型号` FROM `周边设备` WHERE TRIM(COALESCE(`类型`, '')) LIKE '%话筒%' LIMIT 50");
console.log('MIC_LIKE_ROWS=' + micLikeRows.length);
console.table(micLikeRows);

await pool.end();
