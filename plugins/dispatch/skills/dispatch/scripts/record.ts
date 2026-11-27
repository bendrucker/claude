import type { Mux } from "./mux";
import type { Settings } from "./settings";
import type { Status } from "./status";

export type Checkout = "new-branch" | "existing-branch" | "existing-worktree";
export type Place = "pane" | "tab" | "bg";

export interface DispatchRecord {
  mux: Mux;
  // The Rex block or herdr pane running the session.
  target: string | null;
  host: string | null;
  name: string;
  title: string;
  place: Place;
  // A remote worktree's path is known only once its screen shows it.
  path: string | null;
  branch: string;
  session: string | null;
  status: Status;
  settings: string[];
  // Unknown for another host, whose worktree is prepared there.
  checkout?: Checkout;
  submoduleError?: string;
  // What a blocked Claude Code reported through Rex or `claude agents`.
  blockedKind?: string;
  blockedMessage?: string;
}

export interface DispatchResult {
  record: DispatchRecord;
  root: string;
}

// A partial record means a worktree exists that nobody owns.
export class DispatchError extends Error {
  readonly partial: DispatchRecord | null;
  root: string | null = null;

  constructor(message: string, partial: DispatchRecord | null) {
    super(message);
    this.name = "DispatchError";
    this.partial = partial;
  }
}

export function formatRecord(record: DispatchRecord): string {
  return JSON.stringify(record);
}

export interface DispatchOptions {
  repo: string;
  branch: string;
  prompt: string;
  name?: string | undefined;
  title?: string | undefined;
  // Defaults to the upstream remote's default branch, or origin/main without one.
  base?: string | undefined;
  timeout: number;
  mux: Mux;
  split?: boolean;
  rexSession?: string | undefined;
  rexBlock?: string | undefined;
  // A saved Rex host label. The launcher runs there with --exec.
  host?: string | undefined;
  settings?: Settings;
}

export function placeOf(options: Pick<DispatchOptions, "mux" | "split">): Place {
  if (options.mux === "bg") return "bg";
  return options.split === true ? "pane" : "tab";
}

export type WorktreeOptions = Pick<
  DispatchOptions,
  "repo" | "branch" | "base" | "timeout" | "settings"
>;
