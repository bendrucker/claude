import { createCipheriv, randomBytes } from "node:crypto";
import { actToken } from "./act";
import type { LedgerRow, Tier } from "./types";

export interface BarkConfig {
  url: string;
  devices: string[];
  key: string;
  actUrl: string;
}

const LEVEL: Record<Tier, string> = {
  now: "critical",
  boundary: "timeSensitive",
  digest: "passive",
};
const GROUP = "chief";

function algorithmFor(key: Buffer): "aes-128-cbc" | "aes-256-cbc" {
  if (key.length === 16) return "aes-128-cbc";
  if (key.length === 32) return "aes-256-cbc";
  throw new Error(`bark key must be 16 or 32 characters, got ${key.length}`);
}

function encrypt(plain: Record<string, unknown>, key: string): { ciphertext: string; iv: string } {
  const keyBuffer = Buffer.from(key, "utf8");
  // Bark's own client generates a random 16-hex-character string and uses it verbatim as
  // the 16 raw CBC IV bytes, so a push-compatible IV has to follow the same convention.
  const iv = randomBytes(8).toString("hex");
  const cipher = createCipheriv(algorithmFor(keyBuffer), keyBuffer, Buffer.from(iv, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(plain), "utf8"),
    cipher.final(),
  ]).toString("base64");
  return { ciphertext, iv };
}

function bodyFor(row: LedgerRow): string {
  return [row.kind, row.pane, row.reason]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}

export async function publish(
  row: LedgerRow,
  config: BarkConfig,
  actSecret: string,
): Promise<Response | undefined> {
  if (config.devices.length === 0) return undefined;

  const plain = {
    title: row.title,
    body: bodyFor(row),
    level: LEVEL[row.tier],
    group: GROUP,
    url: `${config.actUrl}/act/${row.id}?t=${actToken(row.id, actSecret)}`,
  };
  const { ciphertext, iv } = encrypt(plain, config.key);

  try {
    const response = await fetch(`${config.url}/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_keys: config.devices, ciphertext, iv }),
    });
    if (!response.ok) console.error("bark publish", response.status, row.id);
    return response;
  } catch (error) {
    console.error("bark publish", error);
    return undefined;
  }
}
