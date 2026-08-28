import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// The rate-limit contract Claude Code pipes to the statusline. `statusline.ts`
// mirrors it to `rl.json` (the writer); the session-limit hook reads it back.
export const RateLimitWindow = z.looseObject({
  used_percentage: z.number().optional().catch(undefined),
  resets_at: z.number().optional().catch(undefined),
});
export type RateLimitWindow = z.infer<typeof RateLimitWindow>;

export const RateLimits = z.looseObject({
  five_hour: RateLimitWindow.optional().catch(undefined),
  seven_day: RateLimitWindow.optional().catch(undefined),
});
export type RateLimits = z.infer<typeof RateLimits>;

export function expandTilde(target: string): string {
  return target.startsWith("~/") ? join(homedir(), target.slice(2)) : target;
}
