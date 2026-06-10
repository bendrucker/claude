import { describe, expect, test } from "bun:test";
import { anthropicChunkJudge, loadPrompt } from "./judge";
import { runGate } from "./judge-run";

/**
 * Live-API half of the reproducibility gate. Not auto-discovered by `bun test`
 * (`*.integration.ts`), and every test self-skips without ANTHROPIC_API_KEY so
 * CI stays green without a key. Run locally:
 *
 *   bun test plugins/writing/skills/analyze/scripts/judge.integration.ts
 */
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

describe("meaning judge (live API)", () => {
  test.skipIf(!hasKey)(
    "the committed reproducibility tuples hold at temperature 0",
    async () => {
      const prompt = await loadPrompt();
      const judge = anthropicChunkJudge({ prompt: prompt.text });
      const results = await runGate(judge, prompt.sha256);
      const failures = results.filter((r) => !r.pass);
      expect(failures).toEqual([]);
    },
    120_000,
  );
});
