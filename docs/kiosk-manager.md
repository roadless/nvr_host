# Kiosk Client Manager

Bu arac Windows PC uzerinden Ubuntu kiosk client'lara SSH ile baglanir. GitHub'dan script indirmez; kurulum komutlarini SSH uzerinden gecici olarak client'a yukler ve sudo ile calistirir.

Surum: `1.0.4`

## Windows Hazirlik

Python ve bagimliliklar kurulu olmali:

```powershell
python -m pip install -r tools\requirements-kiosk-manager.txt
```

Araci ac:

```powershell
python tools\kiosk_manager.py
```

Windows'ta sadece `py` komutu varsa ayni komutlari `py` ile calistir:

```powershell
py -m pip install -r tools\requirements-kiosk-manager.txt
py tools\kiosk_manager.py
```

## Portable EXE Build

Tek dosyalik Windows exe uret:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-kiosk-manager.ps1
```

Cikti:

```text
dist/NVRKioskManager-1.0.4.exe
```

Bu exe portable'dir. Diger Windows PC'ye tek dosya olarak kopyalayip calistirabilirsin; Python kurulu olmasi gerekmez.

Installer GDM ve LightDM display manager'larini otomatik algilar. Client'ta ikisi de yoksa hafif `xorg` + `lightdm` kurulumu yapip kiosk autologin'i LightDM uzerinden ayarlar.

VNC ile baglaniyorsan fiziksel LightDM/GDM oturumunu degil TurboVNC'nin ayri `:1` oturumunu gorursun. Installer TurboVNC algilarsa `~/.vnc/xstartup.turbovnc` dosyasini kiosk viewer acacak sekilde yazar ve `~/.vnc/turbovncserver.conf` icinde `$xstartup` ayarini bu dosyaya yonlendirir. Calisan VNC oturumu kapatilmaz; degisikligi gormek icin client'i reboot et veya VNC oturumunu yeniden baslat:

```bash
/opt/TurboVNC/bin/vncserver -kill :1
/opt/TurboVNC/bin/vncserver :1
```

Varsayilan degerler:

- Client IP: `192.168.1.92`
- SSH user: `cam`
- Viewer URL: `http://192.168.1.91:3000/viewer`

Sifre repo icinde tutulmaz. Arayuzde `Password` alanina Ubuntu client kullanici sifresini yaz.

## Ilk Kiosk Kurulumu

1. Client IP, user, password ve Viewer URL alanlarini doldur.
2. `Test SSH` ile baglantiyi kontrol et.
3. `Install/Update Kiosk` butonuna bas.
4. Kurulum bitince `Status` ile kontrol et.
5. `Reboot` ile client'i yeniden baslat.

Yeniden basladiktan sonra Ubuntu `cam` kullanicisi ile otomatik login olur ve Chrome viewer'i kiosk/tam ekran modunda acar.

## IP veya DHCP Degistirme

DHCP icin:

1. Network mode olarak `DHCP` sec.
2. Interface bos kalabilir; script default route interface'ini bulur.
3. `Apply Network` butonuna bas.

Static IP icin:

1. Network mode olarak `Static` sec.
2. `IP/CIDR`, `Gateway`, `DNS` alanlarini doldur.
3. Interface bos kalabilir; gerekirse `ens18` gibi elle yaz.
4. `Apply Network` butonuna bas.

IP degisikliginden sonra SSH baglantisinin kopmasi normaldir. Arayuzde Client IP alanini yeni IP ile degistirip `Test SSH` veya `Status` calistir.

## Diger Client'lara Uygulama

Her client icin ayni akis uygulanir:

1. Client IP alanini ilgili Ubuntu IP'siyle degistir.
2. User/password bilgisini gir.
3. Gerekirse static IP bilgilerini yaz.
4. Once `Test SSH`, sonra `Install/Update Kiosk`, sonra `Apply Network`, en son `Reboot`.

## Client Uzerinde Olusan Dosyalar

- `/etc/nvr-kiosk.env`
- `/usr/local/bin/nvr-kiosk-launch`
- `/usr/share/xsessions/nvr-kiosk.desktop`
- `/etc/gdm3/custom.conf` veya `/etc/lightdm/lightdm.conf.d/50-nvr-kiosk.conf`
- `/etc/netplan/90-nvr-kiosk.yaml` sadece network degisikligi uygulanirsa yazilir.

Mevcut netplan dosyalari ilk network degisikliginde `/etc/netplan/nvr-kiosk-backup` altina yedeklenir.
