// Where a lake lives, and the S3 plumbing both the writer and readers share.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { $ } from "bun";

export interface LakeOptions {
  /** `s3://bucket/prefix` or a local directory, holding `catalog.ducklake` and `data/`. */
  url: string;
  /** Hosts to publish. Every other host stays local. */
  hosts: string[];
  /** The local index to publish from. */
  index: string;
  /** Where the writer keeps its copy of a remote catalog between publishes, and spills. */
  stateDir: string;
  /** Imported hosts' root, for their egress policy. */
  importsDir?: string;
}

export const isRemote = (url: string): boolean => url.startsWith("s3://");
export const trimmed = (url: string): string => url.replace(/\/$/, "");
export const catalogUrl = (url: string): string => `${trimmed(url)}/catalog.ducklake`;
export const localCatalog = (o: LakeOptions): string =>
  isRemote(o.url) ? join(o.stateDir, "lake", "catalog.ducklake") : catalogUrl(o.url);

export const quote = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/**
 * DuckDB cannot parse the sandbox's credentialed `http_proxy`, so split it into the
 * settings it does accept. The node API lacks the CLI's `getenv`, so the writer splits
 * it here rather than in SQL.
 */
export function proxySettings(): string[] {
  const raw = [process.env.http_proxy, process.env.HTTP_PROXY].find(
    (v) => v !== undefined && v !== "",
  );
  if (raw === undefined) return [];
  const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
  return [
    `SET http_proxy = ${quote(u.host)};`,
    `SET http_proxy_username = ${quote(decodeURIComponent(u.username))};`,
    `SET http_proxy_password = ${quote(decodeURIComponent(u.password))};`,
  ];
}

export function s3Setup(proxy: string[]): string {
  const ca = process.env.AWS_CA_BUNDLE ?? process.env.SSL_CERT_FILE;
  const region = process.env.AWS_REGION ?? "us-east-1";
  return [
    ...proxy,
    "INSTALL httpfs; LOAD httpfs;",
    ca === undefined ? "" : `SET ca_cert_file = ${quote(ca)};`,
    `CREATE OR REPLACE SECRET lake_s3 (TYPE s3, PROVIDER credential_chain, REGION ${quote(region)});`,
  ].join("\n");
}

// The writer is the only one that changes the catalog, so its local copy is current
// unless it is missing (a new machine, or a wiped state dir).
export async function pullCatalog(o: LakeOptions): Promise<void> {
  const local = localCatalog(o);
  if (await Bun.file(local).exists()) return;
  mkdirSync(dirname(local), { recursive: true });
  const listed = await $`aws s3 ls ${catalogUrl(o.url)}`.nothrow().quiet();
  if (listed.exitCode === 0) await $`aws s3 cp --only-show-errors ${catalogUrl(o.url)} ${local}`;
}

export async function pushCatalog(o: LakeOptions): Promise<void> {
  await $`aws s3 cp --only-show-errors ${localCatalog(o)} ${catalogUrl(o.url)}`;
}
