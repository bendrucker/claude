import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The Stop gate type-checks the whole tree, every mod included, so one
// pathological rule/type pairing multiplies across all of them.
const BUDGET_MS = 30_000;

const ROOT = join(import.meta.dirname, "..", "..", "..");
const EDITED = join(ROOT, "plugins/github/mod/register.ts");

// Untyped mods are left out of the type check, which would hide exactly the
// cost this guards.
async function ready(): Promise<string | null> {
  if (!(await Bun.file(join(ROOT, "node_modules/oxlint/package.json")).exists())) {
    return "dependencies are not installed (`bun install`)";
  }
  const typed = await Bun.file(
    join(ROOT, "plugins/github/.claude-plugin/types/claude-code/index.d.ts"),
  ).exists();
  return typed ? null : "mod engine types are not generated (`bun run mod-types`)";
}

describe("ox Stop gate latency", () => {
  it(
    "gates a turn that edited a mod within budget",
    async () => {
      expect(await ready()).toBeNull();

      const dir = await mkdtemp(join(tmpdir(), "ox-perf-"));
      try {
        const transcript = join(dir, "transcript.jsonl");
        await Bun.write(
          transcript,
          JSON.stringify({
            type: "assistant",
            message: {
              content: [{ type: "tool_use", name: "Edit", input: { file_path: EDITED } }],
            },
          }),
        );
        const session = `ox-perf-${process.pid}`;

        const start = performance.now();
        const proc = Bun.spawn(["bun", join(import.meta.dirname, "index.ts")], {
          cwd: ROOT,
          env: { ...process.env, OX_EVENTS_DIR: dir },
          stdin: new Blob([
            JSON.stringify({
              hook_event_name: "Stop",
              session_id: session,
              transcript_path: transcript,
              cwd: ROOT,
              stop_hook_active: false,
            }),
          ]),
          stdout: "ignore",
          stderr: "ignore",
          timeout: BUDGET_MS,
        });
        await proc.exited;
        const elapsedMs = Math.round(performance.now() - start);

        // A hook that crashes still exits 0 and fast. The ox.stop record
        // proves the gate ran over the file.
        const eventsDir = join(dir, session);
        const [name] = await readdir(eventsDir).catch(() => []);
        const record: unknown =
          name == null ? null : JSON.parse(await Bun.file(join(eventsDir, name)).text());
        expect({ elapsedMs, killed: proc.signalCode != null, record }).toMatchObject({
          killed: false,
          record: { event_name: "ox.stop", attributes: { files: 1 } },
        });
        expect(elapsedMs).toBeLessThan(BUDGET_MS);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    BUDGET_MS + 10_000,
  );
});
