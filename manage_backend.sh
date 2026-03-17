#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$SCRIPT_DIR}"
SERVER_PATTERN="node .*backend/server\\.js"

# 配置
PORT=3003
MODEL="qwen2.5:7b"
URL="http://127.0.0.1:11434/v1/chat/completions"
LOG_FILE="$PROJECT_ROOT/server_3003.log"

start() {
    echo "🚀 正在启动声学 AI 后端服务 (端口: $PORT, 模型: $MODEL)..."
    # 先清理旧进程
    pkill -f "$SERVER_PATTERN" || true
    
    # 后台启动
    cd "$PROJECT_ROOT" || exit 1
    PORT=$PORT \
    LOCAL_LLM_MODEL=$MODEL \
    LOCAL_LLM_URL=$URL \
    OLLAMA_KEEP_ALIVE=-1 \
    nohup node "$PROJECT_ROOT/backend/server.js" > "$LOG_FILE" 2>&1 &
    
    echo "✅ 服务已在后台运行。"
    echo "📂 日志文件: $LOG_FILE"
    echo "💡 提示: 模型已设置为驻留显存 (-1)，响应速度极快。"
}

stop() {
    echo "🛑 正在关闭声学 AI 后端服务..."
    pkill -f "$SERVER_PATTERN"
    echo "✅ 服务已停止。"
}

status() {
    PID=$(pgrep -f "$SERVER_PATTERN" | head -n 1)
    if [ -z "$PID" ]; then
        echo "❌ 服务当前状态: 已停止"
    else
        echo "🟢 服务当前状态: 正在运行 (PID: $PID)"
        echo "📍 监听端口: $PORT"
    fi
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        sleep 1
        start
        ;;
    status)
        status
        ;;
    *)
        echo "用法: $0 {start|stop|restart|status}"
        exit 1
esac
