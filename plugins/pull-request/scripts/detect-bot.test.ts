import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Cooldown, detect, parseCooldowns } from "./detect-bot";

const NOW = new Date("2026-08-02T00:00:00Z");
const REMOTE = "git@github.com:bendrucker/claude.git";

const none = async () => [];

async function repo(files: string[]): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "detect-bot-"));
  for (const file of files) {
    await Bun.write(join(root, file), "{}");
  }
  return root;
}

test.each([
  [
    [".greptile/config.json"],
    ["greptile"],
    "greptile: repo config (.greptile/config.json), CLI installed",
  ],
  [
    [".greptile/config.json"],
    [],
    "greptile: repo config (.greptile/config.json), CLI not installed",
  ],
  [[], ["greptile"], "greptile: CLI installed, no repo config"],
  [[".coderabbit.yml"], [], "coderabbit: repo config (.coderabbit.yml), CLI not installed"],
  [[], [], "none: no bot config or CLI found locally"],
  [
    [".greptile/config.json", ".coderabbit.yaml"],
    ["greptile"],
    "greptile: repo config (.greptile/config.json), CLI installed\ncoderabbit: repo config (.coderabbit.yaml), CLI not installed",
  ],
] as [string[], string[], string][])("files %p, CLIs %p", async (files, clis, expected) => {
  const which = (cli: string) => (clis.includes(cli) ? `/bin/${cli}` : null);
  expect(await detect(await repo(files), { which, cooldowns: none, now: NOW })).toBe(expected);
});

const onlyGreptile = (cli: string) => (cli === "greptile" ? "/bin/greptile" : null);

const exhausted: Cooldown = {
  provider: "greptile",
  remote: REMOTE,
  pausedUntil: "2026-08-07T00:00:00Z",
  reason: "free credits exhausted",
};

test.each<{ name: string; records: unknown; expected: string }>([
  {
    name: "no record",
    records: [],
    expected: "greptile: repo config (.greptile/config.json), CLI installed",
  },
  {
    name: "live record",
    records: [exhausted],
    expected:
      "greptile: repo config (.greptile/config.json), CLI installed, paused until 2026-08-07 (free credits exhausted)",
  },
  {
    name: "expired record",
    records: [{ ...exhausted, pausedUntil: "2026-07-01T00:00:00Z" }],
    expected: "greptile: repo config (.greptile/config.json), CLI installed",
  },
  {
    name: "record for another remote",
    records: [{ ...exhausted, remote: "git@github.com:bendrucker/dotfiles.git" }],
    expected: "greptile: repo config (.greptile/config.json), CLI installed",
  },
  {
    name: "record with no remote applies everywhere",
    records: [{ ...exhausted, remote: undefined }],
    expected:
      "greptile: repo config (.greptile/config.json), CLI installed, paused until 2026-08-07 (free credits exhausted)",
  },
  {
    name: "non-ISO pausedUntil is normalized, not sliced",
    records: [{ ...exhausted, pausedUntil: "August 7, 2026 00:00:00 UTC" }],
    expected:
      "greptile: repo config (.greptile/config.json), CLI installed, paused until 2026-08-07 (free credits exhausted)",
  },
  {
    name: "malformed file: non-string remote",
    records: [{ ...exhausted, remote: 42 }],
    expected: "greptile: repo config (.greptile/config.json), CLI installed",
  },
  {
    name: "record for another provider",
    records: [{ ...exhausted, provider: "coderabbit" }],
    expected: "greptile: repo config (.greptile/config.json), CLI installed",
  },
  {
    name: "soonest of several live records",
    records: [
      exhausted,
      { ...exhausted, pausedUntil: "2026-08-04T00:00:00Z", reason: "rate limited" },
    ],
    expected:
      "greptile: repo config (.greptile/config.json), CLI installed, paused until 2026-08-04 (rate limited)",
  },
  {
    name: "malformed file: not an array",
    records: { provider: "greptile" },
    expected: "greptile: repo config (.greptile/config.json), CLI installed",
  },
  {
    name: "malformed file: missing fields",
    records: [{ provider: "greptile" }, null, "greptile"],
    expected: "greptile: repo config (.greptile/config.json), CLI installed",
  },
  {
    name: "malformed file: unparseable date",
    records: [{ ...exhausted, pausedUntil: "soon" }],
    expected: "greptile: repo config (.greptile/config.json), CLI installed",
  },
])("cooldown: $name", async ({ records, expected }) => {
  const cooldowns = async () => parseCooldowns(JSON.stringify(records));
  const root = await repo([".greptile/config.json"]);
  expect(await detect(root, { which: onlyGreptile, cooldowns, remote: REMOTE, now: NOW })).toBe(
    expected,
  );
});

test.each<{ name: string; records: Cooldown[]; expected: string }>([
  {
    name: "an unscoped record still applies",
    records: [{ ...exhausted, remote: undefined }],
    expected:
      "greptile: repo config (.greptile/config.json), CLI installed, paused until 2026-08-07 (free credits exhausted)",
  },
  {
    name: "a repo-scoped record does not leak",
    records: [exhausted],
    expected: "greptile: repo config (.greptile/config.json), CLI installed",
  },
])("unresolvable remote: $name", async ({ records, expected }) => {
  const cooldowns = async () => records;
  const root = await repo([".greptile/config.json"]);
  expect(await detect(root, { which: onlyGreptile, cooldowns, remote: null, now: NOW })).toBe(
    expected,
  );
});

test("cooldown: unparseable JSON", async () => {
  const cooldowns = async () => parseCooldowns("not json");
  const root = await repo([".greptile/config.json"]);
  expect(await detect(root, { which: onlyGreptile, cooldowns, remote: REMOTE, now: NOW })).toBe(
    "greptile: repo config (.greptile/config.json), CLI installed",
  );
});
