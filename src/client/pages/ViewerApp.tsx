import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Grid2X2, Grid3X3, Monitor, RefreshCcw, Rows3, Rows4 } from "lucide-react";
import type { CameraPublic, LayoutSize } from "../../shared/types";
import { WebRtcTile } from "../webrtc/WebRtcTile";

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

interface CameraApiResponse {
  cameras: CameraPublic[];
  go2rtc: {
    publicPort: string;
  };
}

interface ViewerState {
  layout: LayoutSize;
  selectedIds: string[];
}

const stateKey = "nvr.viewer.state";

function readStoredState(): ViewerState {
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

export function ViewerApp() {
  const [cameras, setCameras] = useState<CameraPublic[]>([]);
  const [go2rtcPort, setGo2rtcPort] = useState("1984");
  const [layout, setLayout] = useState<LayoutSize>(() => readStoredState().layout);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => readStoredState().selectedIds);
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
      setGo2rtcPort(data.go2rtc.publicPort || "1984");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Camera list could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void loadCameras();
  }, [loadCameras]);

  const slots = useMemo(() => {
    const availableIds = cameras.map((camera) => camera.id);
    const next = selectedIds.filter((id) => availableIds.includes(id)).slice(0, layout);

    for (const camera of cameras) {
      if (next.length >= layout) break;
      if (!next.includes(camera.id)) next.push(camera.id);
    }

    while (next.length < layout) next.push("");
    return next;
  }, [cameras, layout, selectedIds]);

  useEffect(() => {
    localStorage.setItem(stateKey, JSON.stringify({ layout, selectedIds: slots }));
  }, [layout, selectedIds, slots]);

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
    <main className="viewer-shell" onMouseMove={showMenu}>
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
            return (
              <button
                className={`tile-button ${activeSlot === index ? "active" : ""} ${dragOverSlot === index ? "drop-target" : ""}`}
                key={`${index}-${cameraId || "empty"}`}
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
                <WebRtcTile
                  animationKey={`${index}-${streamName || "empty"}`}
                  cameraName={camera?.name ?? `Slot ${index + 1}`}
                  go2rtcPort={go2rtcPort}
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
      </nav>
    </main>
  );
}
