import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { NtfyConfig } from "../../src/ntfy";
import { subscribe, type Reply } from "../../src/replies";
import { NTFY_AVAILABLE, restartServer, startServer, stopServer, type TestServer } from "./harness";

async function postReply(config: NtfyConfig, body: Reply): Promise<void> {
  await fetch(`${config.url}/${config.replies}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    body: JSON.stringify(body),
  });
}

async function waitUntil(predicate: () => boolean, deadline: number): Promise<void> {
  if (predicate()) return;
  if (Date.now() > deadline) throw new Error("timed out waiting for a reply");
  await Bun.sleep(20);
  return waitUntil(predicate, deadline);
}

describe.skipIf(!NTFY_AVAILABLE)("subscribe", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await stopServer(server);
  });

  test("parses a reply exactly as an action button would post it", async () => {
    const config: NtfyConfig = {
      url: server.url,
      topic: "chief",
      replies: "replies-a",
      token: server.token,
    };
    const replies: Reply[] = [];
    const unsubscribe = subscribe(config, (reply) => replies.push(reply));
    await Bun.sleep(200);

    await postReply(config, { id: "claude-hook:sess-1:permission_prompt", op: "hold", for: "1h" });

    await waitUntil(() => replies.length > 0, Date.now() + 5000);
    expect(replies).toEqual([
      { id: "claude-hook:sess-1:permission_prompt", op: "hold", for: "1h" },
    ]);
    unsubscribe();
  }, 10_000);

  test("reconnects with backoff after the server closes and comes back", async () => {
    const config: NtfyConfig = {
      url: server.url,
      topic: "chief",
      replies: "replies-b",
      token: server.token,
    };
    const replies: Reply[] = [];
    const unsubscribe = subscribe(config, (reply) => replies.push(reply), {
      backoff: [50, 100, 200],
    });
    await Bun.sleep(200);

    server = await restartServer(server);

    await postReply(config, { id: "claude-hook:sess-1:idle", op: "drop" });

    await waitUntil(() => replies.length > 0, Date.now() + 10_000);
    expect(replies).toEqual([{ id: "claude-hook:sess-1:idle", op: "drop" }]);
    unsubscribe();
  }, 15_000);
});
