import { useEffect, useState } from "react";
import { Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import type { CameraConfig, CameraConfigFile, HealthResponse, PlaybackMode, ViewerMenuPosition } from "../../shared/types";

const defaultViewerConfig: CameraConfigFile["viewer"] = {
  menuPosition: "right",
  playbackMode: "webrtc"
};

const menuPositionOptions: Array<{ value: ViewerMenuPosition; label: string }> = [
  { value: "bottom", label: "Bottom" },
  { value: "top", label: "Top" },
  { value: "right", label: "Right" },
  { value: "left", label: "Left" }
];

const playbackModeOptions: Array<{ value: PlaybackMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "webrtc", label: "WebRTC" },
  { value: "mse", label: "MSE" }
];

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

  useEffect(() => {
    void loadConfig().catch((error) => setMessage(error instanceof Error ? error.message : "Configuration could not be loaded."));
    void loadHealth();
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
      await loadHealth();
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
          <button className="icon-text-button" onClick={() => void loadConfig()}>
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
          <span>Viewer playback</span>
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
