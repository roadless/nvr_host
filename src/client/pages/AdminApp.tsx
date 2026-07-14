import { useEffect, useState } from "react";
import { Activity, Cpu, MemoryStick, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import type {
  CameraConfig,
  CameraConfigFile,
  HealthResponse,
  PlaybackMode,
  StreamHealthResponse,
  SystemInfoResponse,
  ViewerMenuPosition
} from "../../shared/types";

const defaultViewerConfig: CameraConfigFile["viewer"] = {
  menuPosition: "right",
  playbackMode: "mse"
};

const menuPositionOptions: Array<{ value: ViewerMenuPosition; label: string }> = [
  { value: "bottom", label: "Bottom" },
  { value: "top", label: "Top" },
  { value: "right", label: "Right" },
  { value: "left", label: "Left" }
];

const playbackModeOptions: Array<{ value: PlaybackMode; label: string; detail: string }> = [
  { value: "mse", label: "Akıcı / Kararlı", detail: "MSE kullanır; biraz daha fazla gecikme karşılığında kararlılığı önceler." },
  { value: "webrtc", label: "Düşük Gecikme", detail: "WebRTC kullanır; ağ ve kiosk donanımına daha duyarlıdır." },
  {
    value: "auto",
    label: "Otomatik",
    detail: "WebRTC, WebRTC/TCP ve MSE bağlantı sırasını dener; oynatma sırasında takılmayı algılayıp mod değiştirmez."
  }
];

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function blankCamera(index: number): CameraConfig {
  const number = String(index).padStart(2, "0");
  return {
    id: `cam${number}`,
    name: `Camera ${number}`,
    enabled: true,
    mainRtsp: "rtsp://user:password@192.168.1.100:554/main",
    subRtsp: "rtsp://user:password@192.168.1.100:554/sub"
  };
}

export function AdminApp() {
  const [config, setConfig] = useState<CameraConfigFile>({ viewer: defaultViewerConfig, cameras: [] });
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [system, setSystem] = useState<SystemInfoResponse | null>(null);
  const [streamHealth, setStreamHealth] = useState<StreamHealthResponse | null>(null);
  const [diagnosticError, setDiagnosticError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);

  async function loadConfig() {
    setMessage("");
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error(`Configuration could not be loaded: ${response.status}`);
    setConfig((await response.json()) as CameraConfigFile);
  }

  async function loadHealth() {
    const response = await fetch("/api/health");
    if (response.ok) setHealth((await response.json()) as HealthResponse);
  }

  async function loadDiagnostics() {
    setDiagnosticError("");
    try {
      const [systemResponse, streamsResponse] = await Promise.all([fetch("/api/system"), fetch("/api/stream-health")]);
      if (!systemResponse.ok) throw new Error(`System diagnostics could not be loaded: ${systemResponse.status}`);
      if (!streamsResponse.ok) throw new Error(`Stream diagnostics could not be loaded: ${streamsResponse.status}`);
      setSystem((await systemResponse.json()) as SystemInfoResponse);
      setStreamHealth((await streamsResponse.json()) as StreamHealthResponse);
    } catch (error) {
      setDiagnosticError(error instanceof Error ? error.message : "Diagnostics could not be loaded.");
    }
  }

  async function refreshAll() {
    await Promise.all([loadConfig(), loadHealth(), loadDiagnostics()]);
  }

  useEffect(() => {
    void loadConfig().catch((error) => setMessage(error instanceof Error ? error.message : "Configuration could not be loaded."));
    void loadHealth();
    void loadDiagnostics();
    const timer = window.setInterval(() => void loadDiagnostics(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  function updateCamera(index: number, patch: Partial<CameraConfig>) {
    setConfig((current) => ({
      ...current,
      cameras: current.cameras.map((camera, cameraIndex) => (cameraIndex === index ? { ...camera, ...patch } : camera))
    }));
  }

  function updatePlaybackMode(playbackMode: PlaybackMode) {
    setConfig((current) => ({
      ...current,
      viewer: {
        ...current.viewer,
        playbackMode
      }
    }));
  }

  function addCamera() {
    setConfig((current) => ({
      ...current,
      cameras: [...current.cameras, blankCamera(current.cameras.length + 1)]
    }));
  }

  function removeCamera(index: number) {
    setConfig((current) => ({
      ...current,
      cameras: current.cameras.filter((_, cameraIndex) => cameraIndex !== index)
    }));
  }

  function updateViewerMenuPosition(menuPosition: ViewerMenuPosition) {
    setConfig((current) => ({
      ...current,
      viewer: {
        ...current.viewer,
        menuPosition
      }
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
      if (!response.ok) throw new Error(`Save failed: ${response.status}`);
      setMessage("Saved.");
      await Promise.all([loadHealth(), loadDiagnostics()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function restartStreaming() {
    setRestarting(true);
    setMessage("");
    try {
      const response = await fetch("/api/restart/go2rtc", {
        method: "POST"
      });
      if (!response.ok) throw new Error(`Restart failed: ${response.status}`);
      setMessage("Streaming service restarted.");
      await loadHealth();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Restart failed.");
    } finally {
      setRestarting(false);
    }
  }

  return (
    <main className="admin-shell">
      <header className="admin-toolbar">
        <div>
          <h1>Camera Server</h1>
          <p>{config.cameras.length} cameras configured</p>
        </div>
        <div className="toolbar-actions">
          <span className={health?.go2rtc.ok ? "status-pill ok" : "status-pill warn"}>
            Streaming {health?.go2rtc.ok ? "active" : "unavailable"}
          </span>
          <button className="icon-text-button" onClick={() => void refreshAll()}>
            <RefreshCcw size={18} />
            Refresh
          </button>
          <button className="icon-text-button" disabled={restarting} onClick={() => void restartStreaming()}>
            <RefreshCcw size={18} />
            {restarting ? "Restarting" : "Restart Streaming"}
          </button>
          <button className="icon-text-button primary" disabled={saving || restarting} onClick={() => void save()}>
            <Save size={18} />
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      </header>

      {message && <div className="admin-message">{message}</div>}

      <section className="viewer-settings" aria-label="Viewer settings">
        <div className="viewer-setting-field">
          <label htmlFor="viewer-menu-position">Viewer Menu Position</label>
          <select
            id="viewer-menu-position"
            onChange={(event) => updateViewerMenuPosition(event.target.value as ViewerMenuPosition)}
            value={config.viewer.menuPosition}
          >
            {menuPositionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="viewer-setting-field">
          <span>Viewer playback profile</span>
          <div className="segmented-control">
            {playbackModeOptions.map((option) => (
              <button
                className={config.viewer.playbackMode === option.value ? "selected" : ""}
                key={option.value}
                onClick={() => updatePlaybackMode(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="setting-help">
            {playbackModeOptions.find((option) => option.value === config.viewer.playbackMode)?.detail}
          </p>
        </div>
      </section>

      <section className="stream-health" aria-label="Stream health diagnostics">
        <div className="stream-health-heading">
          <div>
            <h2>Akış Sağlığı</h2>
            <p>go2rtc akışları izleyici bağlandığında açar. İzlenmeyen bir akışın “Boşta” görünmesi normaldir.</p>
          </div>
          <button className="icon-text-button" onClick={() => void loadDiagnostics()} type="button">
            <RefreshCcw size={16} />
            Tanılamayı Yenile
          </button>
        </div>

        <div className="diagnostic-summary">
          <div>
            <Cpu size={18} />
            <span>Host CPU</span>
            <strong>{system ? `${system.cpu.usedPercent.toFixed(1)}%` : "-"}</strong>
          </div>
          <div>
            <MemoryStick size={18} />
            <span>Host Bellek</span>
            <strong>{system ? `${system.memory.usedPercent.toFixed(1)}%` : "-"}</strong>
          </div>
          <div>
            <Activity size={18} />
            <span>Aktif Akış</span>
            <strong>{streamHealth?.streams.filter((stream) => stream.connected).length ?? 0}</strong>
          </div>
        </div>

        <div className="hardware-decode-note">
          Bu değerler NVR host içindir. Kiosk takılıyorsa aynı kiosk cihazında <code>chrome://gpu</code> sayfasından “Video Decode”
          donanım hızlandırmasını kontrol edin; doğrudan RTSP testini de aynı cihazda yapın.
        </div>

        {(diagnosticError || (streamHealth && !streamHealth.ok)) && (
          <div className="diagnostic-error">{diagnosticError || streamHealth?.error || "go2rtc diagnostics unavailable."}</div>
        )}

        <div className="stream-health-table">
          <div className="stream-health-row stream-health-head">
            <span>Kamera / Profil</span>
            <span>Durum</span>
            <span>Codec</span>
            <span>Bağlantılar</span>
            <span>Trafik</span>
          </div>
          {streamHealth?.streams.map((stream) => (
            <div className="stream-health-row" key={`${stream.cameraId}-${stream.profile}`}>
              <span>
                <strong>{stream.cameraName}</strong>
                <small>{stream.profile === "main" ? "Main" : "Sub"}</small>
              </span>
              <span>
                <span className={stream.connected ? "stream-state active" : "stream-state idle"}>
                  {stream.connected ? "Aktif" : "Boşta"}
                </span>
              </span>
              <span>{stream.codecs.join(", ") || "-"}</span>
              <span>
                {stream.producerCount} giriş / {stream.consumerCount} izleyici
              </span>
              <span>
                <small>Giriş {formatBytes(stream.inputBytes)} / {stream.inputPackets.toLocaleString("tr-TR")} pkt</small>
                <small>Çıkış {formatBytes(stream.outputBytes)} / {stream.outputPackets.toLocaleString("tr-TR")} pkt</small>
              </span>
            </div>
          ))}
          {streamHealth?.streams.length === 0 && <div className="stream-health-empty">Etkin kamera bulunmuyor.</div>}
          {!streamHealth && <div className="stream-health-empty">Tanılama yükleniyor…</div>}
        </div>
      </section>

      <section className="camera-table" aria-label="Camera settings">
        <div className="table-head">
          <span>Enabled</span>
          <span>ID</span>
          <span>Name</span>
          <span>Main Stream</span>
          <span>Sub Stream</span>
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
            <button className="icon-button danger" onClick={() => removeCamera(index)} title="Delete" type="button">
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </section>

      <button className="add-camera" onClick={addCamera} type="button">
        <Plus size={18} />
        Add camera
      </button>
    </main>
  );
}
