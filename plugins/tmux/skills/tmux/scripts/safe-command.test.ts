import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { z } from "zod";

const script = join(import.meta.dir, "safe-command.sh");

async function run(command: string): Promise<string> {
  const proc = Bun.spawn(["bash", script], {
    stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { command } })),
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return output.trim();
}

const Decision = z.looseObject({
  hookSpecificOutput: z.looseObject({ permissionDecision: z.string().optional() }).optional(),
});

function isAllow(output: string): boolean {
  if (output === "") return false;
  return Decision.parse(JSON.parse(output)).hookSpecificOutput?.permissionDecision === "allow";
}

describe("safe-command", () => {
  test.each<{ command: string; allowed: boolean }>([
    { command: "tmux capture-pane -p", allowed: true },
    { command: "tmux display-message -p '#{pane_id}'", allowed: true },
    { command: "tmux list-windows", allowed: true },
    { command: "tmux select-pane -t %3", allowed: true },
    { command: "tmux resize-pane -D 5", allowed: true },
    { command: "tmux select-window -t :2", allowed: false },
    { command: "tmux switch-client -t other", allowed: false },
    { command: "tmux next-window", allowed: false },
    { command: "tmux previous-window", allowed: false },
    { command: "tmux last-window", allowed: false },
    { command: "ls -la", allowed: false },
  ])("$command -> allowed=$allowed", async ({ command, allowed }) => {
    expect(isAllow(await run(command))).toBe(allowed);
  });
});
