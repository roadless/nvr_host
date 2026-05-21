# NVR Host

Linux uzerinde calisan canli izleme odakli NVR host uygulamasi. RTSP akislarini go2rtc yonetir; Node.js uygulamasi kamera konfig, admin panel ve browser kiosk viewer arayuzunu saglar.

## Hizli Kurulum

Onerilen kurulum yontemi:

```text
SSH + Git + Docker Compose
```

Detayli Linux kurulum ve tek komut update dokumani:

```text
docs/linux-install.md
```

## Docker Compose

Linux hostta:

```bash
cp .env.example .env
cp data/cameras.example.yaml data/cameras.yaml
cp data/go2rtc.example.yaml data/go2rtc.yaml
docker compose up -d --build
```

Viewer:

```text
http://HOST_IP:3000/viewer
```

Admin:

```text
http://HOST_IP:3000/admin
```

go2rtc Web UI:

```text
http://HOST_IP:1984
```

WebRTC yayin acilmazsa `.env` icinde host IP adayini tanimla:

```env
GO2RTC_WEBRTC_CANDIDATES=HOST_IP:8555
```

## Tek Komut Guncelleme

Ilk kurulum scripti `/usr/local/bin/nvr-update` komutunu olusturur. Sonraki guncellemelerde:

```bash
nvr-update
```

Bu komut `git pull --ff-only`, `docker compose up -d --build` ve eski image temizligini yapar.

## Kamera Config

Gercek kamera bilgileri `data/cameras.yaml` icinde tutulur ve Git'e alinmaz.

Ornek dosya:

```text
data/cameras.example.yaml
```

Format:

```yaml
cameras:
  - id: cam01
    name: Kamera 01
    enabled: true
    mainRtsp: rtsp://user:password@192.168.1.101:554/stream1
    subRtsp: rtsp://user:password@192.168.1.101:554/stream2
```

Viewer API'si RTSP adreslerini dondurmez. Viewer yalnizca `cam01_main` ve `cam01_sub` gibi go2rtc stream adlariyla baglanir.

## Kiosk Viewer

Ubuntu Desktop viewer VM icinde tek komutluk kiosk kurulumu:

```bash
curl -fsSL https://raw.githubusercontent.com/roadless/nvr_host/main/scripts/install-kiosk-ubuntu.sh -o install-kiosk-ubuntu.sh
sudo bash install-kiosk-ubuntu.sh --url http://HOST_IP:3000/viewer
sudo reboot
```

Birden fazla kiosk icin viewer URL'sine profil ve grup parametreleri verilebilir:

```bash
sudo nvr-kiosk-set-url 'http://HOST_IP:3000/viewer?profile=kiosk-01&group=1&groups=4&maxLive=12&rotate=20'
```

Detayli kiosk dokumani:

```text
docs/kiosk-install.md
```

Mouse hareket edince alt menu acilir. Tekli layout main stream, coklu layoutlar sub stream kullanir.

## Notlar

- `.env`, `data/cameras.yaml` ve `data/go2rtc.yaml` Git/Docker build disinda tutulur.
- Admin panel kamera degisikligini kaydedince `data/go2rtc.yaml` yeniden uretilir ve go2rtc restart edilir.
- Restart once go2rtc HTTP API uzerinden denenir, sonra Docker socket, sonra Docker CLI fallback denenir.
- Docker socket mount edildigi icin servis guvenilir LAN/Kerio arkasinda tutulmalidir.
