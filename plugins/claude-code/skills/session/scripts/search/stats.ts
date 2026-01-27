import { createReadStream } from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { isWithinDateRange, streamSessionFiles } from "./files";
import type { ProjectStats, SearchOptions } from "./types";

interface SessionData {
  projectPath: string | null;
  startTime: Date | null;
  endTime: Date | null;
}

async function collectSessionData(filePath: string): Promise<SessionData> {
  const data: SessionData = {
    projectPath: null,
    startTime: null,
    endTime: null,
  };

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (record.cwd && !data.projectPath) {
      data.projectPath = record.cwd as string;
    }

    if (record.timestamp) {
      const ts = new Date(record.timestamp as string);
      if (!data.startTime || ts < data.startTime) data.startTime = ts;
      if (!data.endTime || ts > data.endTime) data.endTime = ts;
    }
  }

  return data;
}

export async function getStats(options: SearchOptions = {}): Promise<ProjectStats[]> {
  const projectMap = new Map<
    string,
    {
      sessionCount: number;
      totalMinutes: number;
      firstSession: Date | null;
      lastSession: Date | null;
    }
  >();

  const filePromises: Promise<SessionData>[] = [];

  for await (const filePath of streamSessionFiles(options)) {
    filePromises.push(collectSessionData(filePath));
  }

  const sessions = await Promise.all(filePromises);

  for (const session of sessions) {
    if (!isWithinDateRange(session.startTime, options)) continue;
    if (!session.projectPath) continue;

    const existing = projectMap.get(session.projectPath) || {
      sessionCount: 0,
      totalMinutes: 0,
      firstSession: null,
      lastSession: null,
    };

    existing.sessionCount++;

    if (session.startTime && session.endTime) {
      existing.totalMinutes += Math.round(
        (session.endTime.getTime() - session.startTime.getTime()) / 60000,
      );
    }

    if (session.startTime) {
      if (!existing.firstSession || session.startTime < existing.firstSession) {
        existing.firstSession = session.startTime;
      }
      if (!existing.lastSession || session.startTime > existing.lastSession) {
        existing.lastSession = session.startTime;
      }
    }

    projectMap.set(session.projectPath, existing);
  }

  const stats: ProjectStats[] = [];
  for (const [projectPath, data] of projectMap) {
    stats.push({
      projectPath,
      projectName: path.basename(projectPath),
      sessionCount: data.sessionCount,
      totalMinutes: data.totalMinutes,
      firstSession: data.firstSession,
      lastSession: data.lastSession,
    });
  }

  return stats.sort((a, b) => b.totalMinutes - a.totalMinutes);
}
