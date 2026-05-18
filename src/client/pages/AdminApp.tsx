import { useEffect, useState } from "react";
import { Plus, Save, Trash2, RefreshCcw } from "lucide-react";
import type { CameraConfig, CameraConfigFile, HealthResponse, RestartResponse } from "../../shared/types";

function blankCamera(index: number): CameraConfig {
  const number = String(index).padStart(2, "0");
  return {
    id: `cam${number}`,
    name: `Kamera ${number}`,
    enabled: true,
    mainRtsp: "rtsp://user:password@192.168.1.100:554/main",
    subRtsp: "rtsp://user:password@192.168.1.100:554/sub"
  };
}

export function AdminApp() {
  const [config, setConfig] = useState<CameraConfigFile>({ cameras: [] });
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);

  async function loadConfig() {
    setMessage("");
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error(`Config alınamadı: HTTP ${response.status}`);
    setConfig((await response.json()) as CameraConfigFile);
  }

  async function loadHealth() {
    const response = await fetch("/api/health");
    if (response.ok) setHealth((await response.json()) as HealthResponse);
  }

  useEffect(() => {
    void loadConfig().catch((error) => setMessage(error instanceof Error ? error.message : "Config alınamadı."));
    void loadHealth();
  }, []);

  function updateCamera(index: number, patch: Partial<CameraConfig>) {
    setConfig((current) => ({
      cameras: current.cameras.map((camera, cameraIndex) => (cameraIndex === index ? { ...camera, ...patch } : camera))
    }));
  }

  function addCamera() {
    setConfig((current) => ({
      cameras: [...current.cameras, blankCamera(current.cameras.length + 1)]
    }));
  }

  function removeCamera(index: number) {
    setConfig((current) => ({
      cameras: current.cameras.filter((_, cameraIndex) => cameraIndex !== index)
    }));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(config)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Kaydetme başarısız: HTTP ${response.status}`);
      setMessage(body.restart?.message ?? "Kaydedildi.");
      await loadHealth();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kaydetme başarısız.");
    } finally {
      setSaving(false);
    }
  }

  async function restartGo2Rtc() {
    setRestarting(true);
    setMessage("");
    try {
      const response = await fetch("/api/restart/go2rtc", {
        method: "POST"
      });
      const body = (await response.json()) as RestartResponse;
      if (!response.ok) throw new Error(body.restart?.message ?? `Restart başarısız: HTTP ${response.status}`);
      setMessage(body.restart.message);
      await loadHealth();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Restart başarısız.");
    } finally {
      setRestarting(false);
    }
  }

  return (
    <main className="admin-shell">
      <header className="admin-toolbar">
        <div>
          <h1>NVR Admin</h1>
          <p>{config.cameras.length} kamera tanımlı</p>
        </div>
        <div className="toolbar-actions">
          <span className={health?.go2rtc.ok ? "status-pill ok" : "status-pill warn"}>
            go2rtc {health?.go2rtc.ok ? "aktif" : "kontrol edilemiyor"}
          </span>
          <button className="icon-text-button" onClick={() => void loadConfig()}>
            <RefreshCcw size={18} />
            Yenile
          </button>
          <button className="icon-text-button" disabled={restarting} onClick={() => void restartGo2Rtc()}>
            <RefreshCcw size={18} />
            {restarting ? "Restart ediliyor" : "go2rtc Restart"}
          </button>
          <button className="icon-text-button primary" disabled={saving || restarting} onClick={() => void save()}>
            <Save size={18} />
            {saving ? "Kaydediliyor" : "Kaydet"}
          </button>
        </div>
      </header>

      {message && <div className="admin-message">{message}</div>}

      <section className="camera-table" aria-label="Kamera ayarları">
        <div className="table-head">
          <span>Aktif</span>
          <span>ID</span>
          <span>Ad</span>
          <span>Main RTSP</span>
          <span>Sub RTSP</span>
          <span />
        </div>
        {config.cameras.map((camera, index) => (
          <div className="table-row" key={`${camera.id}-${index}`}>
            <label className="toggle-cell">
              <input
                checked={camera.enabled}
                onChange={(event) => updateCamera(index, { enabled: event.target.checked })}
                type="checkbox"
              />
            </label>
            <input value={camera.id} onChange={(event) => updateCamera(index, { id: event.target.value })} />
            <input value={camera.name} onChange={(event) => updateCamera(index, { name: event.target.value })} />
            <input value={camera.mainRtsp} onChange={(event) => updateCamera(index, { mainRtsp: event.target.value })} />
            <input value={camera.subRtsp} onChange={(event) => updateCamera(index, { subRtsp: event.target.value })} />
            <button className="icon-button danger" onClick={() => removeCamera(index)} title="Sil" type="button">
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </section>

      <button className="add-camera" onClick={addCamera} type="button">
        <Plus size={18} />
        Kamera ekle
      </button>
    </main>
  );
}
