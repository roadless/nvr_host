import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StreamHealthItem, StreamHealthResponse } from "../shared/types.js";

const GO2RTC_BASE_URL = process.env.GO2RTC_BASE_URL ?? "http://localhost:1984";
const GO2RTC_CONTAINER_NAME = process.env.GO2RTC_CONTAINER_NAME ?? "nvr-go2rtc";
const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock";
const execFileAsync = promisify(execFile);

interface StreamHealthTarget {
  cameraId: string;
  cameraName: string;
  profile: "main" | "sub";
  streamName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function connections(stream: Record<string, unknown> | undefined, key: "producers" | "consumers") {
  const value = stream?.[key];
  return Array.isArray(value) ? value : [];
}

function collectCodecs(value: unknown, codecs = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectCodecs(item, codecs);
    return codecs;
  }
  if (!isRecord(value)) return codecs;

  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
    if ((normalizedKey === "codec" || normalizedKey === "codecname") && typeof item === "string") {
      const codec = item.trim().toUpperCase();
      if (codec && codec.length <= 32) codecs.add(codec);
    } else {
      collectCodecs(item, codecs);
    }
  }
  return codecs;
}

function sumMetric(value: unknown, metric: "bytes" | "packets"): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + sumMetric(item, metric), 0);
  if (!isRecord(value)) return 0;

  let total = 0;
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
    if (
      (normalizedKey === metric || normalizedKey.startsWith(metric) || normalizedKey.endsWith(metric)) &&
      typeof item === "number" &&
      Number.isFinite(item)
    ) {
      total += Math.max(0, item);
    } else if (typeof item === "object" && item !== null) {
      total += sumMetric(item, metric);
    }
  }
  return total;
}

function emptyStreamHealth(target: StreamHealthTarget): StreamHealthItem {
  return {
    ...target,
    connected: false,
    producerCount: 0,
    consumerCount: 0,
    codecs: [],
    inputBytes: 0,
    inputPackets: 0,
    outputBytes: 0,
    outputPackets: 0
  };
}

export async function readStreamHealth(targets: StreamHealthTarget[]): Promise<StreamHealthResponse> {
  try {
    const response = await fetch(`${GO2RTC_BASE_URL}/api/streams`, {
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) throw new Error(`go2rtc HTTP ${response.status}`);

    const payload: unknown = await response.json();
    if (!isRecord(payload)) throw new Error("go2rtc returned an invalid stream response");

    const streams = targets.map((target): StreamHealthItem => {
      const rawValue = payload[target.streamName];
      const rawStream = isRecord(rawValue) ? rawValue : undefined;
      const producers = connections(rawStream, "producers");
      const consumers = connections(rawStream, "consumers");
      return {
        ...target,
        connected: producers.length > 0,
        producerCount: producers.length,
        consumerCount: consumers.length,
        codecs: [...collectCodecs(producers)].sort(),
        inputBytes: sumMetric(producers, "bytes"),
        inputPackets: sumMetric(producers, "packets"),
        outputBytes: sumMetric(consumers, "bytes"),
        outputPackets: sumMetric(consumers, "packets")
      };
    });

    return {
      timestamp: new Date().toISOString(),
      ok: true,
      streams
    };
  } catch (error) {
    return {
      timestamp: new Date().toISOString(),
      ok: false,
      error: error instanceof Error ? error.message : "Unknown go2rtc stream error",
      streams: targets.map(emptyStreamHealth)
    };
  }
}

export async function checkGo2Rtc() {
  try {
    const response = await fetch(`${GO2RTC_BASE_URL}/api/streams`, {
      signal: AbortSignal.timeout(2000)
    });
    return {
      ok: response.ok,
      status: response.status
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown go2rtc error"
    };
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGo2Rtc(timeoutMs = 9000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const health = await checkGo2Rtc();
    if (health.ok) return true;
    await sleep(750);
  }
  return false;
}

async function restartViaGo2RtcApi(): Promise<{ ok: boolean; method: "go2rtc-api"; message: string }> {
  try {
    const response = await fetch(`${GO2RTC_BASE_URL}/api/restart`, {
      method: "POST",
      signal: AbortSignal.timeout(4000)
    });

    if (!response.ok) {
      return {
        ok: false,
        method: "go2rtc-api",
        message: `go2rtc API restart HTTP ${response.status} döndü.`
      };
    }

    const cameBack = await waitForGo2Rtc();
    return {
      ok: cameBack,
      method: "go2rtc-api",
      message: cameBack ? "go2rtc API üzerinden yeniden başlatıldı." : "go2rtc API restart aldı ama sağlık kontrolü dönmedi."
    };
  } catch (error) {
    return {
      ok: false,
      method: "go2rtc-api",
      message: `go2rtc API restart çalışmadı: ${error instanceof Error ? error.message : "bilinmeyen hata"}`
    };
  }
}

async function restartViaDockerSocket(): Promise<{ ok: boolean; method: "docker-socket"; message: string }> {
  return new Promise((resolve) => {
    const request = http.request(
      {
        socketPath: DOCKER_SOCKET_PATH,
        method: "POST",
        path: `/containers/${encodeURIComponent(GO2RTC_CONTAINER_NAME)}/restart?t=3`,
        headers: {
          Host: "docker"
        },
        timeout: 8000
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve({ ok: true, method: "docker-socket", message: "go2rtc Docker socket üzerinden yeniden başlatıldı." });
            return;
          }
          resolve({
            ok: false,
            method: "docker-socket",
            message: `Docker restart HTTP ${response.statusCode ?? "bilinmeyen"} döndü.`
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy();
      resolve({ ok: false, method: "docker-socket", message: "Docker socket restart zaman aşımına uğradı." });
    });

    request.on("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      const hint =
        code === "ENOENT"
          ? ` ${DOCKER_SOCKET_PATH} yok. Docker Compose ile çalıştırırken docker.sock volume mount edilmeli; npm start ile yerelde çalışırken bu beklenen bir durumdur.`
          : "";
      resolve({
        ok: false,
        method: "docker-socket",
        message: `go2rtc Docker socket üzerinden yeniden başlatılamadı: ${error.message}.${hint}`
      });
    });

    request.end();
  });
}

async function restartViaDockerCli(): Promise<{ ok: boolean; method: "docker-cli"; message: string }> {
  try {
    await execFileAsync("docker", ["restart", GO2RTC_CONTAINER_NAME], {
      timeout: 12000,
      windowsHide: true
    });

    const cameBack = await waitForGo2Rtc();
    return {
      ok: cameBack,
      method: "docker-cli",
      message: cameBack
        ? "go2rtc Docker CLI ile yeniden başlatıldı."
        : "Docker CLI restart çalıştı ama go2rtc sağlık kontrolü dönmedi."
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "bilinmeyen hata";
    return {
      ok: false,
      method: "docker-cli",
      message: `Docker CLI restart çalışmadı: ${message}`
    };
  }
}

export async function restartGo2Rtc(): Promise<{
  ok: boolean;
  method: "go2rtc-api" | "docker-socket" | "docker-cli" | "none";
  message: string;
}> {
  const apiRestart = await restartViaGo2RtcApi();
  if (apiRestart.ok) return apiRestart;

  const dockerRestart = await restartViaDockerSocket();
  if (dockerRestart.ok) return dockerRestart;

  const dockerCliRestart = await restartViaDockerCli();
  if (dockerCliRestart.ok) return dockerCliRestart;

  return {
    ok: false,
    method: "none",
    message: `${apiRestart.message} Docker socket fallback de başarısız: ${dockerRestart.message} Docker CLI fallback de başarısız: ${dockerCliRestart.message}`
  };
}
