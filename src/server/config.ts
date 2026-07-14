import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type {
  CameraConfig,
  CameraConfigFile,
  CameraPtzConfig,
  CameraPublic,
  PlaybackMode,
  PtzScenePublic,
  ViewerMenuPosition
} from "../shared/types.js";

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const viewerMenuPositions = new Set<ViewerMenuPosition>(["bottom", "top", "right", "left"]);
const playbackModes = new Set<PlaybackMode>(["auto", "webrtc", "mse"]);
const defaultViewerConfig: CameraConfigFile["viewer"] = {
  menuPosition: "right",
  playbackMode: "mse"
};

export const paths = {
  cameraConfig: process.env.CAMERA_CONFIG_PATH ?? path.resolve("data/cameras.yaml"),
  go2rtcConfig: process.env.GO2RTC_CONFIG_PATH ?? path.resolve("data/go2rtc.yaml")
};

export function streamNames(cameraId: string) {
  return {
    main: `${cameraId}_main`,
    sub: `${cameraId}_sub`
  };
}

function firstStreamNameForUrl(streamsByUrl: Map<string, string>, streamName: string, rtspUrl: string) {
  const existingName = streamsByUrl.get(rtspUrl);
  if (existingName) return existingName;
  streamsByUrl.set(rtspUrl, streamName);
  return streamName;
}

function go2RtcWebRtcCandidates() {
  return (process.env.GO2RTC_WEBRTC_CANDIDATES ?? "")
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean);
}

export function buildPublicCameras(config: CameraConfigFile, includePtz = false): CameraPublic[] {
  const streamsByUrl = new Map<string, string>();

  return config.cameras
    .filter((camera) => camera.enabled)
    .map((camera) => {
      const names = streamNames(camera.id);
      const publicCamera: CameraPublic = {
        id: camera.id,
        name: camera.name,
        enabled: camera.enabled,
        streams: {
          main: firstStreamNameForUrl(streamsByUrl, names.main, camera.mainRtsp),
          sub: firstStreamNameForUrl(streamsByUrl, names.sub, camera.subRtsp)
        }
      };
      if (includePtz && camera.ptz.enabled) {
        publicCamera.ptz = {
          presets: camera.ptz.presets
            .filter((preset) => preset.visible && preset.available)
            .map((preset) => ({ id: preset.id, name: preset.displayName }))
        };
      }
      return publicCamera;
    });
}

export function buildPublicPtzScenes(config: CameraConfigFile): PtzScenePublic[] {
  return config.ptzScenes.map((scene) => ({ id: scene.id, name: scene.name }));
}

export async function readCameraConfig(): Promise<CameraConfigFile> {
  const raw = await fs.readFile(paths.cameraConfig, "utf8");
  const parsed = yaml.load(raw) as CameraConfigFile | undefined;
  return validateCameraConfig(parsed);
}

export async function writeCameraConfig(config: CameraConfigFile): Promise<void> {
  const valid = validateCameraConfig(config);
  const output = yaml.dump(valid, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  });
  await fs.mkdir(path.dirname(paths.cameraConfig), { recursive: true });
  await fs.writeFile(paths.cameraConfig, output, "utf8");
}

export async function writeGo2RtcConfig(config: CameraConfigFile): Promise<void> {
  const streams: Record<string, string> = {};
  const streamsByUrl = new Map<string, string>();

  for (const camera of config.cameras) {
    if (!camera.enabled) continue;
    const names = streamNames(camera.id);
    const mainStreamName = firstStreamNameForUrl(streamsByUrl, names.main, camera.mainRtsp);
    const subStreamName = firstStreamNameForUrl(streamsByUrl, names.sub, camera.subRtsp);
    if (mainStreamName === names.main) streams[names.main] = camera.mainRtsp;
    if (subStreamName === names.sub) streams[names.sub] = camera.subRtsp;
  }

  const candidates = go2RtcWebRtcCandidates();
  const go2rtcConfig = {
    api: {
      listen: ":1984",
      origin: "*"
    },
    rtsp: {
      listen: ":8554"
    },
    webrtc: {
      listen: ":8555",
      ...(candidates.length ? { candidates } : {})
    },
    streams
  };

  const output = yaml.dump(go2rtcConfig, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  });
  await fs.mkdir(path.dirname(paths.go2rtcConfig), { recursive: true });
  await fs.writeFile(paths.go2rtcConfig, output, "utf8");
}

