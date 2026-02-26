<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1r-FK-NFmK52s68Lsbk7JlThOaSFlUfXa

##TodoList



#### 📥 输入
- [ ] 🔹 输入参数后，有一个对话框，可解析品牌要求、音箱类型、音箱数量等要求，并体现在生成的方案中
- [ ] 🔹 主页右侧的对话框，能以更人性化的方式问出所有需要的信息，然后生成方案（类似现有方式，但更灵活）

#### 📤 输出
- [ ] 🔸 Dify 先生成设备方案 list 返回 UI，UI 上用户可进行修改（如删除设备、修改数量），点击右上角“生成正式报告”后，再把当前方案发送给 Dify
- [ ] 🔸 由大模型根据设备、系统、排版要求，动态生成 Markdown 格式的文本（含图片），返回 UI 界面，由 UI 渲染成文档形式

#### 🗄️ 数据整理
- [ ] 🔹 数据库重新整理，避免同一个设备因用途不同多次出现，可在 UI 界面直接进行数据管理
- [ ] 🔹 考虑系统设备的级联情况（如同一型号的线阵列音箱和挂架、某品牌的一套矩阵系统）

#### 📐 方案
- [ ] 🔸 吸顶音箱由于放在头顶，排列方式不同，所以要有自己的方案
- [ ] 🔸 考虑不规则形状（如扇形报告厅的音箱设计），以及座位位置覆盖的方案调整
- [ ] 🔸 方案返回设备列表的同时，返回音箱设备悬挂的位置参数（位置、高度）

#### 🌐 用户访问
- [ ] 🔹 采用后端直接向 Dify 发送请求的方式，而不是维护一个 latest 的状态



## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. use `node server.js` in /frontend to start node service
3. Run the app:
   `npm run dev` in /backend
