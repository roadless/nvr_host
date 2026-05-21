# Ubuntu Desktop Kiosk Viewer

This script prepares an Ubuntu Desktop VM to open only the Camera Server viewer in Google Chrome kiosk mode. Proxmox VM creation is not automated here; create the VM first, then run the installer inside Ubuntu.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/roadless/nvr_host/main/scripts/install-kiosk-ubuntu.sh -o install-kiosk-ubuntu.sh
sudo bash install-kiosk-ubuntu.sh --url http://192.168.32.154:3000/viewer
sudo reboot
```

After reboot, Ubuntu should auto-login as the `kiosk` user and open the viewer.

## Viewer Load Profiles

For multiple kiosk screens, give each kiosk its own profile and camera group. Quote URLs that contain `&`:

```bash
sudo nvr-kiosk-set-url 'http://192.168.32.154:3000/viewer?profile=kiosk-01&group=1&groups=4&maxLive=12&rotate=20'
sudo nvr-kiosk-set-url 'http://192.168.32.154:3000/viewer?profile=kiosk-02&group=2&groups=4&maxLive=12&rotate=20'
sudo nvr-kiosk-set-url 'http://192.168.32.154:3000/viewer?profile=kiosk-03&group=3&groups=4&maxLive=12&rotate=20'
sudo nvr-kiosk-set-url 'http://192.168.32.154:3000/viewer?profile=kiosk-04&group=4&groups=4&maxLive=12&rotate=20'
```

`maxLive=12` limits how many streams play at the same time. `rotate=20` changes the active live group every 20 seconds.

## Static IP

The installer does not change networking unless all static IP options are provided:

```bash
sudo bash install-kiosk-ubuntu.sh \
  --url http://192.168.32.154:3000/viewer \
  --static-ip 192.168.32.201/24 \
  --gateway 192.168.32.1 \
  --dns 192.168.32.1 \
  --interface ens18
```

## Commands

Change the viewer URL:

```bash
sudo nvr-kiosk-set-url http://HOST:3000/viewer
```

Update the kiosk installer from GitHub while preserving the current URL:

```bash
sudo nvr-kiosk-update
```

Show current status:

```bash
nvr-kiosk-status
```
