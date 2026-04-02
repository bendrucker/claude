import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { derivePaneName, deriveRepo } from "./parse";

export interface Review {
  url: string;
  title: string | null;
  repo: string;
  sessionId: string;
  paneId: string;
  paneName: string;
  repoPath: string;
  status: "active" | "completed";
  startedAt: string;
}

export interface DashboardState {
  reviews: Review[];
}

export function createReview(params: {
  url: string;
  title: string | null;
  sessionId: string;
  paneId: string;
  repoPath: string;
}): Review {
  return {
    ...params,
    repo: deriveRepo(params.url),
    paneName: derivePaneName(params.url),
    status: "active",
    startedAt: new Date().toISOString(),
  };
}

function resolveDataDir(dataDir?: string): string {
  const base = dataDir ?? process.env.CLAUDE_PLUGIN_DATA;
  if (!base) {
    throw new Error("dataDir is required (or set CLAUDE_PLUGIN_DATA)");
  }
  return base;
}

function stateDir(dataDir?: string): string {
  return join(resolveDataDir(dataDir), "review-dashboard");
}

function statePath(dataDir?: string): string {
  return join(stateDir(dataDir), "state.json");
}

export async function readState(dataDir?: string): Promise<DashboardState> {
  const file = Bun.file(statePath(dataDir));
  if (!(await file.exists())) {
    return { reviews: [] };
  }
  let data: unknown;
  try {
    data = await file.json();
  } catch (cause) {
    throw new Error(`Failed to parse state file: ${file.name}`, { cause });
  }
  if (!data || typeof data !== "object" || !Array.isArray((data as DashboardState).reviews)) {
    throw new Error(`Invalid state file: ${file.name}`);
  }
  return data as DashboardState;
}

export function addReview(state: DashboardState, review: Review): void {
  if (state.reviews.some((r) => r.url === review.url)) {
    throw new Error(`Review already tracked: ${review.url}`);
  }
  state.reviews.push(review);
}

export function removeReview(state: DashboardState, url: string): number {
  const before = state.reviews.length;
  state.reviews = state.reviews.filter((r) => r.url !== url);
  return before - state.reviews.length;
}

export function completeReview(state: DashboardState, paneId: string): boolean {
  const review = state.reviews.find((r) => r.status === "active" && r.paneId === paneId);
  if (!review) return false;
  review.status = "completed";
  return true;
}

export async function writeState(state: DashboardState, dataDir?: string): Promise<void> {
  await mkdir(stateDir(dataDir), { recursive: true });
  const path = statePath(dataDir);
  await Bun.write(path, JSON.stringify(state, null, 2));
}
