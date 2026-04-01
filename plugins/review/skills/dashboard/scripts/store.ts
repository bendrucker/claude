#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { derivePaneName, derivePlatform, deriveRepo, type Platform } from "./parse";

export interface Review {
  url: string;
  title: string | null;
  repo: string;
  platform: Platform;
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
    platform: derivePlatform(params.url),
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

export function readState(): DashboardState {
  const path = statePath();
  if (!existsSync(path)) {
    return { reviews: [] };
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse state file ${path}: ${message}`);
  }
  if (
    typeof data !== "object" ||
    data === null ||
    !("reviews" in data) ||
    !Array.isArray((data as DashboardState).reviews)
  ) {
    throw new Error(`Invalid state file: ${path}`);
  }
  return data as DashboardState;
}

export function addReview(state: DashboardState, review: Review): void {
  if (state.reviews.some((r) => r.url === review.url)) {
    throw new Error(`Review already tracked: ${review.url}`);
  }
  state.reviews.push(review);
}

export function writeState(state: DashboardState): void {
  const dir = stateDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(statePath(), JSON.stringify(state, null, 2));
}
