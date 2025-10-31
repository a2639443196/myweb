#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

stop_service() {
    local stopped=0

    if pkill -f "python[0-9.]* -m backend.app" >/dev/null 2>&1; then
        stopped=1
    fi

    if pkill -f "python[0-9.]* .*backend/app.py" >/dev/null 2>&1; then
        stopped=1
    fi

    if [[ $stopped -eq 1 ]]; then
        echo "已停止正在运行的后端服务。"
    else
        echo "未检测到正在运行的后端服务。"
    fi
}

install_dependencies() {
    echo "正在安装依赖..."
    python3 -m pip install --upgrade pip
    python3 -m pip install -r "$PROJECT_ROOT/backend/requirements.txt"
}

start_service() {
    echo "正在启动后端服务..."
    cd "$PROJECT_ROOT"
    exec python3 -m backend.app
}

stop_service
install_dependencies
start_service
