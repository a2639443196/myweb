#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="/usr/local/bin/python3.10"

if [[ ! -x "$PYTHON_BIN" ]]; then
    echo "未找到 $PYTHON_BIN，请先安装 Python 3.10。" >&2
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
    $PYTHON_BIN -m pip install --upgrade pip setuptools wheel
    $PYTHON_BIN -m pip install -r "$PROJECT_ROOT/backend/requirements.txt"
}

create_systemd_service() {
    local service_file="/etc/systemd/system/backend.service"
    echo "写入 systemd 服务文件：$service_file"

    cat > "$service_file" <<EOF
[Unit]
Description=Backend Python Service
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_ROOT
ExecStart=$PYTHON_BIN -m backend.app
Restart=always
RestartSec=3
User=root
StandardOutput=append:$PROJECT_ROOT/backend.log
StandardError=append:$PROJECT_ROOT/backend.log

[Install]
WantedBy=multi-user.target
EOF

    echo "加载并启动服务..."
    systemctl daemon-reload
    systemctl enable backend.service
    systemctl restart backend.service
    systemctl status backend.service --no-pager
}

stop_service
kill_port_service
install_dependencies
create_systemd_service
