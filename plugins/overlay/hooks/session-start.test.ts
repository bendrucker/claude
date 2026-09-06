import { describe, expect, test } from "bun:test";
import type { ClaudeState, OverlayStatus } from "../scripts/link";
import { warning } from "./session-start";

function makeStatus(overrides: Partial<OverlayStatus> = {}): OverlayStatus {
  return {
    checkout: "/Users/ben/src/raycast/extensions",
    key: "raycast/extensions",
    overlay: "/Users/ben/.claude-repo/overlays/raycast/extensions/.claude",
    exists: true,
    state: { kind: "missing" },
    ...overrides,
  };
}

describe("warning", () => {
  test("names the repository and the checkout", () => {
    expect(warning(makeStatus())).toMatchInlineSnapshot(
      `"An overlay exists for raycast/extensions but /Users/ben/src/raycast/extensions/.claude is not linked. Run claude-overlay link there, then restart the session to pick up its settings."`,
    );
  });

  test.each<{ name: string; state: ClaudeState }>([
    { name: "no .claude", state: { kind: "missing" } },
    { name: "adoptable .claude", state: { kind: "adoptable", entries: ["settings.local.json"] } },
    { name: "occupied .claude", state: { kind: "occupied", reason: "it is a file" } },
  ])("warns on $name", ({ state }) => {
    expect(warning(makeStatus({ state }))).not.toBeNull();
  });

  test.each<{ name: string; status: OverlayStatus }>([
    { name: "already linked", status: makeStatus({ state: { kind: "linked" } }) },
    { name: "no overlay", status: makeStatus({ exists: false, state: null }) },
    {
      name: "no remote",
      status: makeStatus({ key: null, overlay: null, exists: false, state: null }),
    },
  ])("stays silent on $name", ({ status }) => {
    expect(warning(status)).toBeNull();
  });
});
