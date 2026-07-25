#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${ISP_REPO_URL:-https://github.com/ArchieCDumayag/ISP.git}"
BRANCH="${ISP_BRANCH:-main}"
APP_DIR="${ISP_APP_DIR:-/opt/isp-billing}"
SERVICE_NAME="${ISP_SERVICE_NAME:-isp-billing}"
APP_USER="${ISP_USER:-ispbilling}"
ENV_DIR="${ISP_ENV_DIR:-/etc/isp-billing}"
ENV_FILE="${ENV_DIR}/isp.env"

usage() {
  cat <<'USAGE'
Ubuntu one-line installer for ArchieCDumayag/ISP.

Optional environment variables:
  ISP_REPO_URL       Git repository URL. Default: https://github.com/ArchieCDumayag/ISP.git
  ISP_BRANCH         Git branch to install. Default: main
  ISP_APP_DIR        Install directory. Default: /opt/isp-billing
  ISP_SERVICE_NAME   systemd service name. Default: isp-billing
  ISP_USER           Linux service user. Default: ispbilling
  PORT               App port. Default: 3000
  PUBLIC_BASE_URL    Public URL. Default: http://SERVER_IP:PORT

Example:
  curl -fsSL https://raw.githubusercontent.com/ArchieCDumayag/ISP/main/scripts/install-ubuntu.sh | sudo bash
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "[error] Run this installer as root, for example: curl -fsSL <url> | sudo bash" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

log() {
  echo "[isp-install] $*"
}

read_env_value() {
  local key="$1"
  if [[ ! -f "${ENV_FILE}" ]]; then
    return 0
  fi
  grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 | cut -d= -f2- || true
}

run_as_app() {
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "${APP_USER}" -- "$@"
  else
    sudo -u "${APP_USER}" "$@"
  fi
}

detect_public_host() {
  hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | head -n 1 || true
}

random_hex() {
  node -e "process.stdout.write(require('crypto').randomBytes(Number(process.argv[1] || 32)).toString('hex'))" "$1"
}

install_node_if_needed() {
  local major="0"
  if command -v node >/dev/null 2>&1; then
    major="$(node -p "Number(process.versions.node.split('.')[0]) || 0" 2>/dev/null || echo 0)"
  fi

  if [[ "${major}" -ge 20 ]]; then
    log "Node.js $(node -v) already installed."
    return
  fi

  log "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
}

install_chromium_runtime_deps() {
  local packages=(
    fonts-liberation
    libatk-bridge2.0-0
    libatk1.0-0
    libcairo2
    libcups2
    libdbus-1-3
    libdrm2
    libexpat1
    libgbm1
    libglib2.0-0
    libgtk-3-0
    libnspr4
    libnss3
    libpango-1.0-0
    libx11-6
    libxcb1
    libxcomposite1
    libxdamage1
    libxext6
    libxfixes3
    libxkbcommon0
    libxrandr2
    xdg-utils
  )

  if apt-cache show libasound2t64 >/dev/null 2>&1; then
    packages+=(libasound2t64)
  else
    packages+=(libasound2)
  fi

  log "Installing browser runtime packages for PDF/statement rendering..."
  apt-get install -y "${packages[@]}"
}

log "Updating apt metadata..."
apt-get update
apt-get install -y ca-certificates curl git gnupg build-essential
install_node_if_needed
install_chromium_runtime_deps

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  log "Creating service user: ${APP_USER}"
  useradd --system --create-home --home-dir "/var/lib/${SERVICE_NAME}" --shell /usr/sbin/nologin "${APP_USER}"
fi

install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}"
install -d -o "${APP_USER}" -g "${APP_USER}" "/var/lib/${SERVICE_NAME}"

if [[ -d "${APP_DIR}/.git" ]]; then
  log "Updating existing checkout in ${APP_DIR}..."
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
  run_as_app git -C "${APP_DIR}" fetch origin "${BRANCH}"
  run_as_app git -C "${APP_DIR}" checkout "${BRANCH}"
  run_as_app git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
