#!/usr/bin/env bash
set -euo pipefail

DEFAULT_URL="http://192.168.32.154:3000/viewer"
RAW_INSTALLER_URL="https://raw.githubusercontent.com/roadless/nvr_host/main/scripts/install-kiosk-ubuntu.sh"
KIOSK_URL="$DEFAULT_URL"
KIOSK_USER="kiosk"
STATIC_IP=""
GATEWAY=""
DNS=""
INTERFACE=""
BROWSER_FLAGS="--kiosk --start-fullscreen --no-first-run --disable-infobars --disable-session-crashed-bubble --disable-features=Translate --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0 --disable-pinch"

usage() {
  cat <<EOF
Usage:
  sudo bash install-kiosk-ubuntu.sh [options]

Options:
  --url URL             Viewer URL to open. Default: $DEFAULT_URL
  --user USER           Local kiosk user. Default: kiosk
  --static-ip CIDR      Optional static IP, for example 192.168.32.201/24
  --gateway IP          Gateway for static IP mode
  --dns IP              DNS server for static IP mode
  --interface NAME      Network interface for static IP mode, for example ens18
  --help                Show this help

Examples:
  sudo bash install-kiosk-ubuntu.sh --url http://192.168.32.154:3000/viewer

  sudo bash install-kiosk-ubuntu.sh \\
    --url http://192.168.32.154:3000/viewer \\
    --static-ip 192.168.32.201/24 \\
    --gateway 192.168.32.1 \\
    --dns 192.168.32.1 \\
    --interface ens18
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)
      KIOSK_URL="${2:-}"
      shift 2
      ;;
    --user)
      KIOSK_USER="${2:-}"
      shift 2
      ;;
    --static-ip)
      STATIC_IP="${2:-}"
      shift 2
      ;;
    --gateway)
      GATEWAY="${2:-}"
      shift 2
      ;;
    --dns)
      DNS="${2:-}"
      shift 2
      ;;
    --interface)
      INTERFACE="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "This installer must be run as root. Use: sudo bash install-kiosk-ubuntu.sh"
  exit 1
fi

if [ -z "$KIOSK_URL" ] || [ -z "$KIOSK_USER" ]; then
  echo "--url and --user cannot be empty."
  exit 1
fi

STATIC_FIELDS_SET=0
for value in "$STATIC_IP" "$GATEWAY" "$DNS" "$INTERFACE"; do
  if [ -n "$value" ]; then
    STATIC_FIELDS_SET=$((STATIC_FIELDS_SET + 1))
  fi
done

if [ "$STATIC_FIELDS_SET" -ne 0 ] && [ "$STATIC_FIELDS_SET" -ne 4 ]; then
  echo "Static IP mode requires all parameters: --static-ip, --gateway, --dns, --interface"
  exit 1
fi

if [ ! -f /etc/os-release ]; then
  echo "Cannot detect operating system."
  exit 1
fi

. /etc/os-release
if [ "${ID:-}" != "ubuntu" ]; then
  echo "This installer is intended for Ubuntu Desktop. Detected: ${ID:-unknown}"
  exit 1
fi

ARCH="$(dpkg --print-architecture)"
if [ "$ARCH" != "amd64" ]; then
  echo "Google Chrome stable .deb is expected on amd64. Detected architecture: $ARCH"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "Installing base packages..."
apt-get update
apt-get install -y ca-certificates curl dbus-x11 gnupg openbox unclutter x11-xserver-utils

echo "Installing Google Chrome..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --batch --yes --dearmor -o /etc/apt/keyrings/google-linux.gpg
chmod a+r /etc/apt/keyrings/google-linux.gpg
cat >/etc/apt/sources.list.d/google-chrome.list <<EOF
deb [arch=amd64 signed-by=/etc/apt/keyrings/google-linux.gpg] http://dl.google.com/linux/chrome/deb/ stable main
EOF
apt-get update
apt-get install -y google-chrome-stable

echo "Creating kiosk user..."
if ! id "$KIOSK_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$KIOSK_USER"
fi
passwd -d "$KIOSK_USER" >/dev/null 2>&1 || true
gpasswd -d "$KIOSK_USER" sudo >/dev/null 2>&1 || true

