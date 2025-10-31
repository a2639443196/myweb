#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PYTHON_BIN=$(command -v python3.8 || true)

if [[ -z "${PYTHON_BIN}" ]]; then
    echo "未找到 python3.8，请先安装后再运行此脚本。" >&2
    exit 1
fi

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

kill_port_service() {
    local port=8000
    local killed=0

    if command -v fuser >/dev/null 2>&1; then
        if fuser -k "${port}/tcp" >/dev/null 2>&1; then
            killed=1
        fi
    elif command -v lsof >/dev/null 2>&1; then
        local pids
        if pids=$(lsof -ti tcp:"${port}" 2>/dev/null) && [[ -n "${pids}" ]]; then
            kill ${pids} >/dev/null 2>&1 || true
            killed=1
        fi
    fi

    if [[ ${killed} -eq 1 ]]; then
        echo "已释放端口 ${port}。"
    else
        echo "端口 ${port} 无占用或未找到终止工具。"
    fi
}

install_dependencies() {
    echo "正在安装依赖..."
    $PYTHON_BIN -m pip install --upgrade pip setuptools wheel
    $PYTHON_BIN -m pip install -r "$PROJECT_ROOT/backend/requirements.txt"
}

start_service() {
    echo "正在启动后端服务..."
    cd "$PROJECT_ROOT"
    exec $PYTHON_BIN -m backend.app
}

stop_service
kill_port_service
install_dependencies
start_service
