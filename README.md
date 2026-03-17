# 分支添加功能：AI 引擎增强版 (Feature/AI-Daemon) 启动指南

本项目在原有架构基础上引入了 **AI 守护进程 (Daemon)** 模式，实现了 AI 引擎的一键启停控制与流式对话功能。

## 1. 核心功能

- **AI 系统管理**：通过 UI 按钮直接控制 AI 后端进程（运行在 3003 端口）的开启与关闭。
- **健康监控**：Daemon 守护进程（4000 端口）实时监控 AI 状态，确保服务的高可用。
- **流式对话**：支持 AI 助手的实时响应，界面交互更流畅。
- **统一路由**：无论在开发环境还是 Docker 部署，均通过统一的 `/api/system` 和 `/api/chat-assistant` 接口访问。

---

## 2. 环境准备

确保您的运行环境中已具备：

- **Node.js**: v18+
- **Docker & Docker Compose** (用于生产部署)
- **Ollama**: (可选) 如果使用本地 LLM，请确保 Ollama 服务已启动且模型（如 `qwen2.5:7b`）已拉取。

---

## 3. 启动方法 (开发模式)

推荐使用 Vite 开发服务器配合本地 Backend，以便实时调试代码。

### 第一步：启动 AI 守护进程

在 `backend` 目录下通过 Node 启动守护进程：

```bash
cd backend
node daemon_v2.cjs
```

> _注：守护进程将监听 **4000** 端口。它负责在您点击 UI 按钮时启动 3003 端口的 AI 后端。_

### 第二步：启动前端 (Vite)

在 `frontend` 目录下运行：

```bash
cd frontend
npm run dev
```

> _访问地址：[http://115.231.236.153:8101](http://115.231.236.153:8101)_

---

## 4. 启动方法 (Docker 生产部署)

该模式下，Nginx 会自动处理所有服务的路由转发。

### 一键启动

前端更新：
```bash
cd frontend
npm run build
```
然后运行 deploy_fronted.sh

后端更新：
```bash
cd docker
docker-compose up -d --build
```

> _访问地址：[http://115.231.236.153:8100](http://115.231.236.153:8100)_

### 服务说明

- **8100 端口**：外部统一入口 (Nginx)。
- **ai-daemon 服务**：容器内运行，负责管理 AI 业务生命周期。

---

## 5. 架构说明 (端口关系)

| 服务         | 端口      | 说明                              |
| :----------- | :-------- | :-------------------------------- |
| Frontend Dev | 8101      | Vite 开发服务器                   |
| Nginx Prod   | 8100      | Docker 生产入口                   |
| AI Daemon    | 4000      | 控制中心（查询状态、启停 AI）     |
| AI Backend   | 3003      | AI 核心逻辑（被 Daemon 动态管理） |
| Main API     | 3002/3001 | 基础业务 API                      |

---

## 6. 常见问题

- **端口冲突**：若提示 8101 被占用，请执行 `fuser -k 8101/tcp`。
- **AI 无法点击**：请检查 `backend/daemon_v2.cjs` 是否已启动，且 `PROJECT_ROOT` 路径配置正确。
