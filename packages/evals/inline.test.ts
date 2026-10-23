import { describe, expect, test } from "bun:test";
import { inline } from "./inline";

const FILES: Record<string, string> = {
  "design/references/suite.md": "# Suite\n\nSee [native](native.md).\n",
  "design/references/native.md": "# Native\n",
  "hill-climb/references/harnesses.md":
    "# Harnesses\n\nBack to [suite](../../design/references/suite.md).\n",
};

const read = (path: string) => Promise.resolve(FILES[path]);

const SKILL = [
  "---",
  "name: evals:design",
  "---",
  "",
  "# Design",
  "",
  "Check [references/suite.md](references/suite.md) and [harnesses](../hill-climb/references/harnesses.md#shape).",
  "See [pydantic](https://ai.pydantic.dev/evals/), [below](#harness), and [gone](references/missing.md).",
  "",
].join("\n");

describe("inline", () => {
  test("appends each linked file once, following links between them", async () => {
    expect(await inline("design", SKILL, read)).toMatchInlineSnapshot(`
      "---
      name: evals:design
      ---

      Every file this skill links is appended below under its path.

      # Design

      Check [references/suite.md](references/suite.md) and [harnesses](../hill-climb/references/harnesses.md#shape).
      See [pydantic](https://ai.pydantic.dev/evals/), [below](#harness), and [gone](references/missing.md).

      ## \`references/suite.md\`

      # Suite

      See [native](native.md).

      ## \`../hill-climb/references/harnesses.md\`

      # Harnesses

      Back to [suite](../../design/references/suite.md).

      ## \`references/native.md\`

      # Native
      "
    `);
  });

  test("returns a skill with no relative links unchanged", async () => {
    const plain = "---\nname: x\n---\n\nSee [docs](https://example.com).\n";
    expect(await inline("x", plain, read)).toBe(plain);
  });
});
