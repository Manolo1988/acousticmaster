import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: '115.231.236.153',
  port: 3306,
  user: 'user1',
  password: 'UasbecrD1!1',
  database: 'longdata_new',
  charset: 'utf8mb4'
});

const [rows] = await pool.query("SELECT DISTINCT `产品名称` AS value FROM `周边设备` WHERE TRIM(COALESCE(`类型`, ''))='话筒' AND `产品名称` IS NOT NULL AND TRIM(`产品名称`)<>'' ORDER BY value ASC");
const list = (Array.isArray(rows) ? rows : []).map((r) => String(r.value || '').trim()).filter(Boolean);
console.log(JSON.stringify(list, null, 2));
await pool.end();
