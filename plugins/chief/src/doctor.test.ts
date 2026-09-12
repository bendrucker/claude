import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  checkConfig,
  checkFocusFile,
  checkHealthz,
  checkHerdrAgent,
  checkNtfy,
  checkRepliesSubscription,
  formatCheck,
  runDoctor,
  type Config,
} from "./doctor";

const CONFIG_PATH = join(import.meta.dirname, "__fixtures__", "doctor.config.test.json");
const FOCUS_PATH = join(import.meta.dirname, "__fixtures__", "doctor.focus.test.json");

const CONFIG: Config = {
  ntfy: {
    url: "http://127.0.0.1:2586",
    topic: "chief",
    replies: "chief-replies",
    token: "tk_test",
  },
  herdr: { agent: "chief" },
  presence: { focusFile: FOCUS_PATH, calendar: true, workHours: ["09:00", "18:00"] },
  grace: { permission: "3m", idle: "10m" },
};

afterEach(async () => {
  await rm(CONFIG_PATH, { force: true });
  await rm(FOCUS_PATH, { force: true });
});

function fakeFetch(handler: (url: string) => Response): typeof fetch {
  return Object.assign(
    (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      return Promise.resolve(handler(url));
    },
    { preconnect: () => undefined },
  );
}

test("checkHealthz passes on a 200 and fails otherwise", async () => {
  const ok = await checkHealthz(
    "http://x",
    fakeFetch(() => new Response("{}", { status: 200 })),
  );
  expect(ok).toEqual({ name: "daemon healthz", status: "pass" });

  const down = await checkHealthz(
    "http://x",
    fakeFetch(() => new Response("nope", { status: 503 })),
  );
  expect(down).toEqual({ name: "daemon healthz", status: "fail", detail: "HTTP 503" });
});

test("checkConfig fails for a missing file and passes for a valid one", async () => {
  const missing = await checkConfig(CONFIG_PATH);
  expect(missing.check.status).toBe("fail");
  expect(missing.config).toBeUndefined();

  await Bun.write(CONFIG_PATH, JSON.stringify(CONFIG));
  const present = await checkConfig(CONFIG_PATH);
  expect(present.check).toEqual({ name: "config parses", status: "pass" });
  expect(present.config).toEqual(CONFIG);
});

test("checkNtfy skips without config, fails on rejected token, passes on 200", async () => {
  expect(await checkNtfy(undefined, fetch)).toEqual({
    name: "ntfy reachable",
    status: "skip",
    detail: "config unavailable",
  });

  const rejected = await checkNtfy(
    CONFIG,
    fakeFetch(() => new Response("no", { status: 401 })),
  );
  expect(rejected).toEqual({ name: "ntfy reachable", status: "fail", detail: "token rejected" });

  const ok = await checkNtfy(
    CONFIG,
    fakeFetch(() => new Response("[]", { status: 200 })),
  );
  expect(ok).toEqual({ name: "ntfy reachable", status: "pass" });
});

test("checkRepliesSubscription always skips", () => {
  expect(checkRepliesSubscription().status).toBe("skip");
});

test("checkHerdrAgent matches the configured agent name", async () => {
  const found = await checkHerdrAgent(CONFIG, () =>
    Promise.resolve({ agents: [{ agent: "chief", pane: "%1" }] }),
  );
  expect(found).toEqual({ name: "herdr agent list", status: "pass" });

  const missing = await checkHerdrAgent(CONFIG, () => Promise.resolve({ agents: [] }));
  expect(missing).toEqual({
    name: "herdr agent list",
    status: "fail",
    detail: "no agent named chief",
  });
});

test("checkFocusFile passes when the file exists", async () => {
  const missing = await checkFocusFile(CONFIG);
  expect(missing.status).toBe("fail");

  await Bun.write(FOCUS_PATH, "{}");
  const present = await checkFocusFile(CONFIG);
  expect(present).toEqual({ name: "Focus file readable", status: "pass" });
});

test("formatCheck renders status, name, and an optional detail", () => {
  expect(formatCheck({ name: "x", status: "pass" })).toBe("pass - x");
  expect(formatCheck({ name: "x", status: "fail", detail: "boom" })).toBe("fail - x (boom)");
});

test("runDoctor aggregates every check in order", async () => {
  await Bun.write(CONFIG_PATH, JSON.stringify(CONFIG));
  await Bun.write(FOCUS_PATH, "{}");

  const checks = await runDoctor({
    baseUrl: "http://x",
    configPath: CONFIG_PATH,
    fetchImpl: fakeFetch(() => new Response("{}", { status: 200 })),
    listAgents: () => Promise.resolve({ agents: [{ agent: "chief" }] }),
  });

  expect(checks.map((check) => `${check.status} ${check.name}`)).toEqual([
    "pass daemon healthz",
    "pass config parses",
    "pass ntfy reachable",
    "skip ntfy replies subscription connected",
    "pass herdr agent list",
    "pass Focus file readable",
  ]);
});
