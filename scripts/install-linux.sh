#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO_URL="https://github.com/roadless/nvr_host.git"
REPO_URL="${1:-${REPO_URL:-$DEFAULT_REPO_URL}}"
APP_DIR="${APP_DIR:-/opt/nvr_host}"

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required."
  exit 1
fi

if [ ! -f /etc/os-release ]; then
  echo "Cannot detect Linux distribution."
  exit 1
fi

. /etc/os-release
DISTRO_ID="${ID:-}"
CODENAME="${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"

case "$DISTRO_ID" in
  ubuntu|debian) ;;
  *)
    echo "This installer supports Ubuntu/Debian. Detected: ${DISTRO_ID:-unknown}"
    exit 1
    ;;
esac

if [ -z "$CODENAME" ]; then
  echo "Cannot detect apt codename."
  exit 1
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl git

if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL "https://download.docker.com/linux/$DISTRO_ID/gpg" -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$DISTRO_ID $CODENAME stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER:$USER" "$APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  if [ -d "$APP_DIR" ] && [ -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    echo "$APP_DIR exists but is not a git repository. Move or remove it before installing."
    exit 1
  fi
  git clone "$REPO_URL" "$APP_DIR"
fi

sudo install -m 0755 "$APP_DIR/scripts/deploy.sh" /usr/local/bin/nvr-update
sudo usermod -aG docker "$USER" || true

APP_DIR="$APP_DIR" COMPOSE="sudo docker compose" SKIP_PULL=1 bash "$APP_DIR/scripts/deploy.sh"

cat <<EOF

Install completed.

Next steps:
1. Edit $APP_DIR/.env and set ADMIN_PASSWORD.
2. Edit $APP_DIR/data/cameras.yaml and set real RTSP URLs.
3. Run: nvr-update
4. Open: http://HOST_IP:3000/viewer

Docker group membership was updated for user '$USER'. Log out and back in before using docker without sudo.
EOF
