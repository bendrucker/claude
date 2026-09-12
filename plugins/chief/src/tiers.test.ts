import { describe, expect, test } from "bun:test";
import { CREDENTIAL_PATTERN, tier, type Event } from "./tiers";

describe("tier table", () => {
  test.each([
    [
      "credential",
      { hook: "Notification", notificationType: "idle_prompt", message: "please authenticate" },
      { kind: "credential", tier: "now", releaseAt: "immediate" },
    ],
    [
      "destructive",
      {
        hook: "PermissionRequest",
        toolName: "Bash",
        toolInput: { command: "git push --force origin main" },
      },
      { kind: "destructive", tier: "now", releaseAt: "immediate" },
    ],
    [
      "permission_prompt",
      { hook: "Notification", notificationType: "permission_prompt", message: "waiting" },
      { kind: "permission_prompt", tier: "boundary", releaseAt: "grace-permission" },
    ],
    [
      "ask_user",
      { hook: "PostToolUse", toolName: "AskUserQuestion" },
      { kind: "ask_user", tier: "boundary", releaseAt: "boundary" },
    ],
    [
      "idle",
      { hook: "Notification", notificationType: "idle_prompt", message: "idle" },
      { kind: "idle", tier: "digest", releaseAt: "digest" },
    ],
    [
      "stop",
      { hook: "Stop" },
      { kind: "stop", tier: "digest", releaseAt: "digest" },
    ],
    [
      "dispatch",
      { hook: "dispatch" },
      { kind: "dispatch", tier: "boundary", releaseAt: "immediate" },
    ],
  ] as const)("%s", (_name, event, expected) => {
    expect(tier(event as Event)).toMatchObject(expected);
  });

  test("a non-destructive permission request tiers to nothing", () => {
    const event: Event = { hook: "PermissionRequest", toolName: "Bash", toolInput: { command: "ls" } };
    expect(tier(event)).toBeNull();
  });

  test("a non-AskUserQuestion PostToolUse tiers to nothing", () => {
    expect(tier({ hook: "PostToolUse", toolName: "Edit" })).toBeNull();
  });

  test("a plain notification tiers to nothing", () => {
    const event: Event = { hook: "Notification", notificationType: "other", message: "hi" };
    expect(tier(event)).toBeNull();
  });
});

describe("credential regex", () => {
  test.each([
    "please login again",
    "credential expired",
    "token expired for this session",
    "authenticate to continue",
  ])("matches %s", (message) => {
    expect(CREDENTIAL_PATTERN.test(message)).toBe(true);
  });

  test("does not match a near miss", () => {
    expect(CREDENTIAL_PATTERN.test("your session token was refreshed")).toBe(false);
  });
});
