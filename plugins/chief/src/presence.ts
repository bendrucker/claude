import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Presence } from "./types";

export const PRESENCE_PATH = join(homedir(), ".local", "state", "chief", "presence.json");

export async function read(path: string = PRESENCE_PATH): Promise<Presence> {
  const presence: Presence = {
    focus: null,
    busyUntil: null,
    activeNode: "studio",
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(presence, null, 2)}\n`);
  return presence;
}
