export type LayoutSize = 1 | 4 | 6 | 9 | 12 | 16;

export interface CameraConfig {
  id: string;
  name: string;
  enabled: boolean;
  mainRtsp: string;
  subRtsp: string;
}

export interface CameraPublic {
  id: string;
  name: string;
  enabled: boolean;
  streams: {
    main: string;
    sub: string;
  };
}

export interface CameraConfigFile {
  cameras: CameraConfig[];
}

export interface HealthResponse {
  ok: boolean;
  go2rtc: {
    ok: boolean;
    status?: number;
    error?: string;
  };
}

export interface ConfigSaveResponse {
  ok: boolean;
  restart: {
    ok: boolean;
    message: string;
  };
}

export interface RestartResponse {
  ok: boolean;
  restart: {
    ok: boolean;
    method: "go2rtc-api" | "docker-socket" | "docker-cli" | "none";
    message: string;
  };
}

export interface SystemInfoResponse {
  timestamp: string;
  host: {
    hostname: string;
    platform: string;
    arch: string;
    uptimeSeconds: number;
  };
  cpu: {
    usedPercent: number;
    cores: number;
    loadAverage: number[];
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPercent: number;
  };
  process: {
    uptimeSeconds: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
  };
  go2rtc: HealthResponse["go2rtc"];
}
