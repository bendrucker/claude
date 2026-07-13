import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGrantStore } from "./grants";

function tempStore() {
  return createGrantStore(join(mkdtempSync(join(tmpdir(), "grants-")), "grants.json"));
}

describe("createGrantStore", () => {
  test("unknown user has no grant", async () => {
    expect(await tempStore().get("nobody@example.com")).toBeNull();
  });

  test("first use records pending, approval flips it", async () => {
    const store = tempStore();

    const pending = await store.recordPending("Ben@Example.com");
    expect(pending.status).toBe("pending");
    expect(pending.user).toBe("ben@example.com");

    const again = await store.recordPending("ben@example.com");
    expect(again.firstSeen).toBe(pending.firstSeen);

    const approved = await store.set("ben@example.com", "approved");
    expect(approved.status).toBe("approved");
    expect(approved.decidedAt).toBeDefined();

    expect((await store.get("ben@example.com"))?.status).toBe("approved");
    expect(await store.list()).toHaveLength(1);
  });

  test("deny without prior pending record", async () => {
    const store = tempStore();
    await store.set("intruder@example.com", "denied");
    expect((await store.get("intruder@example.com"))?.status).toBe("denied");
  });
});