export function validateCameraConfig(input: unknown): CameraConfigFile {
  if (!input || typeof input !== "object" || !Array.isArray((input as CameraConfigFile).cameras)) {
    throw new Error("Config must contain a cameras array.");
  }

  const rawViewer = (input as Partial<CameraConfigFile>).viewer;
  const viewer = { ...defaultViewerConfig };
  if (rawViewer !== undefined) {
    if (!rawViewer || typeof rawViewer !== "object") {
      throw new Error("viewer must be an object.");
    }
    const menuPosition = String(rawViewer.menuPosition ?? defaultViewerConfig.menuPosition);
    if (!viewerMenuPositions.has(menuPosition as ViewerMenuPosition)) {
      throw new Error("viewer.menuPosition must be one of: bottom, top, right, left.");
    }
    viewer.menuPosition = menuPosition as ViewerMenuPosition;
    const playbackMode = String(rawViewer.playbackMode ?? defaultViewerConfig.playbackMode);
    if (!playbackModes.has(playbackMode as PlaybackMode)) {
      throw new Error("viewer.playbackMode must be one of: auto, webrtc, mse.");
    }
    viewer.playbackMode = playbackMode as PlaybackMode;
  }

  const ids = new Set<string>();
  const cameras = (input as CameraConfigFile).cameras.map((camera, index) => {
    if (!camera || typeof camera !== "object") {
      throw new Error(`Camera at index ${index} must be an object.`);
    }

    const rawPtz = (camera as Partial<CameraConfig>).ptz;
    const ptz: CameraPtzConfig = {
      enabled: Boolean(rawPtz?.enabled),
      protocol: "onvif",
      host: String(rawPtz?.host ?? "").trim(),
      port: Number(rawPtz?.port ?? 80),
      username: String(rawPtz?.username ?? "").trim(),
      password: String(rawPtz?.password ?? ""),
      profileToken: String(rawPtz?.profileToken ?? "").trim(),
      presets: []
    };

    if (!Number.isInteger(ptz.port) || ptz.port < 1 || ptz.port > 65535) {
      throw new Error(`Camera ${index + 1} PTZ port must be an integer between 1 and 65535.`);
    }
    if (ptz.host.length > 253 || /[/:]/.test(ptz.host)) {
      throw new Error(`Camera ${index + 1} PTZ host must be an IP address or hostname without a scheme or path.`);
    }
    if (ptz.enabled && (!ptz.host || !ptz.username)) {
      throw new Error(`Camera ${index + 1} PTZ requires a host and username.`);
    }

    const presetIds = new Set<string>();
    const presetTokens = new Set<string>();
    const rawPresets = Array.isArray(rawPtz?.presets) ? rawPtz.presets : [];
    ptz.presets = rawPresets.map((preset, presetIndex) => {
      const normalizedPreset = {
        id: String(preset?.id ?? "").trim(),
        token: String(preset?.token ?? "").trim(),
        sourceName: String(preset?.sourceName ?? "").trim(),
        displayName: String(preset?.displayName ?? preset?.sourceName ?? "").trim(),
        visible: preset?.visible !== false,
        available: preset?.available !== false
      };
      if (!ID_PATTERN.test(normalizedPreset.id)) {
        throw new Error(`Camera ${index + 1} preset ${presetIndex + 1} has an invalid id.`);
      }
      if (!normalizedPreset.token || !normalizedPreset.displayName) {
        throw new Error(`Camera ${index + 1} preset ${presetIndex + 1} requires a token and display name.`);
      }
      if (presetIds.has(normalizedPreset.id) || presetTokens.has(normalizedPreset.token)) {
        throw new Error(`Camera ${index + 1} contains duplicate preset ids or tokens.`);
      }
      presetIds.add(normalizedPreset.id);
      presetTokens.add(normalizedPreset.token);
      return normalizedPreset;
    });

    const normalized: CameraConfig = {
      id: String(camera.id ?? "").trim(),
      name: String(camera.name ?? "").trim(),
      enabled: Boolean(camera.enabled),
      mainRtsp: String(camera.mainRtsp ?? "").trim(),
      subRtsp: String(camera.subRtsp ?? "").trim(),
      ptz
    };

    if (!normalized.id || !ID_PATTERN.test(normalized.id)) {
      throw new Error(`Camera ${index + 1} has an invalid id. Use letters, numbers, dash, or underscore.`);
    }
    if (ids.has(normalized.id)) {
      throw new Error(`Duplicate camera id: ${normalized.id}`);
    }
    if (!normalized.name) {
      throw new Error(`Camera ${normalized.id} must have a name.`);
    }
    if (!normalized.mainRtsp.startsWith("rtsp://") && !normalized.mainRtsp.startsWith("rtsps://")) {
      throw new Error(`Camera ${normalized.id} mainRtsp must start with rtsp:// or rtsps://.`);
    }
    if (!normalized.subRtsp.startsWith("rtsp://") && !normalized.subRtsp.startsWith("rtsps://")) {
      throw new Error(`Camera ${normalized.id} subRtsp must start with rtsp:// or rtsps://.`);
    }

    ids.add(normalized.id);
    return normalized;
  });

  const cameraById = new Map(cameras.map((camera) => [camera.id, camera]));
  const sceneIds = new Set<string>();
  const rawScenes = Array.isArray((input as Partial<CameraConfigFile>).ptzScenes)
    ? (input as Partial<CameraConfigFile>).ptzScenes!
    : [];
  const ptzScenes = rawScenes.map((scene, sceneIndex) => {
    const id = String(scene?.id ?? "").trim();
    const name = String(scene?.name ?? "").trim();
    if (!ID_PATTERN.test(id) || sceneIds.has(id)) {
      throw new Error(`PTZ scene ${sceneIndex + 1} has an invalid or duplicate id.`);
    }
    if (!name) throw new Error(`PTZ scene ${id} requires a name.`);
    if (!Array.isArray(scene.actions) || scene.actions.length < 1 || scene.actions.length > 36) {
      throw new Error(`PTZ scene ${id} must contain between 1 and 36 actions.`);
    }

    const sceneCameraIds = new Set<string>();
    const actions = scene.actions.map((action, actionIndex) => {
      const cameraId = String(action?.cameraId ?? "").trim();
      const presetId = String(action?.presetId ?? "").trim();
      const camera = cameraById.get(cameraId);
      if (!camera?.ptz.enabled) {
        throw new Error(`PTZ scene ${id} action ${actionIndex + 1} references a missing or disabled PTZ camera.`);
      }
      if (sceneCameraIds.has(cameraId)) {
        throw new Error(`PTZ scene ${id} contains camera ${cameraId} more than once.`);
      }
      const preset = camera.ptz.presets.find((item) => item.id === presetId);
      if (!preset?.available) {
        throw new Error(`PTZ scene ${id} references a missing or unavailable preset on camera ${cameraId}.`);
      }
      sceneCameraIds.add(cameraId);
      return { cameraId, presetId };
    });
    sceneIds.add(id);
    return { id, name, actions };
  });

  return { viewer, cameras, ptzScenes };
}
