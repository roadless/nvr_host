import { Fragment, useEffect, useState } from "react";
import { Activity, Cpu, MemoryStick, Plus, RefreshCcw, Save, Trash2, Video } from "lucide-react";
import type {
  CameraConfig,
  CameraConfigFile,
  HealthResponse,
  PlaybackMode,
  PtzDiscoveryResponse,
  PtzSceneActionConfig,
  StreamHealthResponse,
  SystemInfoResponse,
  ViewerMenuPosition
} from "../../shared/types";

const defaultViewerConfig: CameraConfigFile["viewer"] = {
  menuPosition: "right",
  playbackMode: "mse"
};

function defaultPtzConfig(): CameraConfig["ptz"] {
  return {
    enabled: false,
    protocol: "onvif",
    host: "",
    port: 80,
    username: "",
    password: "",
    profileToken: "",
    presets: []
  };
}

const menuPositionOptions: Array<{ value: ViewerMenuPosition; label: string }> = [
  { value: "bottom", label: "Bottom" },
  { value: "top", label: "Top" },
  { value: "right", label: "Right" },
  { value: "left", label: "Left" }
];

const playbackModeOptions: Array<{ value: PlaybackMode; label: string; detail: string }> = [
  { value: "mse", label: "Smooth / Stable", detail: "Uses MSE and prioritizes stable playback at the cost of slightly more latency." },
  { value: "webrtc", label: "Low Latency", detail: "Uses WebRTC and is more sensitive to network and kiosk hardware conditions." },
  {
    value: "auto",
    label: "Automatic",
    detail: "Tries WebRTC, WebRTC/TCP, then MSE for connection fallback. It does not detect playback stutter."
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
    subRtsp: "rtsp://user:password@192.168.1.100:554/sub",
    ptz: defaultPtzConfig()
  };
}

