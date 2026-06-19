#!/usr/bin/env python3
"""
Windows GUI for installing and managing Ubuntu NVR kiosk clients over SSH.

Requirements:
  python -m pip install -r tools\requirements-kiosk-manager.txt
"""

from __future__ import annotations

import shlex
import socket
import threading
import tkinter as tk
from dataclasses import dataclass
from tkinter import messagebox, ttk

try:
    import paramiko
except ImportError:  # pragma: no cover - shown in GUI at runtime
    paramiko = None


APP_NAME = "NVR Kiosk Client Manager"
APP_VERSION = "1.0.4"
DEFAULT_CLIENT_IP = "192.168.1.92"
DEFAULT_SSH_USER = "cam"
DEFAULT_VIEWER_URL = "http://192.168.1.91:3000/viewer"
REMOTE_SCRIPT = "/tmp/nvr-kiosk-manager.sh"


REMOTE_BASH = r"""#!/usr/bin/env bash
set -euo pipefail

BROWSER_FLAGS="--kiosk --start-fullscreen --no-first-run --disable-infobars --disable-session-crashed-bubble --disable-features=Translate --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0 --disable-pinch"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_ubuntu() {
  [ -f /etc/os-release ] || die "Cannot detect operating system."
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] || die "This installer is intended for Ubuntu. Detected: ${ID:-unknown}"
  [ "$(dpkg --print-architecture)" = "amd64" ] || die "Google Chrome stable requires amd64."
}

detect_interface() {
  local iface="${1:-}"
  if [ -n "$iface" ]; then
    printf "%s" "$iface"
    return 0
  fi
  iface="$(ip route show default 2>/dev/null | awk '{print $5; exit}')"
  [ -n "$iface" ] || die "Cannot detect default network interface. Enter interface manually."
  printf "%s" "$iface"
}

install_chrome_repo() {
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --batch --yes --dearmor -o /etc/apt/keyrings/google-linux.gpg
  chmod a+r /etc/apt/keyrings/google-linux.gpg
  cat >/etc/apt/sources.list.d/google-chrome.list <<'EOF'
deb [arch=amd64 signed-by=/etc/apt/keyrings/google-linux.gpg] http://dl.google.com/linux/chrome/deb/ stable main
EOF
}

detect_display_manager() {
  local default_dm=""
  if [ -f /etc/X11/default-display-manager ]; then
    default_dm="$(cat /etc/X11/default-display-manager 2>/dev/null || true)"
  fi

  case "$default_dm" in
    *lightdm*) echo "lightdm"; return 0 ;;
    *gdm3*) echo "gdm3"; return 0 ;;
  esac

  if command -v lightdm >/dev/null 2>&1 || [ -d /etc/lightdm ]; then
    echo "lightdm"
    return 0
  fi

  if command -v gdm3 >/dev/null 2>&1 || [ -d /etc/gdm3 ]; then
    echo "gdm3"
    return 0
  fi

  echo "none"
}

configure_gdm() {
  local kiosk_user="$1"

  echo "Configuring GDM autologin..."
  [ -d /etc/gdm3 ] || die "/etc/gdm3 was not found."
  if [ -f /etc/gdm3/custom.conf ] && [ ! -f /etc/gdm3/custom.conf.nvr-kiosk.bak ]; then
    cp /etc/gdm3/custom.conf /etc/gdm3/custom.conf.nvr-kiosk.bak
  fi
  cat >/etc/gdm3/custom.conf <<EOF
[daemon]
WaylandEnable=false
AutomaticLoginEnable=True
AutomaticLogin=$kiosk_user

[security]

[xdmcp]

[chooser]

[debug]
EOF
  systemctl set-default graphical.target >/dev/null 2>&1 || true
  systemctl enable gdm3 >/dev/null 2>&1 || true
}

configure_lightdm() {
  local kiosk_user="$1"

  echo "Configuring LightDM autologin..."
  install -d -m 0755 /etc/lightdm/lightdm.conf.d
  if [ -f /etc/lightdm/lightdm.conf ] && [ ! -f /etc/lightdm/lightdm.conf.nvr-kiosk.bak ]; then
    cp /etc/lightdm/lightdm.conf /etc/lightdm/lightdm.conf.nvr-kiosk.bak
  fi
  if [ -f /etc/lightdm/lightdm.conf.d/50-nvr-kiosk.conf ] && [ ! -f /etc/lightdm/lightdm.conf.d/50-nvr-kiosk.conf.bak ]; then
    cp /etc/lightdm/lightdm.conf.d/50-nvr-kiosk.conf /etc/lightdm/lightdm.conf.d/50-nvr-kiosk.conf.bak
  fi
  cat >/etc/lightdm/lightdm.conf.d/50-nvr-kiosk.conf <<EOF
[Seat:*]
autologin-user=$kiosk_user
autologin-user-timeout=0
user-session=nvr-kiosk
EOF
  systemctl set-default graphical.target >/dev/null 2>&1 || true
  systemctl enable lightdm >/dev/null 2>&1 || true
}

configure_display_manager() {
  local kiosk_user="$1"
  local display_manager
  display_manager="$(detect_display_manager)"

  if [ "$display_manager" = "lightdm" ]; then
    configure_lightdm "$kiosk_user"
    return 0
  fi

  if [ "$display_manager" = "gdm3" ]; then
    configure_gdm "$kiosk_user"
    return 0
  fi

  echo "No supported display manager found. Installing lightweight Xorg + LightDM..."
  apt-get install -y xorg lightdm
  configure_lightdm "$kiosk_user"
}

has_turbovnc() {
  local user_home="$1"

  [ -x /opt/TurboVNC/bin/vncserver ] && return 0
  pgrep -af "Xvnc|TurboVNC" >/dev/null 2>&1 && return 0
  [ -d "$user_home/.vnc" ] && return 0
  return 1
}

configure_turbovnc() {
  local kiosk_url="$1"
  local kiosk_user="$2"
  local user_home="$3"

  if ! has_turbovnc "$user_home"; then
    echo "TurboVNC was not detected. Skipping VNC kiosk startup."
    return 0
  fi

  echo "Configuring TurboVNC kiosk startup..."
  install -d -o "$kiosk_user" -g "$kiosk_user" -m 0700 "$user_home/.vnc"
  if [ -f "$user_home/.vnc/xstartup.turbovnc" ] && [ ! -f "$user_home/.vnc/xstartup.turbovnc.nvr-kiosk.bak" ]; then
    cp "$user_home/.vnc/xstartup.turbovnc" "$user_home/.vnc/xstartup.turbovnc.nvr-kiosk.bak"
  fi

  cat >"$user_home/.vnc/xstartup.turbovnc" <<EOF
#!/usr/bin/env bash
set -uo pipefail

KIOSK_URL=$(printf '%q' "$kiosk_url")
CHROME_BIN="\$(command -v google-chrome-stable || command -v google-chrome || true)"

if [ -z "\${NVR_VNC_DBUS_STARTED:-}" ] && command -v dbus-run-session >/dev/null 2>&1; then
  export NVR_VNC_DBUS_STARTED=1
  exec dbus-run-session "\$0" "\$@"
fi

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

mkdir -p "\$HOME/.config/google-chrome-vnc-kiosk"

if [ -z "\$CHROME_BIN" ]; then
  echo "Google Chrome is not installed."
  sleep 10
  exit 1
fi

sleep 3
while true; do
  "\$CHROME_BIN" \\
    --user-data-dir="\$HOME/.config/google-chrome-vnc-kiosk" \\
    --kiosk \\
    --start-fullscreen \\
    --no-first-run \\
    --disable-infobars \\
    --disable-session-crashed-bubble \\
    --disable-features=Translate \\
    --autoplay-policy=no-user-gesture-required \\
    --overscroll-history-navigation=0 \\
    --disable-pinch \\
    --disable-gpu \\
    --disable-dev-shm-usage \\
    "\$KIOSK_URL"
  sleep 3
done
EOF

  chown "$kiosk_user:$kiosk_user" "$user_home/.vnc/xstartup.turbovnc"
  chmod 0755 "$user_home/.vnc/xstartup.turbovnc"

  if [ -f "$user_home/.vnc/turbovncserver.conf" ] && [ ! -f "$user_home/.vnc/turbovncserver.conf.nvr-kiosk.bak" ]; then
    cp "$user_home/.vnc/turbovncserver.conf" "$user_home/.vnc/turbovncserver.conf.nvr-kiosk.bak"
  fi

  local tmp_conf
  tmp_conf="$(mktemp)"
  if [ -f "$user_home/.vnc/turbovncserver.conf" ]; then
    grep -vE '^[[:space:]]*\$xstartup[[:space:]]*=' "$user_home/.vnc/turbovncserver.conf" >"$tmp_conf" || true
  fi
  printf '$xstartup = "%s";\n' "$user_home/.vnc/xstartup.turbovnc" >>"$tmp_conf"
  install -m 0644 "$tmp_conf" "$user_home/.vnc/turbovncserver.conf"
  rm -f "$tmp_conf"
  chown "$kiosk_user:$kiosk_user" "$user_home/.vnc/turbovncserver.conf"
}

install_kiosk() {
  local kiosk_url="$1"
  local kiosk_user="$2"

  require_ubuntu
  id "$kiosk_user" >/dev/null 2>&1 || die "User '$kiosk_user' does not exist."

  local user_home
  user_home="$(getent passwd "$kiosk_user" | cut -d: -f6)"
  [ -n "$user_home" ] && [ -d "$user_home" ] || die "Cannot find home for '$kiosk_user'."

  export DEBIAN_FRONTEND=noninteractive
  echo "Installing base packages..."
  apt-get update
  apt-get install -y ca-certificates curl dbus-x11 gnupg openbox unclutter x11-xserver-utils

  echo "Installing Google Chrome..."
  install_chrome_repo
  apt-get update
  apt-get install -y google-chrome-stable

  echo "Writing kiosk configuration..."
  cat >/etc/nvr-kiosk.env <<EOF
KIOSK_URL=$(printf '%q' "$kiosk_url")
KIOSK_USER=$(printf '%q' "$kiosk_user")
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

KIOSK_URL="${KIOSK_URL:-http://192.168.1.91:3000/viewer}"
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

  cat >/usr/share/xsessions/nvr-kiosk.desktop <<'EOF'
[Desktop Entry]
Name=NVR Kiosk
Comment=Camera Server kiosk viewer
Exec=/usr/local/bin/nvr-kiosk-launch
Type=Application
DesktopNames=NVRKiosk
EOF

  cat >"$user_home/.dmrc" <<'EOF'
[Desktop]
Session=nvr-kiosk
EOF
  chown "$kiosk_user:$kiosk_user" "$user_home/.dmrc"
  chmod 0644 "$user_home/.dmrc"

  install -d -o "$kiosk_user" -g "$kiosk_user" "$user_home/.config"
  runuser -u "$kiosk_user" -- dbus-run-session gsettings set org.gnome.desktop.session idle-delay 0 >/dev/null 2>&1 || true
  runuser -u "$kiosk_user" -- dbus-run-session gsettings set org.gnome.desktop.screensaver lock-enabled false >/dev/null 2>&1 || true
  runuser -u "$kiosk_user" -- dbus-run-session gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing >/dev/null 2>&1 || true
  runuser -u "$kiosk_user" -- dbus-run-session gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type nothing >/dev/null 2>&1 || true

  configure_display_manager "$kiosk_user"
  configure_turbovnc "$kiosk_url" "$kiosk_user" "$user_home"

  echo "Kiosk install completed for URL: $kiosk_url"
}

backup_netplan() {
  local backup_dir="/etc/netplan/nvr-kiosk-backup"
  mkdir -p "$backup_dir"
  shopt -s nullglob
  local file
  for file in /etc/netplan/*.yaml /etc/netplan/*.yml; do
    cp -n "$file" "$backup_dir/$(basename "$file")" || true
  done
  shopt -u nullglob
}

apply_network() {
  local mode="$1"
  local iface
  iface="$(detect_interface "${2:-}")"
  local static_ip="${3:-}"
  local gateway="${4:-}"
  local dns="${5:-}"

  command -v netplan >/dev/null 2>&1 || die "netplan is not installed."
  backup_netplan

  if [ "$mode" = "dhcp" ]; then
    cat >/etc/netplan/90-nvr-kiosk.yaml <<EOF
network:
  version: 2
  renderer: NetworkManager
  ethernets:
    $iface:
      dhcp4: true
EOF
  elif [ "$mode" = "static" ]; then
    [ -n "$static_ip" ] && [ -n "$gateway" ] && [ -n "$dns" ] || die "Static mode requires IP/CIDR, gateway and DNS."
    cat >/etc/netplan/90-nvr-kiosk.yaml <<EOF
network:
  version: 2
  renderer: NetworkManager
  ethernets:
    $iface:
      dhcp4: false
      addresses:
        - $static_ip
      routes:
        - to: default
          via: $gateway
      nameservers:
        addresses:
          - $dns
EOF
  else
    die "Unknown network mode: $mode"
  fi

  netplan generate
  netplan apply
  echo "Network applied on interface $iface with mode $mode. SSH may disconnect if the IP changed."
}

status() {
  local env_url="not configured"
  local env_user="not configured"
  if [ -f /etc/nvr-kiosk.env ]; then
    # shellcheck disable=SC1091
    . /etc/nvr-kiosk.env
    env_url="${KIOSK_URL:-not configured}"
    env_user="${KIOSK_USER:-not configured}"
  fi

  echo "Kiosk URL: $env_url"
  echo "Kiosk user: $env_user"
  echo "Chrome: $(command -v google-chrome-stable || command -v google-chrome || echo not installed)"
  echo "Session file: $(test -f /usr/share/xsessions/nvr-kiosk.desktop && echo installed || echo missing)"
  echo "Display manager: $(detect_display_manager)"
  if [ -f /etc/lightdm/lightdm.conf.d/50-nvr-kiosk.conf ]; then
    echo "LightDM autologin:"
    grep -E '^(autologin-user|autologin-user-timeout|user-session)=' /etc/lightdm/lightdm.conf.d/50-nvr-kiosk.conf 2>/dev/null || true
  fi
  if [ -f /etc/gdm3/custom.conf ]; then
    echo "GDM autologin:"
    grep -E '^(AutomaticLoginEnable|AutomaticLogin|WaylandEnable)=' /etc/gdm3/custom.conf 2>/dev/null || true
  fi
  echo "Default route:"
  ip route show default 2>/dev/null || true
  echo "TurboVNC:"
  if [ "$env_user" != "not configured" ] && id "$env_user" >/dev/null 2>&1; then
    local env_home
    env_home="$(getent passwd "$env_user" | cut -d: -f6)"
    if has_turbovnc "$env_home"; then
      echo "installed/running"
    else
      echo "not detected"
    fi
    echo "VNC xstartup: $(test -x "$env_home/.vnc/xstartup.turbovnc" && echo executable || echo missing-or-not-executable)"
    echo "VNC config xstartup:"
    grep -E '^\s*\$xstartup\s*=' "$env_home/.vnc/turbovncserver.conf" 2>/dev/null || true
  else
    echo "unknown"
  fi
  echo "Xvnc process:"
  pgrep -af "Xvnc|TurboVNC" || true
  echo "Chrome process:"
  if [ "$env_user" != "not configured" ] && id "$env_user" >/dev/null 2>&1; then
    pgrep -u "$env_user" -af "google-chrome|chrome" || true
  fi
}

case "${1:-}" in
  install)
    install_kiosk "${2:-}" "${3:-}"
    ;;
  network)
    apply_network "${2:-}" "${3:-}" "${4:-}" "${5:-}" "${6:-}"
    ;;
  status)
    status
    ;;
  *)
    die "Usage: $0 install URL USER | network dhcp IFACE | network static IFACE IP/CIDR GATEWAY DNS | status"
    ;;
esac
"""


