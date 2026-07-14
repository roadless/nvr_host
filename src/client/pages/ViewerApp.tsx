import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Grid2X2, Grid3X3, Monitor, RefreshCcw, Rows3, Rows4 } from "lucide-react";
import type { CameraPublic, LayoutSize, PlaybackMode, PtzCommandResponse, PtzScenePublic, ViewerCameraResponse, ViewerMenuPosition } from "../../shared/types";
import { StreamTile } from "../webrtc/StreamTile";

const layouts: Array<{ size: LayoutSize; label: string; icon: typeof Monitor }> = [
  { size: 1, label: "1", icon: Monitor },
  { size: 4, label: "4", icon: Grid2X2 },
  { size: 6, label: "6", icon: Rows3 },
  { size: 9, label: "9", icon: Grid3X3 },
  { size: 12, label: "12", icon: Rows4 },
  { size: 16, label: "16", icon: Rows4 },
  { size: 24, label: "24", icon: Rows4 },
  { size: 28, label: "28", icon: Rows4 },
  { size: 32, label: "32", icon: Rows4 },
  { size: 36, label: "36", icon: Grid3X3 }
];

const layoutSizes: LayoutSize[] = layouts.map((layout) => layout.size);
const defaultStateKey = "nvr.viewer.state";

interface ViewerState {
  layout: LayoutSize;
  selectedIds: string[];
}

interface ViewerOptions {
  profile: string;
  stateKey: string;
  group: number;
  groups: number;
  ptzToken: string;
}