function generatedId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "")}`;
}

export function AdminApp() {
  const [config, setConfig] = useState<CameraConfigFile>({ viewer: defaultViewerConfig, cameras: [], ptzScenes: [] });
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [system, setSystem] = useState<SystemInfoResponse | null>(null);
  const [streamHealth, setStreamHealth] = useState<StreamHealthResponse | null>(null);
  const [diagnosticError, setDiagnosticError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [ptzBusy, setPtzBusy] = useState<string | null>(null);
  const [ptzProfiles, setPtzProfiles] = useState<Record<string, PtzDiscoveryResponse["profiles"]>>({});
  const [ptzMessages, setPtzMessages] = useState<Record<string, string>>({});

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

  function updateCameraPtz(index: number, patch: Partial<CameraConfig["ptz"]>) {
    setConfig((current) => ({
      ...current,
      cameras: current.cameras.map((camera, cameraIndex) =>
        cameraIndex === index ? { ...camera, ptz: { ...camera.ptz, ...patch } } : camera
      )
    }));
  }

  function togglePtz(index: number, enabled: boolean) {
    const camera = config.cameras[index];
    const patch: Partial<CameraConfig["ptz"]> = { enabled };
    if (enabled && (!camera.ptz.host || !camera.ptz.username)) {
      try {
        const source = new URL(camera.mainRtsp);
        if (!camera.ptz.host) patch.host = source.hostname;
        if (!camera.ptz.username) patch.username = decodeURIComponent(source.username);
        if (!camera.ptz.password) patch.password = decodeURIComponent(source.password);
      } catch {
        // The normal save validation will report an invalid RTSP URL.
      }
    }
    updateCameraPtz(index, patch);
  }

  async function synchronizePresets(index: number) {
    const camera = config.cameras[index];
    setPtzBusy(camera.id);
    setPtzMessages((current) => ({ ...current, [camera.id]: "Connecting to the ONVIF camera…" }));
    try {
      const response = await fetch("/api/admin/ptz/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(camera.ptz)
      });
      const payload = (await response.json()) as PtzDiscoveryResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || `ONVIF connection failed: ${response.status}`);
      const existingByToken = new Map(camera.ptz.presets.map((preset) => [preset.token, preset]));
      const discoveredTokens = new Set(payload.presets.map((preset) => preset.token));
      const presets = [
        ...payload.presets.map((preset) => {
          const existing = existingByToken.get(preset.token);
          return {
            id: existing?.id ?? generatedId("preset"),
            token: preset.token,
            sourceName: preset.name,
            displayName: existing?.displayName || preset.name,
            visible: existing?.visible ?? true,
            available: true
          };
        }),
        ...camera.ptz.presets.filter((preset) => !discoveredTokens.has(preset.token)).map((preset) => ({ ...preset, available: false }))
      ];
      updateCameraPtz(index, { profileToken: payload.selectedProfileToken, presets });
      setPtzProfiles((current) => ({ ...current, [camera.id]: payload.profiles }));
      setPtzMessages((current) => ({
        ...current,
        [camera.id]: `${payload.device.manufacturer} ${payload.device.model}: ${payload.presets.length} preset(s) synchronized.`
      }));
    } catch (error) {
      setPtzMessages((current) => ({
        ...current,
        [camera.id]: error instanceof Error ? error.message : "ONVIF synchronization failed."
      }));
    } finally {
      setPtzBusy(null);
    }
  }

  function addScene() {
    setConfig((current) => ({
      ...current,
      ptzScenes: [...current.ptzScenes, { id: generatedId("scene"), name: "New Scene", actions: [] }]
    }));
  }

  function updateScene(index: number, patch: Partial<CameraConfigFile["ptzScenes"][number]>) {
    setConfig((current) => ({
      ...current,
      ptzScenes: current.ptzScenes.map((scene, sceneIndex) => (sceneIndex === index ? { ...scene, ...patch } : scene))
    }));
  }

  function addSceneAction(sceneIndex: number) {
    const scene = config.ptzScenes[sceneIndex];
    const camera = config.cameras.find(
      (candidate) => candidate.ptz.enabled && candidate.ptz.presets.some((preset) => preset.available) && !scene.actions.some((action) => action.cameraId === candidate.id)
    );
    if (!camera) {
      setMessage("No additional PTZ camera with an available preset can be added to this scene.");
      return;
    }
    const preset = camera.ptz.presets.find((candidate) => candidate.available)!;
    updateScene(sceneIndex, { actions: [...scene.actions, { cameraId: camera.id, presetId: preset.id }] });
  }

  function updateSceneAction(sceneIndex: number, actionIndex: number, patch: Partial<PtzSceneActionConfig>) {
    const scene = config.ptzScenes[sceneIndex];
    let nextPatch = patch;
    if (patch.cameraId) {
      const camera = config.cameras.find((candidate) => candidate.id === patch.cameraId);
      nextPatch = { ...patch, presetId: camera?.ptz.presets.find((preset) => preset.available)?.id ?? "" };
    }
    updateScene(sceneIndex, {
      actions: scene.actions.map((action, index) => (index === actionIndex ? { ...action, ...nextPatch } : action))
    });
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
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `Save failed: ${response.status}`);
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
            <h2>Stream Health</h2>
            <p>go2rtc starts streams on demand. An unwatched stream normally appears as Idle.</p>
          </div>
          <button className="icon-text-button" onClick={() => void loadDiagnostics()} type="button">
            <RefreshCcw size={16} />
            Refresh Diagnostics
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
            <span>Host Memory</span>
            <strong>{system ? `${system.memory.usedPercent.toFixed(1)}%` : "-"}</strong>
          </div>
          <div>
            <Activity size={18} />
            <span>Active Streams</span>
            <strong>{streamHealth?.streams.filter((stream) => stream.connected).length ?? 0}</strong>
          </div>
        </div>

        <div className="hardware-decode-note">
          These values are for the NVR host. If the kiosk stutters, open <code>chrome://gpu</code> on that kiosk and verify that
          Video Decode is hardware accelerated. Run the direct RTSP comparison on the same device.
        </div>

        {(diagnosticError || (streamHealth && !streamHealth.ok)) && (
          <div className="diagnostic-error">{diagnosticError || streamHealth?.error || "go2rtc diagnostics unavailable."}</div>
        )}

        <div className="stream-health-table">
          <div className="stream-health-row stream-health-head">
            <span>Camera / Profile</span>
            <span>Status</span>
            <span>Codec</span>
            <span>Connections</span>
            <span>Traffic</span>
          </div>
          {streamHealth?.streams.map((stream) => (
            <div className="stream-health-row" key={`${stream.cameraId}-${stream.profile}`}>
              <span>
                <strong>{stream.cameraName}</strong>
                <small>{stream.profile === "main" ? "Main" : "Sub"}</small>
              </span>
              <span>
                <span className={stream.connected ? "stream-state active" : "stream-state idle"}>
                  {stream.connected ? "Active" : "Idle"}
                </span>
              </span>
              <span>{stream.codecs.join(", ") || "-"}</span>
              <span>
                {stream.producerCount} producer / {stream.consumerCount} viewer(s)
              </span>
              <span>
                <small>Input {formatBytes(stream.inputBytes)} / {stream.inputPackets.toLocaleString("en-US")} pkt</small>
                <small>Output {formatBytes(stream.outputBytes)} / {stream.outputPackets.toLocaleString("en-US")} pkt</small>
              </span>
            </div>
          ))}
          {streamHealth?.streams.length === 0 && <div className="stream-health-empty">No enabled cameras.</div>}
          {!streamHealth && <div className="stream-health-empty">Loading diagnostics...</div>}
        </div>
      </section>

      <section className="camera-table" aria-label="Camera settings">
        <div className="table-head">
          <span>Enabled</span>
          <span>ID</span>
          <span>Name</span>
          <span>Main Stream</span>
          <span>Sub Stream</span>
          <span>PTZ</span>
          <span />
        </div>
        {config.cameras.map((camera, index) => (
          <Fragment key={`${camera.id}-${index}`}>
            <div className="table-row">
              <label className="toggle-cell">
                <input checked={camera.enabled} onChange={(event) => updateCamera(index, { enabled: event.target.checked })} type="checkbox" />
              </label>
              <input value={camera.id} onChange={(event) => updateCamera(index, { id: event.target.value })} />
              <input value={camera.name} onChange={(event) => updateCamera(index, { name: event.target.value })} />
              <input value={camera.mainRtsp} onChange={(event) => updateCamera(index, { mainRtsp: event.target.value })} />
              <input value={camera.subRtsp} onChange={(event) => updateCamera(index, { subRtsp: event.target.value })} />
              <label className="toggle-cell" title="Enable ONVIF PTZ presets">
                <input checked={camera.ptz.enabled} onChange={(event) => togglePtz(index, event.target.checked)} type="checkbox" />
              </label>
              <button className="icon-button danger" onClick={() => removeCamera(index)} title="Delete camera" type="button">
                <Trash2 size={18} />
              </button>
            </div>
            {camera.ptz.enabled && (
              <div className="camera-ptz-panel">
                <div className="ptz-panel-heading">
                  <div>
                    <h3><Video size={18} /> ONVIF PTZ</h3>
                    <p>Discover and recall presets already stored in this camera.</p>
                  </div>
                  <button className="icon-text-button" disabled={ptzBusy === camera.id} onClick={() => void synchronizePresets(index)} type="button">
                    <RefreshCcw className={ptzBusy === camera.id ? "spin" : ""} size={16} />
                    {camera.ptz.presets.length ? "Refresh Presets" : "Test Connection"}
                  </button>
                </div>
                <div className="ptz-connection-grid">
                  <label>Host / IP<input value={camera.ptz.host} onChange={(event) => updateCameraPtz(index, { host: event.target.value })} /></label>
                  <label>Port<input min="1" max="65535" type="number" value={camera.ptz.port} onChange={(event) => updateCameraPtz(index, { port: Number(event.target.value) })} /></label>
                  <label>Username<input autoComplete="off" value={camera.ptz.username} onChange={(event) => updateCameraPtz(index, { username: event.target.value })} /></label>
                  <label>Password<input autoComplete="new-password" type="password" value={camera.ptz.password} onChange={(event) => updateCameraPtz(index, { password: event.target.value })} /></label>
                  <label>PTZ Profile<select value={camera.ptz.profileToken} onChange={(event) => updateCameraPtz(index, { profileToken: event.target.value })}>
                    {!camera.ptz.profileToken && <option value="">Discover automatically</option>}
                    {(ptzProfiles[camera.id] ?? []).map((profile) => <option key={profile.token} value={profile.token}>{profile.name}</option>)}
                    {camera.ptz.profileToken && !(ptzProfiles[camera.id] ?? []).some((profile) => profile.token === camera.ptz.profileToken) && <option value={camera.ptz.profileToken}>Saved profile</option>}
                  </select></label>
                </div>
                {ptzMessages[camera.id] && <div className="ptz-inline-message">{ptzMessages[camera.id]}</div>}
                {camera.ptz.presets.length > 0 && <div className="preset-list">
                  <div className="preset-row preset-head"><span>Camera Preset</span><span>Display Name</span><span>Available</span><span>Show in Viewer</span></div>
                  {camera.ptz.presets.map((preset, presetIndex) => <div className="preset-row" key={preset.id}>
                    <span>{preset.sourceName || preset.token}</span>
                    <input value={preset.displayName} onChange={(event) => updateCameraPtz(index, { presets: camera.ptz.presets.map((item, itemIndex) => itemIndex === presetIndex ? { ...item, displayName: event.target.value } : item) })} />
                    <span className={preset.available ? "preset-available" : "preset-unavailable"}>{preset.available ? "Yes" : "No"}</span>
                    <label className="toggle-cell"><input checked={preset.visible} disabled={!preset.available} onChange={(event) => updateCameraPtz(index, { presets: camera.ptz.presets.map((item, itemIndex) => itemIndex === presetIndex ? { ...item, visible: event.target.checked } : item) })} type="checkbox" /></label>
                  </div>)}
                </div>}
              </div>
            )}
          </Fragment>
        ))}
      </section>

      <button className="add-camera" onClick={addCamera} type="button">
        <Plus size={18} />
        Add camera
      </button>

      <section className="scene-editor" aria-label="PTZ scene settings">
        <div className="scene-editor-heading"><div><h2>Multi-Camera Scenes</h2><p>Recall one preset per configured camera. Scenes do not change the Viewer layout.</p></div><button className="icon-text-button" onClick={addScene} type="button"><Plus size={18} />Add Scene</button></div>
        {config.ptzScenes.length === 0 && <div className="scene-empty">No PTZ scenes configured.</div>}
        {config.ptzScenes.map((scene, sceneIndex) => <article className="scene-card" key={scene.id}>
          <div className="scene-card-heading"><label>Scene Name<input value={scene.name} onChange={(event) => updateScene(sceneIndex, { name: event.target.value })} /></label><button className="icon-button danger" onClick={() => setConfig((current) => ({ ...current, ptzScenes: current.ptzScenes.filter((_, index) => index !== sceneIndex) }))} title="Delete scene" type="button"><Trash2 size={18} /></button></div>
          {scene.actions.map((action, actionIndex) => {
            const selectedCamera = config.cameras.find((camera) => camera.id === action.cameraId);
            const actionAvailable = selectedCamera?.ptz.enabled && selectedCamera.ptz.presets.some((preset) => preset.id === action.presetId && preset.available);
            return <div className="scene-action" key={`${action.cameraId}-${actionIndex}`}>
              <select value={action.cameraId} onChange={(event) => updateSceneAction(sceneIndex, actionIndex, { cameraId: event.target.value })}>{config.cameras.filter((camera) => camera.ptz.enabled && (!scene.actions.some((item, index) => index !== actionIndex && item.cameraId === camera.id))).map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select>
              <select value={action.presetId} onChange={(event) => updateSceneAction(sceneIndex, actionIndex, { presetId: event.target.value })}>{selectedCamera?.ptz.presets.filter((preset) => preset.available).map((preset) => <option key={preset.id} value={preset.id}>{preset.displayName}</option>)}</select>
              <button className="icon-button danger" onClick={() => updateScene(sceneIndex, { actions: scene.actions.filter((_, index) => index !== actionIndex) })} title="Remove scene action" type="button"><Trash2 size={16} /></button>
              {!actionAvailable && <span className="scene-action-warning">Select an available camera preset before saving.</span>}
            </div>;
          })}
          <button className="icon-text-button" onClick={() => addSceneAction(sceneIndex)} type="button"><Plus size={16} />Add Camera Preset</button>
        </article>)}
      </section>
    </main>
  );
}
