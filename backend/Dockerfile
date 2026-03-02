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

# 切换到非root用户
USER nodejs

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# 启动命令
CMD ["node", "server.js"]