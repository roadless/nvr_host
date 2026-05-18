import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Grid2X2, Grid3X3, Monitor, RefreshCcw, Rows3, Rows4 } from "lucide-react";
import type { CameraPublic, LayoutSize } from "../../shared/types";
import { WebRtcTile } from "../webrtc/WebRtcTile";

const layouts: Array<{ size: LayoutSize; label: string; icon: typeof Monitor }> = [
  { size: 1, label: "1", icon: Monitor },
  { size: 4, label: "4", icon: Grid2X2 },
  { size: 6, label: "6", icon: Rows3 },
  { size: 9, label: "9", icon: Grid3X3 },
  { size: 12, label: "12", icon: Rows4 },
  { size: 16, label: "16", icon: Rows4 }
];

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
    if (![1, 4, 6, 9, 12, 16].includes(parsed.layout)) {
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
      if (!response.ok) throw new Error(`Kamera listesi alınamadı: HTTP ${response.status}`);
      const data = (await response.json()) as CameraApiResponse;
      setCameras(data.cameras);
      setGo2rtcPort(data.go2rtc.publicPort || "1984");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Kamera listesi alınamadı.");
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

  return (
    <main className="viewer-shell" onMouseMove={showMenu}>
      {error ? (
        <div className="viewer-message">
          <p>{error}</p>
          <button className="icon-text-button" onClick={() => void loadCameras()}>
            <RefreshCcw size={18} />
            Yenile
          </button>
        </div>
      ) : (
        <section className={`video-grid layout-${layout}`} aria-label="Kamera görüntüleri">
          {slots.map((cameraId, index) => {
            const camera = cameras.find((item) => item.id === cameraId);
            const streamName = camera ? (layout === 1 ? camera.streams.main : camera.streams.sub) : "";
            return (
              <button
                className={`tile-button ${activeSlot === index ? "active" : ""}`}
                key={`${index}-${cameraId || "empty"}`}
                onClick={() => setActiveSlot(index)}
                type="button"
              >
                <WebRtcTile
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
        <div className="layout-controls" aria-label="Grid düzeni">
          {layouts.map(({ size, label, icon: Icon }) => (
            <button
              className={layout === size ? "control-button selected" : "control-button"}
              key={size}
              onClick={() => changeLayout(size)}
              title={`${label} kamera`}
              type="button"
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="camera-strip" aria-label="Kamera seçimi">
          {cameras.map((camera) => (
            <button
              className={slots[activeSlot] === camera.id ? "camera-chip selected" : "camera-chip"}
              key={camera.id}
              onClick={() => assignCamera(camera.id)}
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
