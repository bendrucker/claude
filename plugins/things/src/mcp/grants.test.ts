import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGrantStore } from "./grants";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "grants-"));
}

function tempStore() {
  return createGrantStore(join(tempDir(), "grants.json"));
}

const CLIENT = "abc123";
const OTHER_CLIENT = "def456";

describe("createGrantStore", () => {
  test("unknown subject has no grant", async () => {
    expect(await tempStore().get({ user: "nobody@example.com", client: CLIENT })).toBeNull();
  });

  test("first use records pending, approval flips it", async () => {
    const store = tempStore();
    const subject = { user: "Ben@Example.com", client: CLIENT };

    const pending = await store.recordPending(subject);
    expect(pending.status).toBe("pending");
    expect(pending.user).toBe("ben@example.com");
    expect(pending.client).toBe(CLIENT);

    const again = await store.recordPending({ user: "ben@example.com", client: CLIENT });
    expect(again.firstSeen).toBe(pending.firstSeen);

    const approved = await store.set(subject, "approved");
    expect(approved.status).toBe("approved");
    expect(approved.decidedAt).toBeDefined();

    expect((await store.get(subject))?.status).toBe("approved");
    expect(await store.list()).toHaveLength(1);
  });

  test("approval for one client does not authorize another", async () => {
    const store = tempStore();
    const user = "ben@example.com";
    await store.set({ user, client: CLIENT }, "approved");

    expect(await store.get({ user, client: OTHER_CLIENT })).toBeNull();

    const pending = await store.recordPending({ user, client: OTHER_CLIENT });
    expect(pending.status).toBe("pending");
    expect((await store.get({ user, client: CLIENT }))?.status).toBe("approved");
  });

  test("denying one client leaves another approved", async () => {
    const store = tempStore();
    const user = "ben@example.com";
    await store.set({ user, client: CLIENT }, "approved");
    await store.set({ user, client: OTHER_CLIENT }, "denied");

    expect((await store.get({ user, client: CLIENT }))?.status).toBe("approved");
    expect((await store.get({ user, client: OTHER_CLIENT }))?.status).toBe("denied");
  });

  test("client ids are case-sensitive", async () => {
    const store = tempStore();
    const user = "ben@example.com";
    await store.set({ user, client: "AbC123" }, "approved");

    expect(await store.get({ user, client: "abc123" })).toBeNull();
  });

  test("a grant predating client keying matches no client", async () => {
    const path = join(tempDir(), "grants.json");
    await Bun.write(
      path,
      JSON.stringify({
        grants: [
          {
            user: "ben@example.com",
            status: "approved",
            firstSeen: "2026-07-13T20:37:06.462Z",
            decidedAt: "2026-07-13T20:37:51.765Z",
          },
        ],
      }),
    );
    const store = createGrantStore(path);

    expect(await store.get({ user: "ben@example.com", client: CLIENT })).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });

  test("concurrent recordPending for the same subject keeps the first timestamp", async () => {
    const store = tempStore();
    const subject = { user: "ben@example.com", client: CLIENT };
    const [first, second] = await Promise.all([
      store.recordPending(subject),
      store.recordPending(subject),
    ]);
    expect(second.firstSeen).toBe(first.firstSeen);
    expect(await store.list()).toHaveLength(1);
  });

  test("concurrent recordPending for different subjects persists both", async () => {
    const store = tempStore();
    await Promise.all([
      store.recordPending({ user: "a@example.com", client: CLIENT }),
      store.recordPending({ user: "b@example.com", client: CLIENT }),
      store.recordPending({ user: "a@example.com", client: OTHER_CLIENT }),
    ]);
    const grants = await store.list();
    expect(grants.map((grant) => `${grant.user}/${grant.client}`).sort()).toEqual([
      `a@example.com/${CLIENT}`,
      `a@example.com/${OTHER_CLIENT}`,
      `b@example.com/${CLIENT}`,
    ]);
  });

  test("deny without prior pending record", async () => {
    const store = tempStore();
    const subject = { user: "intruder@example.com", client: CLIENT };
    await store.set(subject, "denied");
    expect((await store.get(subject))?.status).toBe("denied");
  });
});
