# Linux Install and Update

Recommended deployment is SSH + Git + Docker Compose. FTP/shared hosting is not suitable for running this app because it needs long-running containers, go2rtc ports, Docker access, and WebRTC TCP/UDP traffic.

## First Install

SSH into the Ubuntu/Debian host:

```bash
ssh user@HOST_IP
```

Run the installer with your private repository URL:

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/scripts/install-linux.sh -o install-linux.sh
bash install-linux.sh git@github.com:YOUR_USER/YOUR_REPO.git
```

If you copied the repo manually first, run from the project directory instead:

```bash
bash scripts/install-linux.sh git@github.com:YOUR_USER/YOUR_REPO.git
```

Then edit secrets and camera URLs:

```bash
nano /opt/nvr_host/.env
nano /opt/nvr_host/data/cameras.yaml
nvr-update
```

Open:

```text
http://HOST_IP:3000/viewer
http://HOST_IP:3000/admin
http://HOST_IP:1984
```

Viewer-only Ubuntu Desktop kiosk VM setup is documented in:

```text
docs/kiosk-install.md
```

## One Command Update

After you push changes from Windows to Git, SSH into the Linux host and run:

```bash
nvr-update
```

That command runs:

```bash
cd /opt/nvr_host
git pull --ff-only
docker compose up -d --build
docker image prune -f
```

It does not overwrite `.env`, `data/cameras.yaml`, or `data/go2rtc.yaml`.

## FTP/SFTP Fallback

On Windows, create a clean upload archive:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-ftp.ps1
```

Upload `nvr_host_upload.tar.gz` to the Linux host, then:

```bash
sudo mkdir -p /opt/nvr_host
sudo chown -R $USER:$USER /opt/nvr_host
tar -xzf nvr_host_upload.tar.gz -C /opt/nvr_host
cd /opt/nvr_host
cp -n .env.example .env
cp -n data/cameras.example.yaml data/cameras.yaml
cp -n data/go2rtc.example.yaml data/go2rtc.yaml
docker compose up -d --build
```

Git remains the recommended update method.

## Checks

```bash
docker compose ps
docker logs -f nvr-host
docker logs -f nvr-go2rtc
```

LAN/Kerio should allow:

```text
3000/tcp
1984/tcp
8555/tcp
8555/udp
```
