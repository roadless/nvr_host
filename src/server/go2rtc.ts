import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const GO2RTC_BASE_URL = process.env.GO2RTC_BASE_URL ?? "http://localhost:1984";
const GO2RTC_CONTAINER_NAME = process.env.GO2RTC_CONTAINER_NAME ?? "nvr-go2rtc";
const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock";
const execFileAsync = promisify(execFile);

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
