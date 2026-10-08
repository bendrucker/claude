import { describe, expect, test } from "bun:test";
import { anthropicChunkJudge, loadPrompt } from "./judge";
import { type GateResult, runGate } from "./judge-run";

/**
 * Live-API half of the reproducibility gate. Not auto-discovered by `bun test`
 * (`*.integration.ts`), and every test self-skips without ANTHROPIC_API_KEY so
 * CI stays green without a key. Run locally:
 *
 *   bun test ./plugins/writing/skills/analyze/scripts/judge.integration.ts
 *
 * The judge samples at temperature 1, so the gate replays JUDGE_GATE_RUNS
 * times (default 5) and prints each fixture's pass rate before asserting.
 */
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const runs = Number(process.env.JUDGE_GATE_RUNS ?? 5);

describe("meaning judge (live API)", () => {
  test.skipIf(!hasKey)(
    "the committed reproducibility tuples hold on every run",
    async () => {
      const prompt = await loadPrompt();
      const judge = anthropicChunkJudge({ prompt: prompt.text });
      const all: GateResult[][] = [];
      for (let i = 0; i < runs; i++) {
        // oxlint-disable-next-line no-await-in-loop -- runs serialize to stay inside the rate limit.
        all.push(await runGate(judge, prompt.sha256));
      }
      const failures = all.flat().filter((r) => !r.pass);
      for (const id of new Set(all.flat().map((r) => r.id))) {
        const results = all.flat().filter((r) => r.id === id);
        const missed = results.flatMap((r) => r.mismatches.map((m) => m.criterion));
        console.log(
          `${id.padEnd(36)} ${results.filter((r) => r.pass).length}/${results.length}${missed.length > 0 ? `  missed: ${[...new Set(missed)].join(", ")}` : ""}`,
        );
      }
      expect(failures).toEqual([]);
    },
    120_000 * runs,
  );
});
