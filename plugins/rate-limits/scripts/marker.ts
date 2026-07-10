import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Per-session dedup state, keyed to the current block via `resetsAt`. A changed
// resetsAt means the block rolled over, so a stale marker no longer suppresses:
// prediction re-arms on the fresh block. `alertedEtaMs` records the projected
// exhaustion the last alert fired at, so a materially earlier projection can
// re-alert while an unchanged one stays quiet.
export interface Marker {
  resetsAt: number;
  predictedBreach: boolean;
  alertedEtaMs: number | null;
}

export function markerPath(sessionId: string): string {
  const root = process.env.CLAUDE_RATE_LIMITS_MARKER_ROOT ?? "/tmp/claude";
  return join(root, sessionId, "rate-limits.json");
}

export async function readMarker(path: string): Promise<Marker | null> {
  try {
    return JSON.parse(await Bun.file(path).text()) as Marker;
  } catch {
    return null;
  }
}

export function markerChanged(prev: Marker | null, next: Marker): boolean {
  return (
    !prev ||
    prev.resetsAt !== next.resetsAt ||
    prev.predictedBreach !== next.predictedBreach ||
    prev.alertedEtaMs !== next.alertedEtaMs
  );
}

export async function writeMarker(path: string, marker: Marker): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(marker)}\n`);
}
