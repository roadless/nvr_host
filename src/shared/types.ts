export type LayoutSize = 1 | 4 | 6 | 9 | 12 | 16 | 24 | 28 | 32 | 36;
export type ViewerMenuPosition = "bottom" | "top" | "right" | "left";
export type PlaybackMode = "auto" | "webrtc" | "mse";

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
  viewer: {
    menuPosition: ViewerMenuPosition;
    playbackMode: PlaybackMode;
  };
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

export interface StreamHealthItem {
  cameraId: string;
  cameraName: string;
  profile: "main" | "sub";
  streamName: string;
  connected: boolean;
  producerCount: number;
  consumerCount: number;
  codecs: string[];
  inputBytes: number;
  inputPackets: number;
  outputBytes: number;
  outputPackets: number;
}

export interface StreamHealthResponse {
  timestamp: string;
  ok: boolean;
  error?: string;
  streams: StreamHealthItem[];
}
