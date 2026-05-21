import { Activity, Cpu, HardDrive, RefreshCcw, Server, Video } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import type { SystemInfoResponse } from "../../shared/types";

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

function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}g ${hours}s`;
  if (hours > 0) return `${hours}s ${minutes}d`;
  return `${minutes}d`;
}

function Gauge({ label, value, tone }: { label: string; value: number; tone: "cpu" | "memory" }) {
  const percent = Math.max(0, Math.min(100, value));

  return (
    <div className={`metric-gauge ${tone}`} style={{ "--value": `${percent}%` } as CSSProperties}>
      <div className="gauge-ring">
        <span>{percent.toFixed(1)}%</span>
      </div>
      <p>{label}</p>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  detail
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="info-card">
      <div className="info-card-icon">
        <Icon size={20} />
      </div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

export function InfoApp() {
  const [system, setSystem] = useState<SystemInfoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadSystemInfo() {
    try {
      const response = await fetch("/api/system");
      if (!response.ok) throw new Error(`Sistem bilgisi alınamadı: HTTP ${response.status}`);
      setSystem((await response.json()) as SystemInfoResponse);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Sistem bilgisi alınamadı.");
    }
  }

  useEffect(() => {
    void loadSystemInfo();
    const timer = window.setInterval(() => void loadSystemInfo(), 2000);
    return () => window.clearInterval(timer);
  }, []);

  const updatedAt = useMemo(() => {
    if (!system) return "-";
    return new Intl.DateTimeFormat("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(system.timestamp));
  }, [system]);

  return (
    <main className="info-shell">
      <header className="info-header">
        <div>
          <h1>NVR Sistem Durumu</h1>
          <p>{system ? `${system.host.hostname} · ${system.host.platform}/${system.host.arch}` : "Yükleniyor"}</p>
        </div>
        <button className="icon-text-button" onClick={() => void loadSystemInfo()} type="button">
          <RefreshCcw size={18} />
          Yenile
        </button>
      </header>

      {error && <div className="info-error">{error}</div>}

      <section className="metric-overview" aria-label="Sistem kullanım özeti">
        <Gauge label="CPU Kullanımı" tone="cpu" value={system?.cpu.usedPercent ?? 0} />
        <Gauge label="RAM Kullanımı" tone="memory" value={system?.memory.usedPercent ?? 0} />
      </section>

      <section className="info-grid" aria-label="Sistem detayları">
        <InfoCard
          detail={`${system?.cpu.cores ?? 0} çekirdek · load ${system?.cpu.loadAverage.join(" / ") ?? "-"}`}
          icon={Cpu}
          label="CPU"
          value={`${system?.cpu.usedPercent.toFixed(1) ?? "0.0"}%`}
        />
        <InfoCard
          detail={`${formatBytes(system?.memory.usedBytes ?? 0)} / ${formatBytes(system?.memory.totalBytes ?? 0)}`}
          icon={HardDrive}
          label="RAM"
          value={`${system?.memory.usedPercent.toFixed(1) ?? "0.0"}%`}
        />
        <InfoCard
          detail={`RSS ${formatBytes(system?.process.rssBytes ?? 0)} · heap ${formatBytes(system?.process.heapUsedBytes ?? 0)}`}
          icon={Server}
          label="Node Process"
          value={formatDuration(system?.process.uptimeSeconds ?? 0)}
        />
        <InfoCard
          detail={system?.go2rtc.error ?? `HTTP ${system?.go2rtc.status ?? "-"}`}
          icon={Video}
          label="go2rtc"
          value={system?.go2rtc.ok ? "Aktif" : "Kontrol edilemiyor"}
        />
      </section>

      <footer className="info-footer">
        <span>Host uptime: {formatDuration(system?.host.uptimeSeconds ?? 0)}</span>
        <span>Son güncelleme: {updatedAt}</span>
      </footer>
    </main>
  );
}
