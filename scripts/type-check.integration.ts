import { expect, it } from "bun:test";
import { join } from "node:path";

// The commit gate type-checks the whole tree, every mod included, so one
// pathological rule/type pairing multiplies across all of them.
const BUDGET_MS = 30_000;

const ROOT = join(import.meta.dirname, "..");

it(
  "type-checks the whole tree within budget",
  async () => {
    // Untyped mods are left out of the type check, which would hide exactly
    // the cost this guards.
    const typed = await Bun.file(
      join(ROOT, "plugins/github/.claude-plugin/types/claude-code/index.d.ts"),
    ).exists();
    expect(typed ? null : "mod engine types are not generated (`bun run mod-types`)").toBeNull();

    const start = performance.now();
    const proc = Bun.spawn(["bun", join(import.meta.dirname, "type-check.ts")], {
      cwd: ROOT,
      stdout: "ignore",
      stderr: "ignore",
      timeout: BUDGET_MS,
    });
    const code = await proc.exited;
    const elapsedMs = Math.round(performance.now() - start);

    expect({ code, killed: proc.signalCode != null }).toEqual({ code: 0, killed: false });
    expect(elapsedMs).toBeLessThan(BUDGET_MS);
  },
  BUDGET_MS + 10_000,
);
