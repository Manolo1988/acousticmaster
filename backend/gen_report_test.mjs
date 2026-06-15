// Quick report generation test with mock simulation data
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import dotenv from 'dotenv';
import axios from 'axios';
import { fileURLToPath } from 'url';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });

const API_KEY = process.env.ARK_API_KEY;
const API_URL = process.env.ARK_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/responses';
const MODEL = process.env.ARK_MODEL || 'doubao-seed-2-0-pro-260215';

// Build prompt
const template = readFileSync(fileURLToPath(new URL('./大模型方案生成指导模板.md', import.meta.url)), 'utf-8').slice(0, 8000);

const prompt = [
  '你是专业声学顾问，请根据输入生成可直接用于投标/验收的正式 Markdown 方案。',
  '项目名称: 测试_仿真报告验证',
  '方案标题: 方案1',
  '',
  '【用户输入】',
  JSON.stringify({ scene: '会议室', length: 20, width: 10, height: 4, selected_systems: ['扩声系统','中控系统','话筒'], extra_requirements: '' }),
  '',
  '【设备清单】',
  JSON.stringify([
    { 设备分类:'音箱',设备名称:'8寸全频音箱',品牌:'AK',型号:'AK-80',数量:4,单位:'只' },
    { 设备分类:'功放',设备名称:'数字功放',品牌:'AK',型号:'AK-200',数量:2,单位:'台' },
    { 设备分类:'话筒',设备名称:'无线手持话筒',品牌:'AK',型号:'AK-M1',数量:2,单位:'套' },
  ]),
  '',
  '【输出约束】',
  '1. 仅输出 Markdown，不要输出 JSON。',
  '2. 设备型号和数量必须与设备清单一致。',
  '3. 必须严格遵守模板中的目录结构和章节顺序。',
  '4. 公式全部在第2章2.4声学计算依据输出一次，第3章绝不重复。',
  '5. 仿真分析章节由后端自动生成，你不需要编写。',
  '6. 禁止输出 base64、图片 URL。',
  '',
  '【参考模板（节选）】',
  template,
].join('\n');

console.log('📡 Calling LLM...');
try {
  const resp = await axios.post(API_URL, {
    model: MODEL,
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }]
  }, { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, timeout: 300000 });

  let text = '';
  const d = resp.data;
  if (typeof d.output_text === 'string') text = d.output_text;
  else if (Array.isArray(d.output)) {
    for (const item of d.output) {
      if (typeof item?.text === 'string') text += item.text + '\n';
      if (Array.isArray(item?.content)) for (const p of item.content) if (typeof p?.text === 'string') text += p.text + '\n';
    }
  }
  text = text.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trim();

  console.log(`LLM returned ${text.length} chars`);

  // Build mock simulation chapter (simulates what backend would do)
  const simChapter = `##### 仿真分析

本仿真分析基于会议室逆向声学设计结果，从图纸素材、声场指标和国标合规三个维度验证专业扩声系统设计。

###### 图纸素材

> 仿真俯视平面图由后端在完整流程中自动插入

###### 声场指标说明

| 指标 | 仿真值 | 目标值 | 判定 |
| --- | --- | --- | --- |
| 服务区最小声压级 | 75.5 dB | 75.0 dB | 达标 |
| 服务区平均声压级 | 82.3 dB | -- | -- |
| 稳态声场不均匀度 | 5.2 dB | ≤ 8.0 dB | 达标 |
| 最低点声压余量 | 3.5 dB | ≥ 3.0 dB | 达标 |

###### 国标合规校验

| 规范条文 | 国标限值 | 测量值 | 合规 |
| --- | --- | --- | --- |
| 最大声压级 | ≥85dB | 88.1dB | 达标 |
| 声场不均匀度 | ≤8dB | 5.2dB | 达标 |
| 传输频率特性 | 125Hz~4kHz±4dB | ±3.2dB | 达标 |`;

  // Inject simulation after 专业扩声系统
  const lines = text.split('\n');
  let injected = text;
  let injectIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/专业扩声系统/.test(lines[i]) && /^#{3,6}\s/.test(lines[i])) {
      // Find section end (next heading at same or higher level)
      const level = lines[i].match(/^(#+)/)[1].length;
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const m = lines[j].match(/^(#+)\s/);
        if (m && m[1].length <= level) { end = j; break; }
      }
      injectIdx = end;
      break;
    }
  }
  if (injectIdx > 0) {
    lines.splice(injectIdx, 0, '', simChapter, '');
    injected = lines.join('\n');
    console.log(`✅ Simulation injected at line ${injectIdx}`);
  } else {
    injected = text + '\n\n' + simChapter;
    console.log('⚠️ Simulation appended to end (no 专业扩声系统 heading found)');
  }

  // Check for the heading
  const headingCheck = text.match(/^#{3,6}\s+.*专业扩声.*$/gm);
  console.log('专业扩声 headings found:', headingCheck ? headingCheck.join(', ') : 'NONE');

  // Save
  const outDir = fileURLToPath(new URL('./generated_docs', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const ts = Date.now();
  writeFileSync(`${outDir}/${ts}-test-report.md`, injected, 'utf-8');
  console.log(`Report saved: generated_docs/${ts}-test-report.md`);

  // Verify
  console.log('\n=== Verification ===');
  console.log('Has 仿真分析:', /仿真分析/.test(injected) ? '✅' : '❌');
  console.log('Has 图纸素材:', /图纸素材/.test(injected) ? '✅' : '❌');
  console.log('Has 声场指标:', /声场指标说明/.test(injected) ? '✅' : '❌');
  console.log('Has 国标合规:', /国标合规校验/.test(injected) ? '✅' : '❌');
  console.log('仿真在专业扩声之后:', injected.indexOf('仿真分析') > injected.indexOf('专业扩声') ? '✅' : '❌');
  console.log('Total length:', injected.length, 'chars');

} catch (e) {
  console.error('Failed:', e.response?.data || e.message);
}
