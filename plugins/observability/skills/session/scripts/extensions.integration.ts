import { beforeAll, expect, test } from "bun:test";
import { join } from "node:path";

const initFile = join(import.meta.dirname, "..", "resources", "extensions.sql");
const PROXY_KEYS = [
  "http_proxy",
  "HTTP_PROXY",
  "https_proxy",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
];

function runInit(proxyEnv: Record<string, string>, inherit = false) {
  const env: Record<string, string | undefined> = { ...process.env };
  if (!inherit) for (const key of PROXY_KEYS) delete env[key];
  const proc = Bun.spawnSync(
    [
      "duckdb",
      "-json",
      "-init",
      initFile,
      "-c",
      "SELECT current_setting('http_proxy') AS host, current_setting('http_proxy_username') AS username, current_setting('http_proxy_password') AS password",
    ],
    { env: { ...env, ...proxyEnv }, stdout: "pipe", stderr: "pipe" },
  );
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

// Install through whatever proxy this process has, so the cases below run on a warm cache.
beforeAll(() => {
  const warm = runInit({}, true);
  expect(warm.stderr).not.toContain("Error");
  expect(warm.exitCode).toBe(0);
}, 120_000);

// DuckDB rejects a credentialed `http_proxy` URL outright, and the Claude Code sandbox proxy is one.
test.each([
  ["no proxy", {}, { host: "", username: "", password: "" }],
  [
    "a credentialed proxy",
    { http_proxy: "http://srt.abc:s3cret@localhost:60545" },
    { host: "localhost:60545", username: "srt.abc", password: "s3cret" },
  ],
  [
    "an uppercase-only credentialed proxy",
    { HTTP_PROXY: "http://user:pw@proxy.test:3128/" },
    { host: "proxy.test:3128", username: "user", password: "pw" },
  ],
  [
    "a bare host:port",
    { http_proxy: "proxy.test:8080" },
    { host: "proxy.test:8080", username: "", password: "" },
  ],
])("splits %s into DuckDB proxy settings", (_name, proxyEnv, expected) => {
  const result = runInit(proxyEnv);
  expect(result.stderr).not.toContain("Error");
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([expected]);
});
