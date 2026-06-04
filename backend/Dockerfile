# ==================== 构建阶段 ====================
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制依赖文件（利用缓存层）
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# 复制源码并构建（如有TypeScript需编译）
COPY . .
# RUN npm run build  # 如有构建步骤取消注释

# ==================== 生产阶段 ====================
FROM node:20-alpine AS production

# 安全：使用非root用户运行
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# 从构建阶段复制必要文件
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./
COPY --from=builder --chown=nodejs:nodejs /app/server.js ./
COPY --from=builder --chown=nodejs:nodejs /app/daemon_v2.cjs ./
COPY --from=builder --chown=nodejs:nodejs /app/plan_service.js ./
COPY --from=builder --chown=nodejs:nodejs /app/static_blocks ./static_blocks
COPY --from=builder --chown=nodejs:nodejs /app/大模型方案生成指导模板.md ./大模型方案生成指导模板.md

# 运行时会写入生成文档和 LLM 轨迹日志，提前创建并赋予 nodejs 写权限
RUN mkdir -p /app/generated_docs /app/llm_traces && chown nodejs:nodejs /app/generated_docs /app/llm_traces

# 切换到非root用户
USER nodejs

# 暴露端口
EXPOSE 3001 3003 4000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# 启动命令
CMD ["node", "server.js"]