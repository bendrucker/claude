import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SG_EXTENSIONS } from "./numbering";

type HookCommand = { type: string; command: string; if?: string };
type HookEntry = { matcher: string; hooks: HookCommand[] };

const config = (await Bun.file(join(import.meta.dirname, "hooks.json")).json()) as {
  hooks: { PreToolUse: HookEntry[] };
};

const preToolUse = config.hooks.PreToolUse;

function scriptName(command: string): string {
  return command.match(/hooks\/([\w-]+)\.ts/)?.[1] ?? command;
}

describe("PreToolUse gating", () => {
  test("matchers and if conditions", () => {
    const view = preToolUse.map((entry) => ({
      matcher: entry.matcher,
      hooks: entry.hooks.map((hook) => ({
        script: scriptName(hook.command),
        if: hook.if ?? null,
      })),
    }));
    expect(view).toMatchInlineSnapshot(`
      [
        {
          "hooks": [
            {
              "if": "Write(**/*.md)|Write(**/*.markdown)|Write(**/*.go)|Write(**/*.js)|Write(**/*.jsx)|Write(**/*.mjs)|Write(**/*.cjs)|Write(**/*.ts)|Write(**/*.tsx)|Write(**/*.mts)|Write(**/*.cts)|Write(**/*.py)",
              "script": "numbering",
            },
            {
              "if": "Write(**/*.md)",
              "script": "headings",
            },
            {
              "if": null,
              "script": "check-tropes",
            },
          ],
          "matcher": "Write",
        },
        {
          "hooks": [
            {
              "if": "Edit(**/*.md)|Edit(**/*.markdown)|Edit(**/*.go)|Edit(**/*.js)|Edit(**/*.jsx)|Edit(**/*.mjs)|Edit(**/*.cjs)|Edit(**/*.ts)|Edit(**/*.tsx)|Edit(**/*.mts)|Edit(**/*.cts)|Edit(**/*.py)",
              "script": "numbering",
            },
            {
              "if": "Edit(**/*.md)",
              "script": "headings",
            },
            {
              "if": null,
              "script": "check-tropes",
            },
          ],
          "matcher": "Edit",
        },
        {
          "hooks": [
            {
              "if": null,
              "script": "check-tropes",
            },
          ],
          "matcher": "MultiEdit",
        },
        {
          "hooks": [
            {
              "if": "Bash(gh *)|Bash(glab *)|Bash(linear *)",
              "script": "check-tropes",
            },
          ],
          "matcher": "Bash",
        },
      ]
    `);
  });

  test("numbering matcher gates cover exactly the extensions numbering.ts scans", () => {
    const gates = preToolUse
      .flatMap((entry) => entry.hooks)
      .filter((hook) => hook.command.includes("numbering.ts"));
    expect(gates).toHaveLength(2);
    for (const hook of gates) {
      const extensions = [...(hook.if ?? "").matchAll(/\*\*\/\*\.(\w+)\)/g)].map(
        (match) => match[1],
      );
      expect(new Set(extensions)).toEqual(new Set(["md", "markdown", ...SG_EXTENSIONS]));
    }
  });
});
