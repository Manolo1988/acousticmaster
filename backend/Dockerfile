# ==================== 构建阶段 ====================
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制依赖文件（利用缓存层）
COPY package*.json ./
# 使用淘宝镜像 + npm install（兼容性优于 npm ci）
# PUPPETEER_SKIP_DOWNLOAD=1 跳过 Chromium 下载（仅生产需要 PDF 时才安装）
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm config set registry https://registry.npmmirror.com \
  && npm install --production --no-optional \
  || (npm config set registry https://registry.npmjs.org && npm install --production --no-optional) \
  && npm cache clean --force

# 复制源码并构建（如有TypeScript需编译）
COPY . .
# RUN npm run build  # 如有构建步骤取消注释

# ==================== 生产阶段 ====================
FROM node:20-alpine AS production

# 逆向设计依赖 Python 运行时和科学计算库
# numpy/scipy 从 apk 安装（预编译包，快且可靠），plotly 从 pip 安装（纯 Python）
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.ustc.edu.cn/g' /etc/apk/repositories \
    && apk add --no-cache \
    python3 \
    py3-pip \
    py3-numpy \
    py3-scipy \
    py3-matplotlib \
  && pip3 install --no-cache-dir --break-system-packages \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    --trusted-host pypi.tuna.tsinghua.edu.cn \
    plotly \
  && ln -sf /usr/bin/python3 /usr/bin/python \
  && python3 -c "import numpy, scipy, matplotlib, plotly; print('Python pkgs OK')"

WORKDIR /app

# 从构建阶段复制必要文件
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/server.js ./
COPY --from=builder --chown=node:node /app/daemon_v2.cjs ./
COPY --from=builder --chown=node:node /app/plan_service.js ./
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