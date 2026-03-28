#!/usr/bin/env bun

import { tmuxRun, tmuxSync } from "./tmux";

export interface TrackedPane {
  id: string;
  name: string;
  meta: Record<string, unknown>;
  created: string;
  alive: boolean;
}

export function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase();
}

function optionKey(name: string): string {
  return `@claude_pane_${sanitizeName(name)}`;
}

interface StoredPane {
  id: string;
  name: string;
  meta: Record<string, unknown>;
  created: string;
}

export function registerPane(name: string, id: string, meta: Record<string, unknown> = {}): void {
  const sanitized = sanitizeName(name);
  if (!sanitized) {
    throw new Error("Pane name must contain at least one alphanumeric character");
  }

  const entry: StoredPane = {
    id,
    name: sanitized,
    meta,
    created: new Date().toISOString(),
  };

  tmuxRun("set-option", "-g", optionKey(sanitized), JSON.stringify(entry));
}

export function unregisterPane(name: string): void {
  tmuxRun("set-option", "-gu", optionKey(sanitizeName(name)));
}

function getLivePaneIds(): Set<string> {
  const panes = tmuxSync("list-panes", "-a", "-F", "#{pane_id}");
  if (!panes) return new Set();
  return new Set(panes.split("\n"));
}

export function isPaneAlive(id: string, livePaneIds?: Set<string>): boolean {
  const ids = livePaneIds ?? getLivePaneIds();
  return ids.has(id);
}

export function getTrackedPane(name: string): TrackedPane | null {
  const raw = tmuxSync("show-options", "-gv", optionKey(sanitizeName(name)));
  if (!raw) return null;

  try {
    const stored: StoredPane = JSON.parse(raw);
    return {
      ...stored,
      alive: isPaneAlive(stored.id),
    };
  } catch {
    return null;
  }
}

export function getTrackedPanes(): TrackedPane[] {
  const output = tmuxSync("show-options", "-g");
  if (!output) return [];

  const livePaneIds = getLivePaneIds();
  const panes: TrackedPane[] = [];
  for (const line of output.split("\n")) {
    if (!line.startsWith("@claude_pane_")) continue;
    const match = line.match(/^@claude_pane_\S+ "?(.+?)"?$/);
    if (!match) continue;

    try {
      const stored: StoredPane = JSON.parse(match[1] as string);
      panes.push({
        ...stored,
        alive: isPaneAlive(stored.id, livePaneIds),
      });
    } catch {}
  }

  return panes;
}
