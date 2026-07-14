export type LayoutSize = 1 | 4 | 6 | 9 | 12 | 16 | 24 | 28 | 32 | 36;
export type ViewerMenuPosition = "bottom" | "top" | "right" | "left";
export type PlaybackMode = "auto" | "webrtc" | "mse";

export interface PtzPresetConfig {
  id: string;
  token: string;
  sourceName: string;
  displayName: string;
  visible: boolean;
  available: boolean;
}

export interface CameraPtzConfig {
  enabled: boolean;
  protocol: "onvif";
  host: string;
  port: number;
  username: string;
  password: string;
  profileToken: string;
  presets: PtzPresetConfig[];
}

export interface PtzSceneActionConfig {
  cameraId: string;
  presetId: string;
}

export interface PtzSceneConfig {
  id: string;
  name: string;
  actions: PtzSceneActionConfig[];
}

export interface CameraConfig {
  id: string;
  name: string;
  enabled: boolean;
  mainRtsp: string;
  subRtsp: string;
  ptz: CameraPtzConfig;
}

export interface CameraPublic {
  id: string;
  name: string;
  enabled: boolean;
  streams: {
    main: string;
    sub: string;
  };
  ptz?: {
    presets: Array<{ id: string; name: string }>;
  };
}

export interface CameraConfigFile {
  viewer: {
    menuPosition: ViewerMenuPosition;
    playbackMode: PlaybackMode;
  };
  cameras: CameraConfig[];
  ptzScenes: PtzSceneConfig[];
}

export interface PtzScenePublic {
  id: string;
  name: string;
}

export interface ViewerCameraResponse {
  cameras: CameraPublic[];
  viewer: CameraConfigFile["viewer"];
  go2rtc: {
    publicPort: string;
    playbackMode: PlaybackMode;
  };
  ptzAuthorized: boolean;
  ptzScenes: PtzScenePublic[];
}

export interface PtzDiscoveryRequest {
  host: string;
  port: number;
  username: string;
  password: string;
  profileToken?: string;
}

export interface PtzDiscoveryResponse {
  device: {
    manufacturer: string;
    model: string;
  };
  profiles: Array<{ token: string; name: string }>;
  selectedProfileToken: string;
  presets: Array<{ token: string; name: string }>;
}

export interface PtzCommandResult {
  cameraId: string;
  cameraName: string;
  presetId: string;
  presetName: string;
  ok: boolean;
  error?: string;
}

export interface PtzCommandResponse {
  ok: boolean;
  results: PtzCommandResult[];
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
