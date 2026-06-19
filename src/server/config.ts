import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { CameraConfig, CameraConfigFile, CameraPublic, ViewerMenuPosition } from "../shared/types.js";

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const viewerMenuPositions = new Set<ViewerMenuPosition>(["bottom", "top", "right", "left"]);
const defaultViewerConfig: CameraConfigFile["viewer"] = {
  menuPosition: "right"
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

export function buildPublicCameras(config: CameraConfigFile): CameraPublic[] {
  const streamsByUrl = new Map<string, string>();

  return config.cameras
    .filter((camera) => camera.enabled)
    .map((camera) => {
      const names = streamNames(camera.id);
      return {
        id: camera.id,
        name: camera.name,
        enabled: camera.enabled,
        streams: {
          main: firstStreamNameForUrl(streamsByUrl, names.main, camera.mainRtsp),
          sub: firstStreamNameForUrl(streamsByUrl, names.sub, camera.subRtsp)
        }
      };
    });
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
  }

  const ids = new Set<string>();
  const cameras = (input as CameraConfigFile).cameras.map((camera, index) => {
    if (!camera || typeof camera !== "object") {
      throw new Error(`Camera at index ${index} must be an object.`);
    }

    const normalized: CameraConfig = {
      id: String(camera.id ?? "").trim(),
      name: String(camera.name ?? "").trim(),
      enabled: Boolean(camera.enabled),
      mainRtsp: String(camera.mainRtsp ?? "").trim(),
      subRtsp: String(camera.subRtsp ?? "").trim()
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

  return { viewer, cameras };
}
