import { mkdir, rename } from "node:fs/promises";
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

function stateDir(): string {
  const base = process.env.CLAUDE_PLUGIN_DATA;
  if (!base) {
    throw new Error("CLAUDE_PLUGIN_DATA is not set");
  }
  return join(base, "review-dashboard");
}

function statePath(): string {
  return join(stateDir(), "state.json");
}

export async function readState(): Promise<DashboardState> {
  const file = Bun.file(statePath());
  if (!(await file.exists())) {
    return { reviews: [] };
  }
  const data: unknown = await file.json();
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

export async function writeState(state: DashboardState): Promise<void> {
  await mkdir(stateDir(), { recursive: true });
  const path = statePath();
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, path);
}
