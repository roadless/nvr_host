import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Grid2X2, Grid3X3, Monitor, RefreshCcw, Rows3, Rows4 } from "lucide-react";
import type { CameraPublic, LayoutSize, PlaybackMode, ViewerMenuPosition } from "../../shared/types";
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

interface CameraApiResponse {
  cameras: CameraPublic[];
  viewer: {
    menuPosition: ViewerMenuPosition;
  };
  go2rtc: {
    publicPort: string;
    playbackMode: PlaybackMode;
  };
}

interface ViewerState {
  layout: LayoutSize;
  selectedIds: string[];
}

interface ViewerOptions {
  profile: string;
  stateKey: string;
  group: number;
  groups: number;
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
    groups
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
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("webrtc");
  const [layout, setLayout] = useState<LayoutSize>(() => initialState.layout);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialState.selectedIds);
  const [activeSlot, setActiveSlot] = useState(0);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const [menuVisible, setMenuVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      const response = await fetch("/api/cameras");
      if (!response.ok) throw new Error(`Camera list could not be loaded: ${response.status}`);
      const data = (await response.json()) as CameraApiResponse;
      setCameras(data.cameras);
      setMenuPosition(data.viewer?.menuPosition ?? "right");
      setGo2rtcPort(data.go2rtc.publicPort || "1984");
      setPlaybackMode(data.go2rtc.playbackMode || "webrtc");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Camera list could not be loaded.");
    }
  }, []);

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
