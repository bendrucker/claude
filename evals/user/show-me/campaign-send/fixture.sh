#!/usr/bin/env bash
set -euo pipefail
mkdir -p admin api mailer
cat > admin/send.ts <<'TS'
export async function sendCampaign(campaignId: string) {
  await fetch(`/api/campaigns/${campaignId}/send`, { method: "POST" });
  const events = new EventSource(`/api/campaigns/${campaignId}/progress`);
  events.onmessage = (e) => renderProgress(JSON.parse(e.data));
}
declare function renderProgress(p: { sent: number; total: number }): void;
TS
cat > api/campaigns.ts <<'TS'
import { redis } from "./redis";
import { recipientsFor } from "./recipients";

export async function startSend(campaignId: string) {
  const recipients = await recipientsFor(campaignId);
  for (const batch of chunk(recipients, 500)) {
    await redis.lpush("mail-batches", JSON.stringify({ campaignId, batch }));
  }
  await redis.set(`campaign:${campaignId}:total`, recipients.length);
}

export async function* progress(campaignId: string) {
  for await (const msg of redis.subscribe(`campaign:${campaignId}:progress`)) yield msg;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
TS
cat > api/redis.ts <<'TS'
export declare const redis: {
  lpush(key: string, value: string): Promise<void>;
  brpop(key: string): Promise<string>;
  set(key: string, value: unknown): Promise<void>;
  incrby(key: string, n: number): Promise<number>;
  publish(channel: string, msg: string): Promise<void>;
  subscribe(channel: string): AsyncIterable<string>;
};
TS
cat > api/recipients.ts <<'TS'
export async function recipientsFor(campaignId: string): Promise<string[]> {
  return [`${campaignId}@example.com`];
}
TS
cat > mailer/worker.ts <<'TS'
import { redis } from "../api/redis";
import { ses } from "./ses";

export async function run() {
  for (;;) {
    const { campaignId, batch } = JSON.parse(await redis.brpop("mail-batches"));
    for (const to of batch) await ses.send({ to, campaignId });
    const sent = await redis.incrby(`campaign:${campaignId}:sent`, batch.length);
    await redis.publish(`campaign:${campaignId}:progress`, JSON.stringify({ sent }));
  }
}
TS
cat > mailer/ses.ts <<'TS'
export const ses = { send: async (msg: { to: string; campaignId: string }) => {} };
TS
