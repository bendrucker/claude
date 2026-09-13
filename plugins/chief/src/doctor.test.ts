import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  checkActListening,
  checkActReachable,
  checkBarkDevices,
  checkBarkServer,
  checkConfig,
  checkFocusFile,
  checkHealthz,
  checkHerdrAgent,
  formatCheck,
  runDoctor,
  type Config,
} from "./doctor";

const CONFIG_PATH = join(import.meta.dirname, "__fixtures__", "doctor.config.test.json");
const FOCUS_PATH = join(import.meta.dirname, "__fixtures__", "doctor.focus.test.json");

const CONFIG: Config = {
  bark: {
    url: "http://127.0.0.1:8090",
    devices: ["device-1"],
    key: "0123456789abcdef",
    actUrl: "https://chief.tailnet:7392",
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

test("checkBarkServer skips without a bark block, fails, or passes on the health probe", async () => {
  expect(await checkBarkServer(undefined, fetch)).toEqual({
    name: "bark server reachable",
    status: "skip",
    detail: "no bark block in config",
  });

  const down = await checkBarkServer(
    CONFIG,
    fakeFetch(() => new Response("nope", { status: 503 })),
  );
  expect(down).toEqual({ name: "bark server reachable", status: "fail", detail: "HTTP 503" });

  const ok = await checkBarkServer(
    CONFIG,
    fakeFetch(() => new Response("{}", { status: 200 })),
  );
  expect(ok).toEqual({ name: "bark server reachable", status: "pass" });
});

test.each<{ name: string; config: Config | undefined; status: "pass" | "fail" | "skip" }>([
  { name: "no bark block", config: undefined, status: "skip" },
  {
    name: "no devices",
    config: { ...CONFIG, bark: { ...CONFIG.bark!, devices: [] } },
    status: "fail",
  },
  { name: "one device", config: CONFIG, status: "pass" },
])("checkBarkDevices: $name", ({ config, status }) => {
  expect(checkBarkDevices(config).status).toBe(status);
});

test("checkActListening probes the loopback act page", async () => {
  const ok = await checkActListening(
    "http://127.0.0.1:7392",
    fakeFetch(() => new Response("{}", { status: 200 })),
  );
  expect(ok).toEqual({ name: "act page listening", status: "pass" });

  const down = await checkActListening(
    "http://127.0.0.1:7392",
    fakeFetch(() => new Response("nope", { status: 500 })),
  );
  expect(down).toEqual({ name: "act page listening", status: "fail", detail: "HTTP 500" });
});

test("checkActReachable skips (never fails) when the tailnet probe cannot succeed", async () => {
  expect(await checkActReachable(undefined, fetch)).toEqual({
    name: "act page reachable on tailnet",
    status: "skip",
    detail: "no bark block in config",
  });

  const unreachable = await checkActReachable(
    CONFIG,
    fakeFetch(() => new Response("nope", { status: 502 })),
  );
  expect(unreachable).toEqual({
    name: "act page reachable on tailnet",
    status: "skip",
    detail: "HTTP 502",
  });

  const ok = await checkActReachable(
    CONFIG,
    fakeFetch(() => new Response("{}", { status: 200 })),
  );
  expect(ok).toEqual({ name: "act page reachable on tailnet", status: "pass" });
});

test("checkHerdrAgent matches the configured agent name", async () => {
  const found = await checkHerdrAgent(CONFIG, () =>
    Promise.resolve({ agents: [{ name: "chief", agent: "claude", pane_id: "%1" }] }),
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
    actBaseUrl: "http://act.x",
    configPath: CONFIG_PATH,
    fetchImpl: fakeFetch(() => new Response("{}", { status: 200 })),
    listAgents: () => Promise.resolve({ agents: [{ name: "chief" }] }),
  });

  expect(checks.map((check) => `${check.status} ${check.name}`)).toEqual([
    "pass daemon healthz",
    "pass config parses",
    "pass bark server reachable",
    "pass bark devices set (1)",
    "pass act page listening",
    "pass act page reachable on tailnet",
    "pass herdr agent list",
    "pass Focus file readable",
  ]);
});