else
  if [[ -n "$(find "${APP_DIR}" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    echo "[error] ${APP_DIR} exists but is not a Git checkout. Move it or set ISP_APP_DIR." >&2
    exit 1
  fi
  log "Cloning ${REPO_URL} (${BRANCH}) into ${APP_DIR}..."
  run_as_app git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
fi

log "Installing Node.js dependencies..."
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
if [[ -f "${APP_DIR}/package-lock.json" ]]; then
  run_as_app env HOME="/var/lib/${SERVICE_NAME}" npm --prefix "${APP_DIR}" ci --omit=dev
else
  run_as_app env HOME="/var/lib/${SERVICE_NAME}" npm --prefix "${APP_DIR}" install --omit=dev
fi

install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}/data" "${APP_DIR}/logs" "${APP_DIR}/.tmp" "${APP_DIR}/public/uploads"

install -d -m 0750 "${ENV_DIR}"
EXISTING_PORT="$(read_env_value PORT)"
EXISTING_PUBLIC_BASE_URL="$(read_env_value PUBLIC_BASE_URL)"
EXISTING_SESSION_SECRET="$(read_env_value SESSION_TOKEN_SECRET)"
EXISTING_MASTER_KEY="$(read_env_value CONFIG_MASTER_KEY)"

PORT="${PORT:-${EXISTING_PORT:-3000}}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-${EXISTING_PUBLIC_BASE_URL:-}}"
if [[ -z "${PUBLIC_BASE_URL}" ]]; then
  DETECTED_HOST="$(detect_public_host)"
  PUBLIC_BASE_URL="http://${DETECTED_HOST:-localhost}:${PORT}"
fi
SESSION_TOKEN_SECRET="${SESSION_TOKEN_SECRET:-${EXISTING_SESSION_SECRET:-$(random_hex 32)}}"
CONFIG_MASTER_KEY="${CONFIG_MASTER_KEY:-${EXISTING_MASTER_KEY:-$(random_hex 32)}}"

log "Writing environment file: ${ENV_FILE}"
cat > "${ENV_FILE}" <<EOF
NODE_ENV=production
TZ=Asia/Manila
PORT=${PORT}
STORAGE_DRIVER=json
SESSION_TOKEN_SECRET=${SESSION_TOKEN_SECRET}
CONFIG_MASTER_KEY=${CONFIG_MASTER_KEY}
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
APP_BASE_URL=${PUBLIC_BASE_URL}
CENTRAL_URL=${PUBLIC_BASE_URL}
INITIAL_ADMIN_USERNAME=archiecd
INITIAL_ADMIN_PASSWORD=finley123!
INITIAL_BRANCH_NAME=DANTE-FIBER
STRUCTURE_OWNER_ID=1
ENABLE_CUSTOMER_UPSTREAM_STUB=true
DISABLE_CLOUDFLARED=1
EOF
chmod 0640 "${ENV_FILE}"

log "Creating systemd service: ${SERVICE_NAME}"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=ISP Billing System
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=HOME=/var/lib/${SERVICE_NAME}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}" "/var/lib/${SERVICE_NAME}"

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"

if command -v ufw >/dev/null 2>&1 && ufw status | grep -qi 'Status: active'; then
  log "UFW is active; allowing TCP port ${PORT}."
  ufw allow "${PORT}/tcp"
fi

log "Installation complete."
echo
echo "URL: ${PUBLIC_BASE_URL}/login.html"
echo "Service: sudo systemctl status ${SERVICE_NAME} --no-pager"
echo "Logs: sudo journalctl -u ${SERVICE_NAME} -f"
echo "Environment: ${ENV_FILE}"
echo
echo "Default admins:"
echo "  Primary: archiecd / finley123!"
echo "  Backup:  admin / admin"
echo "Change default passwords immediately after first login."
