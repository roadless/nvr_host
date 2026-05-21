import fs from "node:fs/promises";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type { SystemInfoResponse } from "../shared/types.js";
import { checkGo2Rtc } from "./go2rtc.js";

interface CpuSnapshot {
  idle: number;
  total: number;
}

function cpuSnapshotFromCpus(): CpuSnapshot {
  let idle = 0;
  let total = 0;

  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }

  return { idle, total };
}

async function readProcCpuSnapshot(): Promise<CpuSnapshot | null> {
  try {
    const raw = await fs.readFile("/proc/stat", "utf8");
    const line = raw.split("\n")[0] ?? "";
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== "cpu") return null;

    const values = parts.slice(1).map((part) => Number(part));
    if (values.some((value) => Number.isNaN(value))) return null;

    const idle = (values[3] ?? 0) + (values[4] ?? 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    return { idle, total };
  } catch {
    return null;
  }
}

async function readCpuUsagePercent() {
  const first = (await readProcCpuSnapshot()) ?? cpuSnapshotFromCpus();
  await delay(120);
  const second = (await readProcCpuSnapshot()) ?? cpuSnapshotFromCpus();

  const idleDelta = second.idle - first.idle;
  const totalDelta = second.total - first.total;
  if (totalDelta <= 0) return 0;

  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

async function readMemoryInfo() {
  try {
    const raw = await fs.readFile("/proc/meminfo", "utf8");
    const values = new Map<string, number>();

    for (const line of raw.split("\n")) {
      const match = /^(\w+):\s+(\d+)/.exec(line);
      if (match) values.set(match[1], Number(match[2]) * 1024);
    }

    const total = values.get("MemTotal") ?? os.totalmem();
    const available = values.get("MemAvailable") ?? values.get("MemFree") ?? os.freemem();
    const free = available;
    const used = Math.max(0, total - available);

    return {
      totalBytes: total,
      usedBytes: used,
      freeBytes: free,
      usedPercent: total > 0 ? (used / total) * 100 : 0
    };
  } catch {
    const total = os.totalmem();
    const free = os.freemem();
    const used = Math.max(0, total - free);
    return {
      totalBytes: total,
      usedBytes: used,
      freeBytes: free,
      usedPercent: total > 0 ? (used / total) * 100 : 0
    };
  }
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function readSystemInfo(): Promise<SystemInfoResponse> {
  const [cpuPercent, memory, go2rtc] = await Promise.all([readCpuUsagePercent(), readMemoryInfo(), checkGo2Rtc()]);
  const processMemory = process.memoryUsage();

  return {
    timestamp: new Date().toISOString(),
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      uptimeSeconds: round(os.uptime(), 0)
    },
    cpu: {
      usedPercent: round(cpuPercent),
      cores: os.cpus().length,
      loadAverage: os.loadavg().map((value) => round(value, 2))
    },
    memory: {
      totalBytes: memory.totalBytes,
      usedBytes: memory.usedBytes,
      freeBytes: memory.freeBytes,
      usedPercent: round(memory.usedPercent)
    },
    process: {
      uptimeSeconds: round(process.uptime(), 0),
      rssBytes: processMemory.rss,
      heapUsedBytes: processMemory.heapUsed,
      heapTotalBytes: processMemory.heapTotal
    },
    go2rtc
  };
}
