#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN=$(command -v python3.8 || true)
if [[ -z "${PYTHON_BIN}" ]]; then
    PYTHON_BIN=$(command -v python3 || true)
fi
LOG_FILE="$PROJECT_ROOT/backend.log"
PID_FILE="$PROJECT_ROOT/backend.pid"

if [[ -z "${PYTHON_BIN}" ]]; then
    echo "未找到可用的 Python 解释器 (python3.8 或 python3)，请先安装后再运行此脚本。" >&2
    exit 1
fi

stop_service() {
    local stopped=0

    if [[ -f "$PID_FILE" ]]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" >/dev/null 2>&1; then
            kill "$pid" >/dev/null 2>&1 || true
            wait "$pid" 2>/dev/null || true
            stopped=1
        fi
        rm -f "$PID_FILE"
    fi

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

install_dependencies() {
    echo "正在安装依赖..."
    if ! $PYTHON_BIN -m pip install --upgrade pip setuptools wheel; then
        echo "警告：pip/setuptools/wheel 升级失败，将继续使用现有版本。" >&2
    fi
    if ! $PYTHON_BIN -m pip install -r "$PROJECT_ROOT/backend/requirements.txt"; then
        echo "警告：项目依赖安装失败，请检查网络或手动安装缺失依赖。" >&2
        local missing_modules
        missing_modules=$($PYTHON_BIN - <<'PY'
import importlib.util
modules = ["flask", "flask_sock", "simple_websocket", "gunicorn", "yaml"]
missing = [m for m in modules if importlib.util.find_spec(m) is None]
print(" ".join(missing))
PY
)
        if [[ -n "${missing_modules// }" ]]; then
            echo "错误：检测到缺失依赖：${missing_modules}。请手动安装后重新运行脚本。" >&2
            exit 1
        fi
    fi
}

start_backend() {
    echo "以后台模式启动服务..."
    rm -f "$PID_FILE"
    mkdir -p "$(dirname "$LOG_FILE")"
    (
        cd "$PROJECT_ROOT"
        nohup "$PYTHON_BIN" -m backend.app >"$LOG_FILE" 2>&1 &
        echo $! >"$PID_FILE"
    )
    local pid
    pid=$(cat "$PID_FILE")
    sleep 1
    if ! ps -p "$pid" >/dev/null 2>&1; then
        echo "后端服务启动失败，请查看日志：$LOG_FILE" >&2
        exit 1
    fi
    echo "后端服务已启动 (PID: $pid)，日志输出至 $LOG_FILE。"
}

# 执行流程
stop_service
kill_port_service
install_dependencies
start_backend
