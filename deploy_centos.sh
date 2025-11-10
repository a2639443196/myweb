#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER_IP="${SERVER_IP:-116.196.117.30}"
SERVER_USER="${SERVER_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/wellness-hub}"
SERVICE_NAME="${SERVICE_NAME:-wellness_hub}"
SSH_OPTS=(${SSH_OPTS:-})

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync 未安装，请先安装 rsync。" >&2
  exit 1
fi

RSYNC_EXCLUDES=(
  "--exclude" ".git"
  "--exclude" "backend/wellness.db"
  "--exclude" "__pycache__"
  "--exclude" "*.pyc"
)

rsync -avz "${RSYNC_EXCLUDES[@]}" "${PROJECT_ROOT}/" "${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/"

ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_IP}" <<EOF_REMOTE
set -euo pipefail

if command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y python3 python3-virtualenv
else
  sudo yum install -y python3 python3-virtualenv
fi

python3.8 -m venv "${REMOTE_DIR}/venv"
source "${REMOTE_DIR}/venv/bin/activate"
pip install --upgrade pip
pip install -r "${REMOTE_DIR}/backend/requirements.txt"

deactivate

sudo tee /etc/systemd/system/${SERVICE_NAME}.service >/dev/null <<'SERVICE'
[Unit]
Description=Wellness Hub Python Service
After=network.target

[Service]
Type=simple
WorkingDirectory=${REMOTE_DIR}
Environment="PATH=${REMOTE_DIR}/venv/bin"
ExecStart=${REMOTE_DIR}/venv/bin/gunicorn -w 2 -b 0.0.0.0:8000 backend.wsgi:app
Restart=on-failure

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable --now ${SERVICE_NAME}.service

if command -v firewall-cmd >/dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-port=8000/tcp || true
  sudo firewall-cmd --reload || true
fi

EOF_REMOTE

cat <<INFO
部署完成！
服务运行在 http://${SERVER_IP}:8000
若需要通过域名或 80 端口访问，可在服务器上配置 Nginx 反向代理。
INFO
