import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const NTFY_AVAILABLE = Bun.which("ntfy") !== null;

if (!NTFY_AVAILABLE) {
  console.warn(
    "[chief] `ntfy` not found on PATH; skipping ntfy integration tests. Run `brew install ntfy` first.",
  );
}

export interface TestServer {
  dir: string;
  configPath: string;
  url: string;
  token: string;
  proc: ReturnType<typeof Bun.spawn>;
}

function freePort(): number {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = listener;
  listener.stop(true);
  return port;
}

async function writeConfig(
  dir: string,
  port: number,
): Promise<{ configPath: string; url: string }> {
  const url = `http://127.0.0.1:${port}`;
  const configPath = join(dir, "server.yml");
  await Bun.write(
    configPath,
    [
      `base-url: "${url}"`,
      `listen-http: "127.0.0.1:${port}"`,
      `auth-file: "${join(dir, "auth.db")}"`,
      "auth-default-access: deny-all",
      `cache-file: "${join(dir, "cache.db")}"`,
      "",
    ].join("\n"),
  );
  return { configPath, url };
}

async function waitForHealthy(url: string, deadline: number): Promise<void> {
  if (Date.now() > deadline) throw new Error(`ntfy server did not become healthy at ${url}`);

  try {
    const response = await fetch(`${url}/v1/health`);
    if (response.ok) return;
  } catch {
    // server not accepting connections yet
  }
  await Bun.sleep(50);
  return waitForHealthy(url, deadline);
}

async function provisionToken(configPath: string, username: string): Promise<string> {
  const add = Bun.spawn(["ntfy", "user", "--config", configPath, "add", "--role=admin", username], {
    env: { ...process.env, NTFY_PASSWORD: "chief-test-password" },
    stdout: "ignore",
    stderr: "ignore",
  });
  await add.exited;

  const token = Bun.spawn(["ntfy", "token", "--config", configPath, "add", username], {
    stdout: "pipe",
  });
  const output = await new Response(token.stdout).text();
  await token.exited;
  const match = /tk_[a-zA-Z0-9]+/.exec(output);
  if (!match) throw new Error(`could not parse ntfy token from: ${output}`);
  return match[0];
}

export async function startServer(): Promise<TestServer> {
  const dir = await mkdtemp(join(tmpdir(), "chief-ntfy-"));
  const port = freePort();
  const { configPath, url } = await writeConfig(dir, port);
  const proc = Bun.spawn(["ntfy", "serve", "-c", configPath], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitForHealthy(url, Date.now() + 5000);
  const token = await provisionToken(configPath, "chief");
  return { dir, configPath, url, token, proc };
}

export async function stopServer(server: TestServer): Promise<void> {
  server.proc.kill();
  await server.proc.exited;
  await rm(server.dir, { recursive: true, force: true });
}

export async function restartServer(server: TestServer): Promise<TestServer> {
  server.proc.kill();
  await server.proc.exited;
  const proc = Bun.spawn(["ntfy", "serve", "-c", server.configPath], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitForHealthy(server.url, Date.now() + 5000);
  return { ...server, proc };
}
