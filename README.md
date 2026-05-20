# Acoustic Master

声学方案设计系统，包含前端设计看板、Node.js 后端接口、数据库设备清单读取，以及逆向设计方案生成/三维声场结果展示。

## 目录结构

```text
.
├── backend/                 # Node.js 后端接口
├── frontend/                # React + Vite 前端
├── sim/                     # Python 声学逆向设计与仿真模块
├── docker/                  # Docker/Nginx 部署相关文件
├── package.json             # 根目录少量共享依赖
└── README.md
```

## 环境要求

- Node.js 18 或更高版本
- npm
- Python 3.10 或更高版本，推荐使用 conda 环境 `sound`
- MySQL 数据库，当前系统按远程数据库连接方式运行
- 可选：Docker 与 Docker Compose，用于生产部署

推荐 Python 环境：

```bash
conda activate sound
```

如果没有该环境，可自行创建：

```bash
conda create -n sound python=3.11 -y
conda activate sound
```

## 配置后端环境变量

后端会读取 `backend/.env`。第一次运行时，从示例文件复制：

```bash
cd backend
cp .env.example .env
```

然后编辑 `backend/.env`，至少确认以下配置：

```env
DB_HOST=数据库地址
DB_PORT=3306
DB_USER=数据库用户名
DB_PASSWORD=数据库密码
DB_NAME=数据库名

ARK_API_KEY=你的大模型 API Key
ARK_MODEL=doubao-seed-2-0-pro-260215
ARK_API_URL=https://ark.cn-beijing.volces.com/api/v3/responses
```

注意：

- 不要把真实的 `backend/.env` 提交到 Git。
- 如果只验证页面和逆向设计展示，数据库连接仍需要可用，否则设备清单、声学参数查询会失败。
- 后端默认端口是 `3001`，直接运行 `node server.js` 即可；如需改端口可通过 `PORT` 指定。

## 安装依赖

在项目根目录执行：

```bash
cd /home/zhao/Codes/proj/acousticmaster_simimulation/acousticmaster
```

安装后端依赖：

```bash
cd backend
npm ci
```

安装前端依赖：

```bash
cd ../frontend
npm ci
```

安装 Python 仿真依赖：

```bash
cd ../sim
conda activate sound
pip install -r requirements.txt
```

如果运行逆向设计时提示缺少 `scipy`，请补充安装：

```bash
pip install scipy
```

## 开发环境运行

建议开两个终端。

### 1. 启动后端

```bash
cd /home/zhao/Codes/proj/acousticmaster_simimulation/acousticmaster/backend
node server.js
```

启动成功后应看到类似：

```text
Server running on http://0.0.0.0:3001
```

### 2. 启动前端

```bash
cd /home/zhao/Codes/proj/acousticmaster_simimulation/acousticmaster/frontend
npm run dev -- --host 0.0.0.0 --port 8101
```

访问：

```text
http://localhost:8101/
```

当前 `frontend/.env.development` 中开发代理指向：

```env
VITE_DEV_API_TARGET=http://127.0.0.1:3001
VITE_DEV_AI_CHAT_TARGET=http://127.0.0.1:3001
VITE_DEV_AI_SYSTEM_TARGET=http://127.0.0.1:3001
```

因此后端建议固定运行在 `3001`。

## 一行命令后台运行

如需像当前开发机一样后台启动：

```bash
cd /home/zhao/Codes/proj/acousticmaster_simimulation/acousticmaster

setsid bash -c 'cd backend && PORT=3001 NODE_ENV=development exec node server.js >> ../server_3001.log 2>&1' < /dev/null &
setsid bash -c 'cd frontend && exec npm run dev -- --host 0.0.0.0 --port 8101 >> ../frontend_8101.log 2>&1' < /dev/null &
```

查看端口：

```bash
ss -ltnp | grep -E ':3001|:8101'
```

停止服务：

```bash
fuser -k 3001/tcp
fuser -k 8101/tcp
```

## 逆向设计方案生成

前端“方案明细”旁边有“逆向设计方案生成”标签页。点击进入后：

1. 页面会读取当前方案的房间尺寸。
2. 从设备列表中筛选音箱类设备。
3. 后端按型号到数据库查询声学参数；查不到时使用估算参数。
4. Python `sim` 模块根据固定型号和数量做逆向布局优化。
5. 返回三维声场、音箱位置、SPL 指标和国标对比。

相关文件：

```text
frontend/components/AcousticSimulationDemo.tsx
frontend/utils/simulationSpeaker.ts
backend/server.js
sim/run_simulation.py
sim/webapp/server.py
sim/opt/optimizer.py
```

约束说明：

- 不做设备选型，只使用方案清单里的音箱型号和数量。
- 同型号音箱优先对称布置。
- 奇数数量时，多出的一只放在对称中线上。
- 吸顶音响指向固定为竖直向下。
- 当前逆向优化最多迭代 20 步。

## 单独运行 sim 模块

如果只想验证 Python 仿真模块：

```bash
cd /home/zhao/Codes/proj/acousticmaster_simimulation/acousticmaster/sim
conda activate sound
pip install -r requirements.txt
python webapp/server.py
```

访问：

```text
http://127.0.0.1:8080/simulation.html
```

## 构建前端

```bash
cd frontend
npm run build
```

构建产物在 `frontend/dist/`，该目录不提交到 Git。

## Docker 部署参考

```bash
cd frontend
npm ci
npm run build

cd ../docker
docker compose up -d --build
```

Docker/Nginx 入口通常是 `8100`，具体以 `docker/docker-compose.yml` 和 Nginx 配置为准。

## 常见问题

### 1. 前端能打开，但接口失败

检查后端是否在 `3001`：

```bash
ss -ltnp | grep 3001
```

检查 `frontend/.env.development` 的代理地址是否仍指向 `http://127.0.0.1:3001`。

### 2. 后端启动后数据库报错

检查 `backend/.env` 中的数据库地址、用户名、密码和库名是否正确。当前系统依赖远程数据库，不需要本地部署 MySQL，但远程数据库必须可连接。

### 3. 逆向设计一直失败或超时

检查：

- Python 环境是否为 `sound`
- 是否安装了 `numpy`、`scipy`、`plotly`
- 后端是否能调用 `/sim/run_simulation.py`
- 当前方案中是否有音箱设备
- 数据库是否能查到对应型号的声学参数

### 4. 端口被占用

```bash
fuser -k 3001/tcp
fuser -k 8101/tcp
```

### 5. 不要提交的文件

以下内容已在 `.gitignore` 中忽略：

```text
node_modules/
dist/
build/
.next/
*.log
backend/.env
dataset/*.sql
__pycache__/
*.pyc
```