@dataclass
class ConnectionSettings:
    host: str
    username: str
    password: str


class KioskManager(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(f"{APP_NAME} v{APP_VERSION}")
        self.geometry("920x700")
        self.minsize(820, 620)

        self.host_var = tk.StringVar(value=DEFAULT_CLIENT_IP)
        self.user_var = tk.StringVar(value=DEFAULT_SSH_USER)
        self.pass_var = tk.StringVar()
        self.url_var = tk.StringVar(value=DEFAULT_VIEWER_URL)
        self.mode_var = tk.StringVar(value="dhcp")
        self.iface_var = tk.StringVar()
        self.static_ip_var = tk.StringVar(value="192.168.1.201/24")
        self.gateway_var = tk.StringVar(value="192.168.1.1")
        self.dns_var = tk.StringVar(value="192.168.1.1")
        self.status_var = tk.StringVar(value=f"Ready - {APP_NAME} v{APP_VERSION}")

        self._build_ui()
        self._update_network_state()

    def _build_ui(self) -> None:
        outer = ttk.Frame(self, padding=14)
        outer.pack(fill=tk.BOTH, expand=True)

        ttk.Label(outer, text=f"{APP_NAME} v{APP_VERSION}").pack(anchor=tk.W, pady=(0, 8))

        connection = ttk.LabelFrame(outer, text="SSH Client")
        connection.pack(fill=tk.X)
        self._entry(connection, "Client IP", self.host_var, 0, 0)
        self._entry(connection, "User", self.user_var, 0, 2)
        self._entry(connection, "Password", self.pass_var, 1, 0, show="*")
        self._entry(connection, "Viewer URL", self.url_var, 1, 2, width=44)

        network = ttk.LabelFrame(outer, text="Network")
        network.pack(fill=tk.X, pady=(10, 0))
        ttk.Label(network, text="Mode").grid(row=0, column=0, sticky=tk.W, padx=8, pady=6)
        ttk.Radiobutton(network, text="DHCP", variable=self.mode_var, value="dhcp", command=self._update_network_state).grid(
            row=0, column=1, sticky=tk.W, padx=8, pady=6
        )
        ttk.Radiobutton(network, text="Static", variable=self.mode_var, value="static", command=self._update_network_state).grid(
            row=0, column=2, sticky=tk.W, padx=8, pady=6
        )
        self._entry(network, "Interface", self.iface_var, 1, 0)
        self.static_widgets = [
            self._entry(network, "IP/CIDR", self.static_ip_var, 1, 2),
            self._entry(network, "Gateway", self.gateway_var, 2, 0),
            self._entry(network, "DNS", self.dns_var, 2, 2),
        ]

        actions = ttk.Frame(outer)
        actions.pack(fill=tk.X, pady=(12, 0))
        buttons = [
            ("Test SSH", self.test_ssh),
            ("Install/Update Kiosk", self.install_kiosk),
            ("Apply Network", self.apply_network),
            ("Reboot", self.reboot_client),
            ("Status", self.show_status),
        ]
        for label, command in buttons:
            ttk.Button(actions, text=label, command=command).pack(side=tk.LEFT, padx=(0, 8))

        ttk.Label(outer, textvariable=self.status_var).pack(fill=tk.X, pady=(10, 4))
        self.log = tk.Text(outer, height=22, wrap=tk.WORD)
        self.log.pack(fill=tk.BOTH, expand=True)

    def _entry(
        self,
        parent: ttk.Frame,
        label: str,
        variable: tk.StringVar,
        row: int,
        column: int,
        width: int = 26,
        show: str | None = None,
    ) -> ttk.Entry:
        ttk.Label(parent, text=label).grid(row=row, column=column, sticky=tk.W, padx=8, pady=6)
        entry = ttk.Entry(parent, textvariable=variable, width=width, show=show)
        entry.grid(row=row, column=column + 1, sticky=tk.EW, padx=8, pady=6)
        parent.columnconfigure(column + 1, weight=1)
        return entry

    def _update_network_state(self) -> None:
        state = tk.NORMAL if self.mode_var.get() == "static" else tk.DISABLED
        for widget in getattr(self, "static_widgets", []):
            widget.configure(state=state)

    def settings(self) -> ConnectionSettings:
        host = self.host_var.get().strip()
        username = self.user_var.get().strip()
        password = self.pass_var.get()
        if not host or not username or not password:
            raise ValueError("Client IP, user and password are required.")
        return ConnectionSettings(host=host, username=username, password=password)

    def log_line(self, text: str) -> None:
        self.log.insert(tk.END, text + "\n")
        self.log.see(tk.END)

    def run_worker(self, title: str, func) -> None:
        def wrapped() -> None:
            self.status_var.set(f"{title}...")
            try:
                func()
                self.status_var.set(f"{title} completed")
            except Exception as exc:  # noqa: BLE001 - GUI should display remote failures
                self.status_var.set(f"{title} failed")
                self.log_line(f"ERROR: {exc}")
                messagebox.showerror(title, str(exc))

        threading.Thread(target=wrapped, daemon=True).start()

    def connect(self):
        if paramiko is None:
            raise RuntimeError("paramiko is missing. Install it with: py -m pip install paramiko")
        settings = self.settings()
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            settings.host,
            username=settings.username,
            password=settings.password,
            timeout=10,
            banner_timeout=20,
            auth_timeout=20,
            look_for_keys=False,
            allow_agent=False,
        )
        return client, settings

    def upload_script(self, client) -> None:
        with client.open_sftp() as sftp:
            with sftp.file(REMOTE_SCRIPT, "w") as remote_file:
                remote_file.write(REMOTE_BASH)
            sftp.chmod(REMOTE_SCRIPT, 0o755)

    def exec(self, command: str, sudo: bool = False, timeout: int | None = None) -> str:
        client, settings = self.connect()
        try:
            if sudo:
                command = "printf '%s\\n' " + shlex.quote(settings.password) + " | sudo -S -p '' " + command
            self.log_line(f"$ {command.replace(settings.password, '********')}")
            stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
            del stdin
            out = stdout.read().decode("utf-8", errors="replace")
            err = stderr.read().decode("utf-8", errors="replace")
            exit_code = stdout.channel.recv_exit_status()
            if out.strip():
                self.log_line(out.rstrip())
            if err.strip():
                self.log_line(err.rstrip())
            if exit_code != 0:
                raise RuntimeError(f"Remote command failed with exit code {exit_code}")
            return out
        finally:
            client.close()

    def exec_uploaded(self, args: list[str], sudo: bool = True, timeout: int | None = None) -> str:
        client, settings = self.connect()
        try:
            self.upload_script(client)
            command = "bash " + shlex.quote(REMOTE_SCRIPT) + " " + " ".join(shlex.quote(arg) for arg in args)
            if sudo:
                command = "printf '%s\\n' " + shlex.quote(settings.password) + " | sudo -S -p '' " + command
            self.log_line(f"$ {command.replace(settings.password, '********')}")
            stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
            del stdin
            out = stdout.read().decode("utf-8", errors="replace")
            err = stderr.read().decode("utf-8", errors="replace")
            exit_code = stdout.channel.recv_exit_status()
            if out.strip():
                self.log_line(out.rstrip())
            if err.strip():
                self.log_line(err.rstrip())
            if exit_code != 0:
                raise RuntimeError(f"Remote command failed with exit code {exit_code}")
            return out
        finally:
            client.close()

    def test_ssh(self) -> None:
        def task() -> None:
            client, settings = self.connect()
            try:
                self.log_line(f"Connected to {settings.username}@{settings.host}")
                _, stdout, _ = client.exec_command("hostname && uname -a")
                self.log_line(stdout.read().decode("utf-8", errors="replace").rstrip())
            finally:
                client.close()

        self.run_worker("Test SSH", task)

    def install_kiosk(self) -> None:
        def task() -> None:
            settings = self.settings()
            self.exec_uploaded(["install", self.url_var.get().strip(), settings.username], sudo=True, timeout=None)

        self.run_worker("Install/Update Kiosk", task)

    def apply_network(self) -> None:
        def task() -> None:
            mode = self.mode_var.get()
            iface = self.iface_var.get().strip()
            if mode == "static":
                args = [
                    "network",
                    "static",
                    iface,
                    self.static_ip_var.get().strip(),
                    self.gateway_var.get().strip(),
                    self.dns_var.get().strip(),
                ]
            else:
                args = ["network", "dhcp", iface]
            self.exec_uploaded(args, sudo=True, timeout=None)

        if not messagebox.askyesno("Apply Network", "Network changes may disconnect SSH. Continue?"):
            return
        self.run_worker("Apply Network", task)

    def reboot_client(self) -> None:
        def task() -> None:
            try:
                self.exec("reboot", sudo=True, timeout=5)
            except (socket.timeout, EOFError, RuntimeError) as exc:
                self.log_line(f"Reboot command sent; connection may close: {exc}")

        if not messagebox.askyesno("Reboot", "Reboot the selected Ubuntu client now?"):
            return
        self.run_worker("Reboot", task)

    def show_status(self) -> None:
        def task() -> None:
            self.exec_uploaded(["status"], sudo=False, timeout=30)

        self.run_worker("Status", task)


if __name__ == "__main__":
    app = KioskManager()
    app.mainloop()