function readIntParam(params: URLSearchParams, name: string, fallback: number, min: number, max: number) {
  const raw = params.get(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeProfile(raw: string | null) {
  const normalized = (raw ?? "default").trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48);
  return normalized || "default";
}

function readViewerOptions(): ViewerOptions {
  const params = new URLSearchParams(window.location.search);
  const profile = normalizeProfile(params.get("profile"));
  const groups = readIntParam(params, "groups", 1, 1, 99);
  const group = readIntParam(params, "group", 1, 1, groups);

  return {
    profile,
    stateKey: profile === "default" ? defaultStateKey : `${defaultStateKey}.${profile}`,
    group,
    groups,
    ptzToken: params.get("ptzToken") ?? ""
  };
}

function readStoredState(stateKey: string): ViewerState {
  try {
    const raw = localStorage.getItem(stateKey);
    if (!raw) return { layout: 4, selectedIds: [] };
    const parsed = JSON.parse(raw) as ViewerState;
    if (!layoutSizes.includes(parsed.layout)) {
      return { layout: 4, selectedIds: [] };
    }
    return {
      layout: parsed.layout,
      selectedIds: Array.isArray(parsed.selectedIds) ? parsed.selectedIds : []
    };
  } catch {
    return { layout: 4, selectedIds: [] };
  }
}

function getAutoFillCameras(cameras: CameraPublic[], options: ViewerOptions) {
  if (options.groups <= 1) return cameras;
  const groupSize = Math.ceil(cameras.length / options.groups);
  const start = (options.group - 1) * groupSize;
  return cameras.slice(start, start + groupSize);
}

export function ViewerApp() {
  const viewerOptions = useMemo(() => readViewerOptions(), []);
  const initialState = useMemo(() => readStoredState(viewerOptions.stateKey), [viewerOptions.stateKey]);
  const [cameras, setCameras] = useState<CameraPublic[]>([]);
  const [go2rtcPort, setGo2rtcPort] = useState("1984");
  const [menuPosition, setMenuPosition] = useState<ViewerMenuPosition>("right");
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("mse");
  const [layout, setLayout] = useState<LayoutSize>(() => initialState.layout);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialState.selectedIds);
  const [activeSlot, setActiveSlot] = useState(0);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const [menuVisible, setMenuVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ptzAuthorized, setPtzAuthorized] = useState(false);
  const [ptzScenes, setPtzScenes] = useState<PtzScenePublic[]>([]);
  const [ptzBusy, setPtzBusy] = useState<string | null>(null);
  const [notification, setNotification] = useState("");
  const hideTimer = useRef<number | null>(null);

  const showMenu = useCallback(() => {
    setMenuVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setMenuVisible(false), 3500);
  }, []);

  useEffect(() => {
    showMenu();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [showMenu]);

  const loadCameras = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/cameras", {
        headers: viewerOptions.ptzToken ? { "X-PTZ-Token": viewerOptions.ptzToken } : undefined
      });
      if (!response.ok) throw new Error(`Camera list could not be loaded: ${response.status}`);
      const data = (await response.json()) as ViewerCameraResponse;
      setCameras(data.cameras);
      setMenuPosition(data.viewer?.menuPosition ?? "right");
      setGo2rtcPort(data.go2rtc.publicPort || "1984");
      setPlaybackMode(data.go2rtc.playbackMode || "mse");
      setPtzAuthorized(data.ptzAuthorized);
      setPtzScenes(data.ptzScenes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Camera list could not be loaded.");
    }
  }, [viewerOptions.ptzToken]);

  useEffect(() => {
    void loadCameras();
  }, [loadCameras]);

  const autoFillCameras = useMemo(() => getAutoFillCameras(cameras, viewerOptions), [cameras, viewerOptions]);

  const slots = useMemo(() => {
    const availableIds = cameras.map((camera) => camera.id);
    const next = selectedIds.filter((id) => availableIds.includes(id)).slice(0, layout);

    for (const camera of autoFillCameras) {
      if (next.length >= layout) break;
      if (!next.includes(camera.id)) next.push(camera.id);
    }

    while (next.length < layout) next.push("");
    return next;
  }, [autoFillCameras, cameras, layout, selectedIds]);

  useEffect(() => {
    localStorage.setItem(viewerOptions.stateKey, JSON.stringify({ layout, selectedIds: slots }));
  }, [layout, selectedIds, slots, viewerOptions.stateKey]);

  const liveSlotCount = useMemo(() => slots.filter(Boolean).length, [slots]);

  function changeLayout(nextLayout: LayoutSize) {
    setLayout(nextLayout);
    setActiveSlot(0);
    setSelectedIds((current) => {
      const ids = current.length ? current : slots;
      return ids.slice(0, nextLayout);
    });
  }

  function assignCamera(cameraId: string) {
    setSelectedIds((current) => {
      const next = [...slots];
      next[activeSlot] = cameraId;
      return next.length ? next : current;
    });
  }

  function assignCameraToSlot(cameraId: string, slotIndex: number) {
    setSelectedIds((current) => {
      const next = [...slots];
      next[slotIndex] = cameraId;
      return next.length ? next : current;
    });
    setActiveSlot(slotIndex);
  }

  function handleCameraDragStart(event: DragEvent<HTMLButtonElement>, cameraId: string) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", cameraId);
    event.dataTransfer.setData("application/x-nvr-camera-id", cameraId);
  }

  function handleSlotDrop(event: DragEvent<HTMLButtonElement>, slotIndex: number) {
    event.preventDefault();
    const cameraId = event.dataTransfer.getData("application/x-nvr-camera-id") || event.dataTransfer.getData("text/plain");
    setDragOverSlot(null);
    if (!cameraId || !cameras.some((camera) => camera.id === cameraId)) return;
    assignCameraToSlot(cameraId, slotIndex);
  }

  async function runPtz(path: string, busyKey: string) {
    setPtzBusy(busyKey);
    setNotification("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "X-PTZ-Token": viewerOptions.ptzToken } });
      const payload = (await response.json()) as PtzCommandResponse & { error?: string };
      if (!payload.results) throw new Error(payload.error || `PTZ command failed: ${response.status}`);
      const succeeded = payload.results.filter((result) => result.ok).length;
      const failed = payload.results.length - succeeded;
      if (failed === 0) {
        setNotification(payload.results.length === 1 ? `${payload.results[0].presetName} recalled for ${payload.results[0].cameraName}.` : "Scene recalled successfully.");
      } else if (succeeded > 0) {
        setNotification(`Scene completed: ${succeeded} succeeded, ${failed} failed.`);
      } else {
        setNotification(payload.results[0]?.error || "PTZ command failed.");
      }
    } catch (commandError) {
      setNotification(commandError instanceof Error ? commandError.message : "PTZ command failed.");
    } finally {
      setPtzBusy(null);
    }
  }

  const activeCamera = cameras.find((camera) => camera.id === slots[activeSlot]);

  return (
    <main className={`viewer-shell menu-${menuPosition} ${menuVisible ? "menu-open" : ""}`} onMouseMove={showMenu}>
      {error ? (
        <div className="viewer-message">
          <p>{error}</p>
          <button className="icon-text-button" onClick={() => void loadCameras()}>
            <RefreshCcw size={18} />
            Refresh
          </button>
        </div>
      ) : (
        <section className={`video-grid layout-${layout}`} aria-label="Camera grid">
          {slots.map((cameraId, index) => {
            const camera = cameras.find((item) => item.id === cameraId);
            const streamName = camera ? (layout === 1 ? camera.streams.main : camera.streams.sub) : "";
            const status = camera ? "live" : "empty";

            return (
              <button
                className={`tile-button ${activeSlot === index ? "active" : ""} ${dragOverSlot === index ? "drop-target" : ""}`}
                key={index}
                onClick={() => setActiveSlot(index)}
                onDragLeave={() => setDragOverSlot((current) => (current === index ? null : current))}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setDragOverSlot(index);
                }}
                onDrop={(event) => handleSlotDrop(event, index)}
                type="button"
              >
                <StreamTile
                  animationKey={`${index}-${streamName || status}`}
                  cameraName={camera?.name ?? `Slot ${index + 1}`}
                  go2rtcPort={go2rtcPort}
                  playbackMode={playbackMode}
                  status={status}
                  streamName={streamName}
                />
              </button>
            );
          })}
        </section>
      )}

      <nav className={`bottom-menu ${menuVisible ? "visible" : ""}`} aria-label="Viewer controls">
        <div className="layout-controls" aria-label="Grid layout">
          {layouts.map(({ size, label, icon: Icon }) => (
            <button
              className={layout === size ? "control-button selected" : "control-button"}
              key={size}
              onClick={() => changeLayout(size)}
              title={`${label} ${size === 1 ? "camera" : "cameras"}`}
              type="button"
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="camera-strip" aria-label="Camera selection">
          {cameras.map((camera) => (
            <button
              className={slots[activeSlot] === camera.id ? "camera-chip selected" : "camera-chip"}
              draggable
              key={camera.id}
              onClick={() => assignCamera(camera.id)}
              onDragStart={(event) => handleCameraDragStart(event, camera.id)}
              title={camera.name}
              type="button"
            >
              {camera.name}
            </button>
          ))}
        </div>

        {ptzAuthorized && ((activeCamera?.ptz?.presets.length ?? 0) > 0 || ptzScenes.length > 0) && (
          <div className="ptz-controls" aria-label="PTZ controls">
            {(activeCamera?.ptz?.presets.length ?? 0) > 0 && <div className="ptz-control-row"><strong>{activeCamera?.name} Presets</strong><div className="ptz-button-strip">{activeCamera?.ptz?.presets.map((preset) => <button className="camera-chip" disabled={ptzBusy !== null} key={preset.id} onClick={() => void runPtz(`/api/ptz/cameras/${encodeURIComponent(activeCamera.id)}/presets/${encodeURIComponent(preset.id)}`, `preset:${activeCamera.id}:${preset.id}`)} type="button">{ptzBusy === `preset:${activeCamera.id}:${preset.id}` ? "Moving…" : preset.name}</button>)}</div></div>}
            {ptzScenes.length > 0 && <div className="ptz-control-row"><strong>Scenes</strong><div className="ptz-button-strip">{ptzScenes.map((scene) => <button className="camera-chip scene-chip" disabled={ptzBusy !== null} key={scene.id} onClick={() => void runPtz(`/api/ptz/scenes/${encodeURIComponent(scene.id)}`, `scene:${scene.id}`)} type="button">{ptzBusy === `scene:${scene.id}` ? "Moving…" : scene.name}</button>)}</div></div>}
          </div>
        )}

        {notification && <div className="viewer-notification" role="status">{notification}</div>}

        <div className="viewer-load-status" aria-label="Live load status">
          <span>
            Live {liveSlotCount} / {slots.length}
          </span>
          <span>{playbackMode.toUpperCase()}</span>
          {viewerOptions.profile !== "default" && <span>{viewerOptions.profile}</span>}
        </div>
      </nav>
    </main>
  );
}