USER_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
if [ -z "$USER_HOME" ] || [ ! -d "$USER_HOME" ]; then
  echo "Cannot find home directory for user '$KIOSK_USER'."
  exit 1
fi

echo "Writing kiosk configuration..."
cat >/etc/nvr-kiosk.env <<EOF
KIOSK_URL=$(printf '%q' "$KIOSK_URL")
KIOSK_USER=$(printf '%q' "$KIOSK_USER")
INSTALLER_URL=$(printf '%q' "$RAW_INSTALLER_URL")
BROWSER_FLAGS=$(printf '%q' "$BROWSER_FLAGS")
EOF
chmod 0644 /etc/nvr-kiosk.env

cat >/usr/local/bin/nvr-kiosk-launch <<'EOF'
#!/usr/bin/env bash
set -uo pipefail

if [ -f /etc/nvr-kiosk.env ]; then
  # shellcheck disable=SC1091
  . /etc/nvr-kiosk.env
fi

KIOSK_URL="${KIOSK_URL:-http://192.168.32.154:3000/viewer}"
BROWSER_FLAGS="${BROWSER_FLAGS:---kiosk --start-fullscreen --no-first-run --disable-infobars --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required}"
CHROME_BIN="$(command -v google-chrome-stable || command -v google-chrome || true)"

if [ -z "$CHROME_BIN" ]; then
  echo "Google Chrome is not installed."
  sleep 10
  exit 1
fi

export XDG_CURRENT_DESKTOP=NVRKiosk
export XDG_SESSION_DESKTOP=nvr-kiosk

mkdir -p "$HOME/.config/google-chrome-kiosk"

if command -v xset >/dev/null 2>&1; then
  xset s off >/dev/null 2>&1 || true
  xset s noblank >/dev/null 2>&1 || true
  xset -dpms >/dev/null 2>&1 || true
fi

if command -v openbox >/dev/null 2>&1; then
  openbox >/dev/null 2>&1 &
fi

if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 1 -root >/dev/null 2>&1 &
fi

while true; do
  "$CHROME_BIN" \
    --user-data-dir="$HOME/.config/google-chrome-kiosk" \
    $BROWSER_FLAGS \
    "$KIOSK_URL"
  sleep 3
done
EOF
chmod 0755 /usr/local/bin/nvr-kiosk-launch

cat >/usr/local/bin/nvr-kiosk-set-url <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo "$0" "$@"
fi

NEW_URL="${1:-}"
if [ -z "$NEW_URL" ]; then
  echo "Usage: nvr-kiosk-set-url http://HOST:3000/viewer"
  exit 1
fi

if [ ! -f /etc/nvr-kiosk.env ]; then
  echo "/etc/nvr-kiosk.env not found. Run install-kiosk-ubuntu.sh first."
  exit 1
fi

# shellcheck disable=SC1091
. /etc/nvr-kiosk.env
TMP_FILE="$(mktemp)"
while IFS= read -r line; do
  case "$line" in
    KIOSK_URL=*) printf 'KIOSK_URL=%q\n' "$NEW_URL" ;;
    *) printf '%s\n' "$line" ;;
  esac
done </etc/nvr-kiosk.env >"$TMP_FILE"
install -m 0644 "$TMP_FILE" /etc/nvr-kiosk.env
rm -f "$TMP_FILE"

if [ -n "${KIOSK_USER:-}" ]; then
  pkill -u "$KIOSK_USER" -f google-chrome >/dev/null 2>&1 || true
fi

echo "Kiosk URL updated to: $NEW_URL"
EOF
chmod 0755 /usr/local/bin/nvr-kiosk-set-url

cat >/usr/local/bin/nvr-kiosk-update <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo "$0" "$@"
fi

if [ ! -f /etc/nvr-kiosk.env ]; then
  echo "/etc/nvr-kiosk.env not found. Run install-kiosk-ubuntu.sh first."
  exit 1
fi

# shellcheck disable=SC1091
. /etc/nvr-kiosk.env

TMP_FILE="$(mktemp)"
curl -fsSL "${INSTALLER_URL:-https://raw.githubusercontent.com/roadless/nvr_host/main/scripts/install-kiosk-ubuntu.sh}" -o "$TMP_FILE"
bash "$TMP_FILE" --url "${KIOSK_URL:-http://192.168.32.154:3000/viewer}" --user "${KIOSK_USER:-kiosk}"
rm -f "$TMP_FILE"
EOF
chmod 0755 /usr/local/bin/nvr-kiosk-update

