import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { anthropicChunkJudge, loadPrompt } from "./judge";
import { DEFAULT_GATE_RUNS, formatPassRate, passRates, runGate } from "./judge-run";

/**
 * Live-API half of the reproducibility gate. Not auto-discovered by `bun test`
 * (`*.integration.ts`), and every test self-skips without ANTHROPIC_API_KEY so
 * CI stays green without a key. Run locally:
 *
 *   bun test ./plugins/writing/skills/analyze/scripts/judge.integration.ts
 *
 * JUDGE_GATE_RUNS overrides how many times each tuple replays.
 */
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const runs = z.coerce
  .number()
  .int()
  .positive()
  .parse(process.env.JUDGE_GATE_RUNS ?? DEFAULT_GATE_RUNS);

describe("meaning judge (live API)", () => {
  test.skipIf(!hasKey)(
    "the committed reproducibility tuples hold on every run",
    async () => {
      const prompt = await loadPrompt();
      const judge = anthropicChunkJudge({ prompt: prompt.text });
      const rates = passRates(await runGate(judge, prompt.sha256, runs));
      for (const rate of rates) console.log(formatPassRate(rate));
      expect(rates.filter((r) => r.passes < r.runs)).toEqual([]);
    },
    120_000 * runs,
  );
});
