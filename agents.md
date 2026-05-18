# NVR Host Agent Memory

Bu repo Linux uzerinde calisacak canli izleme odakli NVR host projesidir. Ana hedef 36 RTSP kamerayi go2rtc ile WebRTC yayinina cevirmek, browser kiosk viewer ile izletmek ve basit admin panelden kamera config yonetmektir.

## Mimari

- Backend: Node.js + TypeScript + Express.
- Frontend: React + Vite.
- Video katmani: go2rtc. Node video encode/transcode yapmaz.
- Calisma sekli: Docker Compose ile `nvr-host` ve `nvr-go2rtc` servisleri.
- Viewer route: `/viewer`.
- Admin route: `/admin`.
- Admin auth: Basic Auth, `.env` icindeki `ADMIN_USER` ve `ADMIN_PASSWORD`.
- Kamera ana kaynagi: `data/cameras.yaml`.
- go2rtc generated config: `data/go2rtc.yaml`.

## Gizli Dosya Kurallari

Asla Git'e alinmayacak dosyalar:

- `.env`
- `data/cameras.yaml`
- `data/go2rtc.yaml`
- `node_modules/`
- `dist/`

Gercek RTSP sifreleri sadece Linux host uzerindeki `data/cameras.yaml` icinde kalmali. Repo icinde yalnizca ornek dosyalar bulunur:

- `data/cameras.example.yaml`
- `data/go2rtc.example.yaml`

Commit veya push oncesi secret taramasi yap:

```bash
git grep -n -E "rtsp://admin:|192\\.168\\.32|pafl" HEAD
git status --short
```

## Linux Deploy Akisi

Onerilen kurulum ve guncelleme yontemi SSH + Git + Docker Compose.

Ilk kurulum:

```bash
sudo rm -rf /opt/nvr_host
sudo mkdir -p /opt/nvr_host
sudo chown -R $USER:$USER /opt/nvr_host
git clone git@github.com-nvr:roadless/nvr_host.git /opt/nvr_host
cd /opt/nvr_host
bash scripts/install-linux.sh git@github.com-nvr:roadless/nvr_host.git
```

Kurulumdan sonra:

```bash
nano /opt/nvr_host/.env
nano /opt/nvr_host/data/cameras.yaml
nvr-update
```

Sonraki guncellemeler:

```bash
nvr-update
```

Bu komut `git pull --ff-only`, `docker compose up -d --build` ve image temizligi yapar.

## Portlar

- `3000/tcp`: Viewer ve admin.
- `1984/tcp`: go2rtc API/Web UI.
- `8554/tcp`: go2rtc RTSP.
- `8555/tcp` ve `8555/udp`: go2rtc WebRTC.

Viewer:

```text
http://HOST_IP:3000/viewer
```

Admin:

```text
http://HOST_IP:3000/admin
```

go2rtc:

```text
http://HOST_IP:1984
```

## Viewer Davranisi

- Mouse hareket edince alttan menu acilir.
- Layout secenekleri: `1`, `4`, `6`, `9`, `12`, `16`.
- Tekli layout main stream kullanir.
- Coklu layoutlar sub stream kullanir.
- Viewer state `localStorage` icinde tutulur.
- Kamera hata durumunda tile bos/hata durumunda kalir ve retry yapar.

## Admin Davranisi

- Admin kamera ekleme, silme ve duzenleme yapar.
- Kaydetme islemi `data/cameras.yaml` yazar, `data/go2rtc.yaml` uretir ve go2rtc restart dener.
- Restart sirasi:
  1. go2rtc HTTP API.
  2. Docker socket.
  3. Docker CLI.

## Sik Karsilasilan Sorunlar

- `connect ENOENT /var/run/docker.sock`: Backend Docker disinda calisiyor veya docker.sock mount edilmemis. Docker Compose ile calistir ya da Linux hostta Docker CLI fallback'in calistigini kontrol et.
- `Permission denied scripts/deploy.sh`: Script artik `bash scripts/deploy.sh` ile cagriliyor ve Git'te executable bit var. Eski clone varsa `git pull` veya temiz clone yap.
- `Unable to read current working directory`: Bulunulan klasor silinmis. `cd ~` yapip komutlari tekrar calistir.
- GitHub HTTPS password hatasi: GitHub sifre ile clone kabul etmez. SSH deploy key kullan.

## Dogrulama

Kod degisikliginden sonra:

```bash
npm run typecheck
npm run build
```

Linux hostta:

```bash
docker compose ps
docker logs -f nvr-host
docker logs -f nvr-go2rtc
```