cat >/usr/local/bin/nvr-kiosk-status <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ -f /etc/nvr-kiosk.env ]; then
  # shellcheck disable=SC1091
  . /etc/nvr-kiosk.env
fi

echo "Kiosk URL: ${KIOSK_URL:-not configured}"
echo "Kiosk user: ${KIOSK_USER:-not configured}"
echo "Chrome: $(command -v google-chrome-stable || command -v google-chrome || echo not installed)"
echo "Session file: $(test -f /usr/share/xsessions/nvr-kiosk.desktop && echo installed || echo missing)"
echo "Display manager: $(systemctl is-enabled gdm3 2>/dev/null || echo unknown)"

if [ -n "${KIOSK_USER:-}" ] && id "$KIOSK_USER" >/dev/null 2>&1; then
  echo "Chrome process:"
  pgrep -u "$KIOSK_USER" -af "google-chrome|chrome" || true
fi
EOF
chmod 0755 /usr/local/bin/nvr-kiosk-status

echo "Configuring kiosk desktop session..."
cat >/usr/share/xsessions/nvr-kiosk.desktop <<'EOF'
[Desktop Entry]
Name=NVR Kiosk
Comment=Camera Server kiosk viewer
Exec=/usr/local/bin/nvr-kiosk-launch
Type=Application
DesktopNames=NVRKiosk
EOF

cat >"$USER_HOME/.dmrc" <<'EOF'
[Desktop]
Session=nvr-kiosk
EOF
chown "$KIOSK_USER:$KIOSK_USER" "$USER_HOME/.dmrc"
chmod 0644 "$USER_HOME/.dmrc"

install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$USER_HOME/.config"
runuser -u "$KIOSK_USER" -- dbus-run-session gsettings set org.gnome.desktop.session idle-delay 0 >/dev/null 2>&1 || true
runuser -u "$KIOSK_USER" -- dbus-run-session gsettings set org.gnome.desktop.screensaver lock-enabled false >/dev/null 2>&1 || true
runuser -u "$KIOSK_USER" -- dbus-run-session gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing >/dev/null 2>&1 || true
runuser -u "$KIOSK_USER" -- dbus-run-session gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type nothing >/dev/null 2>&1 || true

echo "Configuring GDM autologin..."
if [ -d /etc/gdm3 ]; then
  if [ -f /etc/gdm3/custom.conf ] && [ ! -f /etc/gdm3/custom.conf.nvr-kiosk.bak ]; then
    cp /etc/gdm3/custom.conf /etc/gdm3/custom.conf.nvr-kiosk.bak
  fi
  cat >/etc/gdm3/custom.conf <<EOF
[daemon]
WaylandEnable=false
AutomaticLoginEnable=True
AutomaticLogin=$KIOSK_USER

[security]

[xdmcp]

[chooser]

[debug]
EOF
  systemctl set-default graphical.target >/dev/null 2>&1 || true
  systemctl enable gdm3 >/dev/null 2>&1 || true
else
  echo "Warning: /etc/gdm3 was not found. Install Ubuntu Desktop with GDM or configure autologin manually."
fi

if [ "$STATIC_FIELDS_SET" -eq 4 ]; then
  echo "Writing static network configuration..."
  cat >/etc/netplan/90-nvr-kiosk.yaml <<EOF
network:
  version: 2
  renderer: NetworkManager
  ethernets:
    $INTERFACE:
      dhcp4: false
      addresses:
        - $STATIC_IP
      routes:
        - to: default
          via: $GATEWAY
      nameservers:
        addresses:
          - $DNS
EOF
  netplan apply
fi

cat <<EOF

Kiosk installation completed.

Viewer URL: $KIOSK_URL
Kiosk user: $KIOSK_USER

Next steps:
1. Reboot this VM: sudo reboot
2. The VM should auto-login and open the viewer in Chrome kiosk mode.
3. Change URL later with: sudo nvr-kiosk-set-url http://HOST:3000/viewer
4. Update kiosk scripts later with: sudo nvr-kiosk-update
5. Check status with: nvr-kiosk-status

EOF
