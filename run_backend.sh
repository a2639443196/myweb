#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN=$(command -v python3.8 || true)

if [[ -z "${PYTHON_BIN}" ]]; then
    echo "未找到 python3.8，请先安装后再运行此脚本。" >&2
    exit 1
fi

# 停止旧进程
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

# 释放8000端口
kill_port_service() {
    local port=8000
    echo "检查端口 ${port} ..."
    local pids
    if command -v lsof >/dev/null 2>&1; then
        pids=$(lsof -ti tcp:"${port}" || true)
    elif command -v fuser >/dev/null 2>&1; then
        pids=$(fuser "${port}/tcp" 2>/dev/null || true)
    fi
    if [[ -n "${pids:-}" ]]; then
        echo "端口 ${port} 被占用，正在终止进程：${pids}"
        kill -9 ${pids} >/dev/null 2>&1 || true
        echo "端口 ${port} 已释放。"
    else
        echo "端口 ${port} 空闲。"
    fi
}

# 安装依赖
install_dependencies() {
    echo "正在安装依赖..."
    $PYTHON_BIN -m pip install --upgrade pip setuptools wheel
    $PYTHON_BIN -m pip install -r "$PROJECT_ROOT/backend/requirements.txt"
}

# 启动服务
start_service() {
    echo "正在启动后端服务..."
    cd "$PROJECT_ROOT"
    local log_dir="$PROJECT_ROOT/logs"
    mkdir -p "$log_dir"
    local log_file="$log_dir/backend.log"
    nohup $PYTHON_BIN -m backend.app >>"$log_file" 2>&1 &
    local pid=$!
    if kill -0 "$pid" >/dev/null 2>&1; then
        echo "后端服务已在后台启动 (PID: $pid)，日志输出到 $log_file"
    else
        echo "后端服务启动失败，请检查日志 $log_file" >&2
        exit 1
    fi
}

# 执行流程
stop_service
kill_port_service
install_dependencies
start_service
