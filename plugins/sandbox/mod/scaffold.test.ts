import { describe, expect, test } from "claude-code/testing";
import { judge, matches, message, parse } from "./scaffold";

const GLOBAL = ["git:*", "wt:*", "claude:*", "agent-browser:*", "open:*", "osascript:*"];
const CWD = "/repo";

function denied(command: string) {
  const verdict = judge(command, GLOBAL, CWD);
  if (!verdict.deny) throw new Error(`expected a deny, got ${verdict.reason}`);
  return verdict;
}

describe("matches", () => {
  test("reads a prefix entry in either spelling", () => {
    expect(matches("git:*", "git")).toBe(true);
    expect(matches("git:*", "git push -u origin HEAD")).toBe(true);
    expect(matches("git *", "git status")).toBe(true);
    expect(matches("git:*", "gitk")).toBe(false);
  });

  test("reads exact and wildcard entries", () => {
    expect(matches("vm list", "vm list")).toBe(true);
    expect(matches("vm list", "vm list --all")).toBe(false);
    expect(matches("aws * describe-*", "aws ec2 describe-instances")).toBe(true);
    expect(matches("aws * describe-*", "aws ec2 run-instances")).toBe(false);
  });
});

describe("parse", () => {
  test("splits chains and pipelines and keeps quoting in raw", () => {
    const items = parse(`cd /repo && git commit -m "a b" | tail -5; git log`);
    expect(items?.map((item) => item.op)).toEqual([null, "&&", ";"]);
    const [, commit] = items ?? [];
    expect(commit?.elements.map((words) => words.map((word) => word.text))).toEqual([
      ["git", "commit", "-m", "a b"],
      ["tail", "-5"],
    ]);
    expect(commit?.elements[0]?.[3]?.raw).toBe(`"a b"`);
  });

  test("returns null for what it does not model", () => {
    for (const command of [
      "git log $(cat ref)",
      "git status > out.txt",
      "git fetch &",
      "git pull || true",
      "(git status)",
      `git commit -m "$MSG"`,
      "git status |",
    ])
      expect(parse(command)).toBeNull();
  });
});

describe("judge", () => {
  test("denies a lone excluded command that escapes as written", () => {
    const verdict = denied("git status");
    expect(verdict.scaffolds).toEqual([]);
    expect(verdict.command).toBe("git status");
  });

  test("drops a cd to the session directory, 2>&1, and a trailing filter", () => {
    const verdict = denied("cd /repo/ && git push -u origin HEAD 2>&1 | tail -20");
    expect(verdict.command).toBe("git push -u origin HEAD");
    expect(verdict.scaffolds.map((s) => s.kind)).toEqual(["cd", "redirect", "filter"]);
    expect(verdict.patterns).toEqual(["git:*"]);
  });

  test("keeps a chain of excluded commands and the operators between them", () => {
    expect(denied("git fetch origin && git rebase origin/main; wt list").command).toBe(
      "git fetch origin && git rebase origin/main; wt list",
    );
  });

  test("turns an exported browser session into --session", () => {
    const verdict = denied(
      "export AGENT_BROWSER_SESSION=ev-1; agent-browser open https://x.test && agent-browser snapshot -i",
    );
    expect(verdict.command).toBe(
      "agent-browser --session ev-1 open https://x.test && agent-browser --session ev-1 snapshot -i",
    );
    expect(denied("AGENT_BROWSER_SESSION=ev-1 agent-browser close").command).toBe(
      "agent-browser --session ev-1 close",
    );
  });

  test("lets through what has no escaping form", () => {
    const cases: [string, string][] = [
      ["cd /elsewhere && git status", "cd-elsewhere"],
      ["export GIT_TRACE=1; git status", "env"],
      ["GH_TOKEN=x git push", "env"],
      ["git status && bun test", "unmatched"],
      ["git log | xargs echo", "unmatched"],
      ["tail -f log | git hash-object --stdin", "unmatched"],
      ["git -C /elsewhere status", "unmatched"],
      ["git status > out.txt", "unparsed"],
      ["cd /repo", "empty"],
    ];
    for (const [command, reason] of cases)
      expect(judge(command, GLOBAL, CWD)).toMatchObject({ deny: false, reason });
  });

  test("reads only the patterns it is given", () => {
    expect(judge("ssh vm uptime", GLOBAL, CWD).deny).toBe(false);
    expect(judge("ssh vm uptime", [...GLOBAL, "ssh:*"], CWD).deny).toBe(true);
  });
});

describe("message", () => {
  test("names the form that escapes and why each dropped piece is redundant", () => {
    const text = message(denied("cd /repo && git log --oneline 2>&1 | head -5"));
    expect(text).toContain("`git:*`");
    expect(text).toContain("    git log --oneline");
    expect(text).toContain("`cd /repo`: the command already runs");
    expect(text).toContain("`| head -5`: the harness truncates");
    expect(text).toContain("`2>&1`");
  });

  test("names the flag that replaces an export", () => {
    const text = message(denied("export AGENT_BROWSER_SESSION=ev-1; agent-browser open x"));
    expect(text).toContain("pass `--session ev-1` to `agent-browser` instead");
  });

  test("says to drop only the flag when nothing else stands in the way", () => {
    expect(message(denied("git status"))).toContain("It escapes as written");
  });
});
