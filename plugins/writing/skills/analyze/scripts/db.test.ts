import { describe, expect, test } from "bun:test";
import { proxyConfig } from "./db";

describe("proxyConfig", () => {
  test.each<{ name: string; env: Record<string, string>; expected: Record<string, string> }>([
    { name: "no proxy", env: {}, expected: {} },
    { name: "empty proxy", env: { http_proxy: "" }, expected: {} },
    {
      name: "credentialed sandbox proxy",
      env: { http_proxy: "http://user:secret@localhost:52910" },
      expected: {
        http_proxy: "localhost:52910",
        http_proxy_username: "user",
        http_proxy_password: "secret",
      },
    },
    {
      name: "uppercase fallback with encoded password",
      env: { HTTP_PROXY: "http://user:p%40ss@proxy.example:3128/" },
      expected: {
        http_proxy: "proxy.example:3128",
        http_proxy_username: "user",
        http_proxy_password: "p@ss",
      },
    },
  ])("$name", ({ env, expected }) => {
    expect(proxyConfig(env)).toEqual(expected);
  });
});
