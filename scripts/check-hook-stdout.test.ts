import { describe, expect, it } from "bun:test";
import { invokesBunDirectly } from "./check-hook-stdout";

// Hook command strings embed bare ${CLAUDE_PLUGIN_ROOT}; build it here so the
// fixtures read like real commands without tripping noTemplateCurlyInString.
const ROOT = `$\{CLAUDE_PLUGIN_ROOT}`;
const PREK = 'PREK_HOME="$CLAUDE_PROJECT_DIR/.prek"';
const STOP = '"$CLAUDE_PROJECT_DIR/.claude/hooks/stop"';

describe("invokesBunDirectly", () => {
  const direct = [
    `bun "${ROOT}/scripts/check.ts"`,
    `bun "${ROOT}/hooks/numbering.ts" write`,
    "bun ~/.claude/hooks/worktree",
    `${PREK} bun ${STOP}`,
  ];
  for (const command of direct) {
    it(`flags bare bun: ${command}`, () => {
      expect(invokesBunDirectly(command)).toBe(true);
    });
  }

  const wrapped = [
    `sh "${ROOT}/hooks/run.sh" "${ROOT}/scripts/check.ts"`,
    `sh "${ROOT}/hooks/run.sh" "${ROOT}/hooks/numbering.ts" write`,
    "sh ~/.claude/hooks/run.sh ~/.claude/hooks/worktree",
    `${PREK} sh "$CLAUDE_PROJECT_DIR/.claude/hooks/run.sh" ${STOP}`,
    "/bin/sh -c '[ -x \"$HOME/.vibe-island/bin/vibe-island-bridge\" ]'",
  ];
  for (const command of wrapped) {
    it(`allows run.sh wrapper: ${command}`, () => {
      expect(invokesBunDirectly(command)).toBe(false);
    });
  }

  it("ignores undefined commands", () => {
    expect(invokesBunDirectly(undefined)).toBe(false);
  });
});
