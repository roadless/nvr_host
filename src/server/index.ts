import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  buildPublicCameras,
  readCameraConfig,
  validateCameraConfig,
  writeCameraConfig,
  writeGo2RtcConfig
} from "./config.js";
import { checkGo2Rtc, readStreamHealth, restartGo2Rtc } from "./go2rtc.js";
import { readSystemInfo } from "./system.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const adminUser = process.env.ADMIN_USER ?? "admin";
const adminPassword = process.env.ADMIN_PASSWORD ?? "change-me";
const publicGo2RtcPort = process.env.GO2RTC_PUBLIC_PORT ?? "1984";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = process.env.CLIENT_DIR ?? path.resolve(process.cwd(), "dist/client");
const indexHtml = path.join(clientDir, "index.html");

app.use(express.json({ limit: "1mb" }));

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Camera Server"');
    res.status(401).send("Authentication required.");
    return;
  }

  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  const user = separator >= 0 ? decoded.slice(0, separator) : "";
  const password = separator >= 0 ? decoded.slice(separator + 1) : "";

  if (!timingSafeEqual(user, adminUser) || !timingSafeEqual(password, adminPassword)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Camera Server"');
    res.status(401).send("Invalid credentials.");
    return;
  }

  next();
}

app.get("/api/health", async (_req, res) => {
  const go2rtc = await checkGo2Rtc();
  res.json({
    ok: go2rtc.ok,
    go2rtc
  });
});

app.get("/api/system", requireAdmin, async (_req, res, next) => {
  try {
    res.json(await readSystemInfo());
  } catch (error) {
    next(error);
  }
});

app.get("/api/stream-health", requireAdmin, async (_req, res, next) => {
  try {
    const config = await readCameraConfig();
    const publicCameras = buildPublicCameras(config);
    const targets = publicCameras.flatMap((camera) => [
      {
        cameraId: camera.id,
        cameraName: camera.name,
        profile: "main" as const,
        streamName: camera.streams.main
      },
      {
        cameraId: camera.id,
        cameraName: camera.name,
        profile: "sub" as const,
        streamName: camera.streams.sub
      }
    ]);
    res.json(await readStreamHealth(targets));
  } catch (error) {
    next(error);
  }
});

app.get("/api/cameras", async (_req, res, next) => {
  try {
    const config = await readCameraConfig();
    res.json({
      cameras: buildPublicCameras(config),
      viewer: config.viewer,
      go2rtc: {
        publicPort: publicGo2RtcPort,
        playbackMode: config.viewer.playbackMode
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/config", requireAdmin, async (_req, res, next) => {
  try {
    res.json(await readCameraConfig());
  } catch (error) {
    next(error);
  }
});

app.post("/api/config", requireAdmin, async (req, res, next) => {
  try {
    const config = validateCameraConfig(req.body);
    await writeCameraConfig(config);
    await writeGo2RtcConfig(config);
    const restart = await restartGo2Rtc();
    res.json({
      ok: true,
      restart
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/restart/go2rtc", requireAdmin, async (_req, res, next) => {
  try {
    const restart = await restartGo2Rtc();
    res.status(restart.ok ? 200 : 503).json({
      ok: restart.ok,
      restart
    });
  } catch (error) {
    next(error);
  }
});

app.get(["/admin", "/info"], requireAdmin, (_req, res) => {
  res.sendFile(indexHtml);
});

app.use(express.static(clientDir, { index: false }));

app.get(["/", "/viewer"], (_req, res) => {
  res.sendFile(indexHtml);
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  res.status(400).json({ error: message });
});

async function boot() {
  const config = await readCameraConfig();
  await writeGo2RtcConfig(config);

  app.listen(port, "0.0.0.0", () => {
    console.log(`NVR host listening on http://0.0.0.0:${port}`);
  });
}

boot().catch((error) => {
  console.error(error);
  process.exit(1);
});
