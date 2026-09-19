import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { fixture } from "./fixture";

describe("cli", () => {
  const script = join(import.meta.dir, "ledger.ts");

  const runOn = async (path: string, ...args: string[]) => {
    const proc = Bun.spawn([process.execPath, script, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: path },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  };
  // An empty PATH keeps herdr out of reach, so the lead state reads as unknown.
  const run = (...args: string[]) => runOn("/nonexistent", ...args);

  test("status survives a herdr that answers with something other than JSON", async () => {
    const bin = mkdtempSync(join(tmpdir(), "ledger-bin-"));
    await Bun.write(join(bin, "herdr"), "#!/bin/sh\necho not json\n");
    await Bun.spawn(["chmod", "+x", join(bin, "herdr")]).exited;
    const result = await runOn(bin, "status", "--data-dir", await fixture());
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/lead:unknown/);
  });

  test("status prints the routing block, the threads, and JSON on request", async () => {
    const dataDir = await fixture();
    const text = await run("status", "--data-dir", dataDir);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/^projects\nledger\s+Dispatch ledger.*lead:unknown\s+open:1\n/);
    expect(text.stdout).toMatch(/\nfix-thing\s+blocked/);
    expect(text.stdout).not.toMatch(/done-thing/);

    const json = await run("status", "--data-dir", dataDir, "--tag", "by=chief", "--json");
    expect(json.code).toBe(0);
    const parsed: unknown = JSON.parse(json.stdout);
    expect(parsed).toEqual({
      projects: [expect.objectContaining({ slug: "ledger", open: 1 })],
      threads: [expect.objectContaining({ branch: "one-off" })],
    });
  });

  test("outcome appends the row and status drops the thread", async () => {
    const dataDir = await fixture();
    const result = await run(
      "outcome",
      "--data-dir",
      dataDir,
      "--repo",
      "/repo",
      "--branch",
      "fix-thing",
      "--state",
      "done",
      "--pr",
      "https://example.test/pr/3",
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ branch: "fix-thing", outcome: "done" });
    const status = await run("status", "--data-dir", dataDir);
    expect(status.stdout).not.toMatch(/fix-thing/);
    expect(status.stdout).toMatch(/open:0/);
  });

  test.each<[string, string[], number, RegExp]>([
    ["no subcommand", [], 2, /ledger/],
    ["outcome without a state", ["outcome", "--branch", "x"], 2, /--branch and --state/],
    ["outcome with a bad state", ["outcome", "--branch", "x", "--state", "won"], 2, /--state/],
    [
      "outcome with a state only dispatch writes",
      ["outcome", "--branch", "x", "--state", "dispatched"],
      2,
      /--state/,
    ],
    ["status with a bad tag", ["status", "--tag", "nope"], 2, /must be <key>=<value>/],
  ])("rejects %s", async (_label, args, status, expected) => {
    const result = await run(...args);
    expect(result.code).toBe(status);
    expect(`${result.stdout}${result.stderr}`).toMatch(expected);
  });
});
