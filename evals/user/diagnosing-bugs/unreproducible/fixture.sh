#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "hooks", "type": "module", "scripts": { "test": "bun test" } }
JSON
cat > src/verify.ts <<'TS'
import { createHmac, timingSafeEqual } from "node:crypto";

export function sign(body: Uint8Array, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

export function verify(body: Uint8Array, header: string | null, secret: string): boolean {
  if (header === null) return false;
  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
TS
cat > src/server.ts <<'TS'
import { verify } from "./verify";

const secret = process.env.WEBHOOK_SECRET ?? "";

export default {
  port: Number(process.env.PORT ?? 3000),
  async fetch(req: Request): Promise<Response> {
    const body = new Uint8Array(await req.arrayBuffer());
    if (!verify(body, req.headers.get("x-signature"), secret)) {
      return new Response("invalid signature", { status: 401 });
    }
    const event = JSON.parse(new TextDecoder().decode(body)) as { type: string };
    console.log("received", event.type);
    return new Response("ok");
  },
};
TS
cat > test/verify.test.ts <<'TS'
import { expect, test } from "bun:test";
import { sign, verify } from "../src/verify";

const bytes = (s: string) => new TextEncoder().encode(s);

test("accepts a matching signature", () => {
  const body = bytes(JSON.stringify({ type: "order.paid", id: 42 }));
  expect(verify(body, sign(body, "s3cret"), "s3cret")).toBe(true);
});

test("rejects a tampered body", () => {
  const body = bytes(JSON.stringify({ type: "order.paid", id: 42 }));
  expect(verify(bytes(" "), sign(body, "s3cret"), "s3cret")).toBe(false);
});
TS
git add -A && git commit -qm "hooks: verify webhook signatures"
