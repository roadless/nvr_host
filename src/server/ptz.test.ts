import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { buildPublicCameras, buildPublicPtzScenes, validateCameraConfig } from "./config.js";
import { discoverPtz, isPtzControlAuthorized, recallCameraPreset, recallPtzScene, setOnvifClientFactory } from "./ptz.js";
import type { CameraConfig, CameraConfigFile } from "../shared/types.js";

function camera(id = "cam01"): CameraConfig {
  return {
    id,
    name: `Camera ${id}`,
    enabled: true,
    mainRtsp: "rtsp://private-user:private-password@10.0.0.10/main",
    subRtsp: "rtsp://private-user:private-password@10.0.0.10/sub",
    ptz: {
      enabled: true,
      protocol: "onvif",
      host: "10.0.0.10",
      port: 80,
      username: "private-user",
      password: "private-password",
      profileToken: "profile-token",
      presets: [{ id: "preset-one", token: "camera-token", sourceName: "1", displayName: "Dock", visible: true, available: true }]
    }
  };
}

function config(cameras = [camera()]): CameraConfigFile {
  return { viewer: { menuPosition: "right", playbackMode: "mse" }, cameras, ptzScenes: [] };
}

test.afterEach(() => setOnvifClientFactory());

test("Viewer PTZ authorization accepts only the configured non-empty token", () => {
  assert.equal(isPtzControlAuthorized("viewer-secret", "viewer-secret"), true);
  assert.equal(isPtzControlAuthorized("", "viewer-secret"), false);
  assert.equal(isPtzControlAuthorized("wrong-secret", "viewer-secret"), false);
  assert.equal(isPtzControlAuthorized("viewer-secret", ""), false);
});

test("legacy configurations receive disabled PTZ and an empty scene list", () => {
  const valid = validateCameraConfig({
    cameras: [{ id: "cam01", name: "Camera 01", enabled: true, mainRtsp: "rtsp://host/main", subRtsp: "rtsp://host/sub" }]
  });
  assert.equal(valid.viewer.playbackMode, "mse");
  assert.equal(valid.cameras[0].ptz.enabled, false);
  assert.deepEqual(valid.ptzScenes, []);
});

test("scene validation rejects duplicate cameras and unavailable presets", () => {
  const input = config();
  input.ptzScenes = [{ id: "scene-one", name: "Scene One", actions: [{ cameraId: "cam01", presetId: "preset-one" }, { cameraId: "cam01", presetId: "preset-one" }] }];
  assert.throws(() => validateCameraConfig(input), /more than once/);
  input.ptzScenes[0].actions = [{ cameraId: "cam01", presetId: "missing" }];
  assert.throws(() => validateCameraConfig(input), /missing or unavailable preset/);
});

test("public camera and scene responses redact all ONVIF and RTSP secrets", () => {
  const input = config();
  input.ptzScenes = [{ id: "arrival", name: "Arrival", actions: [{ cameraId: "cam01", presetId: "preset-one" }] }];
  const serialized = JSON.stringify({ cameras: buildPublicCameras(input, true), scenes: buildPublicPtzScenes(input) });
  for (const secret of ["10.0.0.10", "private-user", "private-password", "camera-token", "profile-token", "rtsp://"]) {
    assert.equal(serialized.includes(secret), false, `Public response exposed ${secret}`);
  }
  assert.match(serialized, /Dock/);
});

test("ONVIF discovery returns PTZ profiles and camera presets", async () => {
  setOnvifClientFactory(() => ({
    profiles: [{ $: { token: "profile-one" }, name: "Main", PTZConfiguration: {} }],
    activeSource: { profileToken: "profile-one" },
    async connect() {},
    async getDeviceInformation() { return { manufacturer: "Dahua", model: "Mock" }; },
    async getPresets() { return { "token-one": { name: "Preset 1" } }; },
    async gotoPreset() {}
  }));
  const result = await discoverPtz({ host: "camera", port: 80, username: "user", password: "pass" });
  assert.deepEqual(result.profiles, [{ token: "profile-one", name: "Main" }]);
  assert.deepEqual(result.presets, [{ token: "token-one", name: "Preset 1" }]);
});

test("preset recall and scenes use local ids while sending ONVIF camera tokens", async () => {
  const recalled: string[] = [];
  setOnvifClientFactory(() => ({
    async connect() {},
    async getDeviceInformation() { return {}; },
    async getPresets() { return {}; },
    async gotoPreset(options) { recalled.push(options.preset); }
  }));
  const first = camera("cam01");
  const second = camera("cam02");
  assert.equal((await recallCameraPreset(first, "preset-one")).ok, true);
  const results = await recallPtzScene({ id: "scene", name: "Scene", actions: [{ cameraId: first.id, presetId: "preset-one" }, { cameraId: second.id, presetId: "preset-one" }] }, [first, second]);
  assert.equal(results.every((result) => result.ok), true);
  assert.deepEqual(recalled, ["camera-token", "camera-token", "camera-token"]);
});

test("scenes continue after failures and run at most six camera commands concurrently", async () => {
  let active = 0;
  let peak = 0;
  setOnvifClientFactory((settings) => ({
    async connect() {},
    async getDeviceInformation() { return {}; },
    async getPresets() { return {}; },
    async gotoPreset() {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      if (settings.host === "failing-camera") throw new Error("ECONNREFUSED");
    }
  }));
  const cameras = Array.from({ length: 8 }, (_, index) => {
    const item = camera(`cam${index + 1}`);
    item.ptz.host = index === 3 ? "failing-camera" : `camera-${index + 1}`;
    return item;
  });
  const results = await recallPtzScene(
    { id: "all", name: "All", actions: cameras.map((item) => ({ cameraId: item.id, presetId: "preset-one" })) },
    cameras
  );
  assert.equal(peak, 6);
  assert.equal(results.filter((result) => result.ok).length, 7);
  assert.equal(results.filter((result) => !result.ok).length, 1);
  assert.equal(results[3].error, "The ONVIF service refused the connection.");
});

test("Admin and Viewer source contains no Turkish UI labels", async () => {
  const files = await Promise.all([fs.readFile("src/client/pages/AdminApp.tsx", "utf8"), fs.readFile("src/client/pages/ViewerApp.tsx", "utf8")]);
  const source = files.join("\n");
  assert.doesNotMatch(source, /[çğıöşüÇĞİÖŞÜ]|Kamera|Akış|Tanılama|Boşta|Etkin|Bellek/);
});
