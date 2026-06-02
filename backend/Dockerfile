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

# 逆向设计依赖 Python 运行时和科学计算库
RUN apk add --no-cache \
    python3 \
    py3-pip \
    py3-numpy \
    py3-scipy \
    py3-matplotlib \
  && pip3 install --no-cache-dir --break-system-packages plotly

WORKDIR /app

# 从构建阶段复制必要文件
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/server.js ./
COPY --from=builder --chown=node:node /app/daemon_v2.cjs ./
COPY --from=builder --chown=node:node /app/plan_service.js ./
COPY --from=builder --chown=node:node /app/static_blocks ./static_blocks
COPY --from=builder --chown=node:node /app/大模型方案生成指导模板.md ./大模型方案生成指导模板.md

# 运行时会写入生成文档，提前创建并赋予 node 写权限
RUN mkdir -p /app/generated_docs && chown -R node:node /app/generated_docs

# 切换到非root用户
USER node

# 暴露端口
EXPOSE 3001 3003 4000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# 启动命令
CMD ["node", "server.js"]