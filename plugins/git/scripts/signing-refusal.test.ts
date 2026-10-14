import { describe, expect, test } from "bun:test";
import type { PostToolUseFailureHookInput } from "@anthropic-ai/claude-agent-sdk";
import { CONTEXT, hasSigningRefusal, processInput } from "./signing-refusal";

// Captured from git 2.56 and OpenSSH 10.3 against an agent that refused to sign.
const REFUSAL = [
  "error: Signing file /tmp/.git_signing_buffer_tmpkIn3PZ",
  "Couldn't sign message (signer): agent refused operation?",
  "Signing /tmp/.git_signing_buffer_tmpkIn3PZ failed: agent refused operation?",
  "",
].join("\n");

const SIGNING_FAILURES = {
  commit: `${REFUSAL}\nfatal: failed to write commit object`,
  tag: `${REFUSAL}\nerror: unable to sign the tag\nThe tag message has been left in .git/TAG_EDITMSG`,
  rebase: `${REFUSAL}\nerror: failed to write commit object\nCould not apply 944a53d... # b`,
};

const SSH_TRANSPORT_REFUSAL = [
  'sign_and_send_pubkey: signing failed for ED25519 "SHA256:abc" from agent: agent refused operation',
  "git@github.com: Permission denied (publickey).",
  "fatal: Could not read from remote repository.",
].join("\n");

function mockInput(command: string, error: string): PostToolUseFailureHookInput {
  return {
    session_id: "test",
    hook_event_name: "PostToolUseFailure",
    tool_name: "Bash",
    tool_input: { command },
    tool_use_id: "test",
    error,
    transcript_path: "/tmp/transcript.json",
    cwd: "/nonexistent",
  };
}

describe("hasSigningRefusal", () => {
  test.each<{ name: string; output: string; expected: boolean }>([
    { name: "commit", output: SIGNING_FAILURES.commit, expected: true },
    { name: "tag", output: SIGNING_FAILURES.tag, expected: true },
    { name: "rebase", output: SIGNING_FAILURES.rebase, expected: true },
    { name: "ssh transport refusal", output: SSH_TRANSPORT_REFUSAL, expected: false },
    {
      name: "missing signing key",
      output:
        'error: No private key found for public key "key.pub"?\n\nfatal: failed to write commit object',
      expected: false,
    },
    { name: "empty output", output: "", expected: false },
  ])("$name", ({ output, expected }) => {
    expect(hasSigningRefusal(output)).toBe(expected);
  });
});

describe("processInput", () => {
  test("tells the model to stop and ask for approval", () => {
    expect(CONTEXT).toMatchInlineSnapshot(`
      "Git could not sign: the SSH agent refused the signature. An agent that requires approval for each signature refuses when nobody responds, so an unattended retry fails the same way.
      Stop and ask the user to approve the signing request on their agent, then retry once they confirm. Keep signing enabled."
    `);
    expect(processInput(mockInput("git commit -m x", SIGNING_FAILURES.commit))).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUseFailure", additionalContext: CONTEXT },
    });
  });

  test("stays silent for an ssh transport refusal", () => {
    expect(processInput(mockInput("git push", SSH_TRANSPORT_REFUSAL))).toBeNull();
  });
});
