import { homedir } from "node:os";
import { join } from "node:path";

// The rate-limit contract Claude Code pipes to the statusline. `statusline.ts`
// mirrors it to `rl.json` (the writer); the session-limit hook reads it back.
export interface RateLimitWindow {
  used_percentage?: number;
  resets_at?: number;
}

export interface RateLimits {
  five_hour?: RateLimitWindow;
  seven_day?: RateLimitWindow;
}

export function expandTilde(target: string): string {
  return target.startsWith("~/") ? join(homedir(), target.slice(2)) : target;
}
