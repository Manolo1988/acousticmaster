# AcousticMaster — 声学设备方案设计系统

AI-driven acoustic system design platform. Users input room parameters, the system generates equipment plans (speakers, amplifiers, etc.) via LLM, supports real-time editing, report generation, and inventory management.

## Project

- **Stack**: React 19 + TypeScript (Vite) frontend · Node.js/Express 5 backend · MySQL · Python scripting · Docker Compose + Nginx
- **Frontend entry**: `frontend/index.tsx` → `frontend/App.tsx`
- **Backend entry**: `backend/server.js` (main API, ports 3001-3003)
- **AI Daemon**: `backend/daemon_v2.cjs` (port 4000, manages AI backend lifecycle)
- **DB schema**: `backend/schema.sql` (users, design_history)

## Commands

| Context | Command | Notes |
|---------|---------|-------|
| Frontend dev | `cd frontend && npm run dev` | Vite on port 8101 |
| Frontend build | `cd frontend && npm run build` | Outputs to `frontend/dist/` |
| Backend run | `node backend/server.js` | Main API server |
| AI Daemon | `node backend/daemon_v2.cjs` | Port 4000, manages port-3003 AI backend |
| Legacy daemon | `node daemon_manager.mjs` | Older AI manager (port 4000) |
| Backend mgmt | `./manage_backend.sh {start\|stop\|restart\|status}` | Launches server.js on port 3003 |
| Deploy frontend | `./deploy_frontend.sh` | Copies `frontend/dist/` → `docker/nginx/html/` |
| Docker up | `cd docker && docker-compose up -d --build` | Builds + starts all services |
| No test command | Backend package.json has no test script | Frontend has no test script either |

## Architecture

- **`frontend/App.tsx`** — single-page app; renders all UI (chat, equipment tables, report, visualization). Inline CSS + Tailwind CDN.
- **`frontend/hooks/useAcousticLogic.ts`** (~127k) — monolithic hook managing all state: auth, chat, inventory CRUD, report generation, blueprint. Handles all API calls.
- **`frontend/components/Visualization.tsx`** — SVG room-layout renderer based on `AcousticParams` + equipment items.
- **`frontend/types.ts`** — TypeScript enums/interfaces (Scenario, EquipmentItem, SolutionResult, etc.).
- **`backend/server.js`** (~150k) — Express server with all REST endpoints: auth, inventory CRUD, design/history, Dify integration, file upload, report generation.
- **`backend/plan_service.js`** — plan generation via Ark (火山引擎) API; static-block management (markdown templates).
- **`backend/daemon_v2.cjs`** — spawns/manages AI backend as subprocess; exposes `/api/system/ai-status`, `/api/system/ai-toggle`. CommonJS.
- **`backend/post_processor.py`** — Python post-processor: TOC generation, placeholder injection from `backend/static_blocks/`.
- **`backend/plan_llm_tester.py`** — iterative tester for LLM plan generation with gap analysis.
- **`backend/static_blocks/`** — reusable markdown fragments (standards_table.md, formulas_block.md, mermaid diagrams).
- **`docker/`** — Docker Compose: `acoustic-api` (server.js), `ai-daemon` (daemon_v2.cjs), `acoustic-nginx` (reverse proxy on port 8100).

## Services & Ports

| Service | Port | Description |
|---------|------|-------------|
| Vite dev server | 8101 | Frontend hot-reload |
| Nginx (prod) | 8100 | External entry, routes `/api/*` |
| AI Daemon | 4000 | Queries/starts/stops AI backend |
| AI Backend | 3003 | AI plan generation (managed by daemon) |
| Main API | 3001-3002 | Inventory, auth, history endpoints |

## Conventions

- **Language**: Chinese UI + comments; English code identifiers. Keep it consistent.
- **Modules**: Backend uses ES modules (`import`/`export`) except `daemon_v2.cjs` (CommonJS). Frontend is ESM.
- **Frontend patterns**: React functional components + hooks. `useAcousticLogic` is the single source of truth for all state.
- **API style**: RESTful JSON. All endpoints live in `server.js`. CORS is fully open (`return callback(null, true)`).
- **Error handling**: `try-catch` with `res.status(500).json({ error: message })`. Backend logs via `console.log`.
- **Database**: MySQL via `mysql2/promise` connection pool. Table names are Chinese strings.
- **Python**: Type-hinted, uses `from __future__ import annotations`, `pathlib.Path`.
- **Config**: `.env` files in `backend/`, `frontend/` (`.env.development`, `.env.production`). Docker env vars override in `docker/docker-compose.yml`.
- **Static blocks**: Markdown files in `backend/static_blocks/` indexed by `index.json`. Injected into LLM output via `{{INSERT:BLOCK_KEY}}` placeholders.

## Notes

<!-- Quick-add section for future context -->
