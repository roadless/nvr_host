import crypto from "node:crypto";
import { Cam } from "onvif/promises/index.js";
import type {
  CameraConfig,
  PtzCommandResult,
  PtzDiscoveryRequest,
  PtzDiscoveryResponse,
  PtzSceneConfig
} from "../shared/types.js";

const COMMAND_TIMEOUT_MS = 7000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SCENE_CONCURRENCY = 6;

export function isPtzControlAuthorized(supplied: string, expected: string) {
  if (!supplied || !expected) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

interface OnvifClient {
  connect(): Promise<void>;
  getDeviceInformation(): Promise<Record<string, unknown>>;
  getPresets(options?: { profileToken?: string }): Promise<Record<string, unknown>>;
  gotoPreset(options: { profileToken?: string; preset: string }): Promise<void>;
  profiles?: unknown[];
  activeSource?: { profileToken?: string };
}

type OnvifClientFactory = (settings: PtzDiscoveryRequest) => OnvifClient;

const defaultFactory: OnvifClientFactory = (settings) =>
  new Cam({
    hostname: settings.host,
    port: settings.port,
    username: settings.username,
    password: settings.password,
    timeout: COMMAND_TIMEOUT_MS,
    preserveAddress: false
  });

let clientFactory = defaultFactory;
const clientCache = new Map<string, { fingerprint: string; expiresAt: number; client: OnvifClient }>();

export function setOnvifClientFactory(factory?: OnvifClientFactory) {
  clientFactory = factory ?? defaultFactory;
  clientCache.clear();
}

export function clearPtzClientCache() {
  clientCache.clear();
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), COMMAND_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = "") {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return fallback;
}

function profileToken(profile: unknown) {
  if (!isRecord(profile)) return "";
  const attributes = isRecord(profile.$) ? profile.$ : {};
  return stringValue(attributes.token || profile.token);
}

function profileName(profile: unknown, token: string) {
  if (!isRecord(profile)) return token;
  return stringValue(profile.name || profile.Name, token);
}

function isPtzProfile(profile: unknown) {
  if (!isRecord(profile)) return false;
  return Boolean(profile.ptzConfiguration || profile.PTZConfiguration);
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed?\s*out|timeout/i.test(message)) return "The ONVIF camera did not respond before the timeout.";
  if (/401|unauthori[sz]ed|authentication|not authorized/i.test(message)) return "The ONVIF camera rejected the credentials.";
  if (/ECONNREFUSED/i.test(message)) return "The ONVIF service refused the connection.";
  if (/ENETUNREACH|EHOSTUNREACH|ENOTFOUND/i.test(message)) return "The ONVIF camera is unreachable.";
  if (/PTZ|preset|profile/i.test(message)) return "The camera rejected the ONVIF PTZ request.";
  return "The ONVIF request failed.";
}

async function connect(settings: PtzDiscoveryRequest) {
  const client = clientFactory(settings);
  try {
    await withTimeout(client.connect(), "ONVIF connection timed out");
    return client;
  } catch (error) {
    throw new Error(safeError(error));
  }
}

function normalizePresets(raw: Record<string, unknown>) {
  return Object.entries(raw).map(([token, value]) => {
    const preset = isRecord(value) ? value : {};
    const name = stringValue(preset.name || preset.Name, `Preset ${token}`).trim() || `Preset ${token}`;
    return { token, name };
  });
}

export async function discoverPtz(settings: PtzDiscoveryRequest): Promise<PtzDiscoveryResponse> {
  const client = await connect(settings);
  const profiles = (client.profiles ?? [])
    .filter(isPtzProfile)
    .map((profile) => {
      const token = profileToken(profile);
      return { token, name: profileName(profile, token) };
    })
    .filter((profile) => profile.token);
  if (!profiles.length) throw new Error("The camera does not expose an ONVIF PTZ profile.");

  const selectedProfileToken =
    profiles.find((profile) => profile.token === settings.profileToken)?.token ??
    client.activeSource?.profileToken ??
    profiles[0].token;
  let rawPresets: Record<string, unknown>;
  try {
    rawPresets = await withTimeout(client.getPresets({ profileToken: selectedProfileToken }), "ONVIF preset discovery timed out");
  } catch (error) {
    throw new Error(safeError(error));
  }

  let deviceInfo: Record<string, unknown> = {};
  try {
    deviceInfo = await withTimeout(client.getDeviceInformation(), "ONVIF device information timed out");
  } catch {
    // Device information is optional for PTZ operation.
  }

  return {
    device: {
      manufacturer: stringValue(deviceInfo.manufacturer || deviceInfo.Manufacturer, "Unknown"),
      model: stringValue(deviceInfo.model || deviceInfo.Model, "Unknown")
    },
    profiles,
    selectedProfileToken,
    presets: normalizePresets(rawPresets)
  };
}

function fingerprint(camera: CameraConfig) {
  return crypto
    .createHash("sha256")
    .update([camera.ptz.host, camera.ptz.port, camera.ptz.username, camera.ptz.password, camera.ptz.profileToken].join("\0"))
    .digest("hex");
}

async function cameraClient(camera: CameraConfig) {
  const nextFingerprint = fingerprint(camera);
  const cached = clientCache.get(camera.id);
  if (cached && cached.fingerprint === nextFingerprint && cached.expiresAt > Date.now()) return cached.client;
  const client = await connect(camera.ptz);
  clientCache.set(camera.id, { fingerprint: nextFingerprint, expiresAt: Date.now() + CACHE_TTL_MS, client });
  return client;
}

export async function recallCameraPreset(camera: CameraConfig, presetId: string): Promise<PtzCommandResult> {
  const preset = camera.ptz.presets.find((item) => item.id === presetId && item.available);
  const base = {
    cameraId: camera.id,
    cameraName: camera.name,
    presetId,
    presetName: preset?.displayName ?? presetId
  };
  if (!camera.ptz.enabled || !preset) return { ...base, ok: false, error: "The camera or preset is not available." };

  try {
    const client = await cameraClient(camera);
    await withTimeout(
      client.gotoPreset({ profileToken: camera.ptz.profileToken || undefined, preset: preset.token }),
      "ONVIF preset command timed out"
    );
    return { ...base, ok: true };
  } catch (error) {
    return { ...base, ok: false, error: safeError(error) };
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

export async function recallPtzScene(scene: PtzSceneConfig, cameras: CameraConfig[]) {
  const camerasById = new Map(cameras.map((camera) => [camera.id, camera]));
  return mapWithConcurrency(scene.actions, SCENE_CONCURRENCY, async (action) => {
    const camera = camerasById.get(action.cameraId);
    if (!camera) {
      return {
        cameraId: action.cameraId,
        cameraName: action.cameraId,
        presetId: action.presetId,
        presetName: action.presetId,
        ok: false,
        error: "The configured camera no longer exists."
      } satisfies PtzCommandResult;
    }
    return recallCameraPreset(camera, action.presetId);
  });
}
