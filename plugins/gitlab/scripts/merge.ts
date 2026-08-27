#!/usr/bin/env bun

import { $ } from "bun";
import { cli } from "cleye";

// glab has no merge-train command: `glab mr merge --auto-merge` hits the accept
// endpoint (PUT .../merge). GitLab 19.1+ resolves that to the train server-side,
// but we POST .../merge_trains/merge_requests/:iid directly so squash applies to
// the train add and the outcome doesn't depend on the instance version.

// Re-arming is idempotent: GitLab returns 409 "already set to Auto-Merge" when the
// MR is already armed, which we treat as success. A push clears the arm and briefly
// reports approvals_syncing before the arm can land, so retry through that window.
const ALREADY_ARMED = "already set to Auto-Merge";
const TRANSIENT = ["approvals_syncing"];
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2000;

export function errorText(err: unknown): string {
  // glab spreads a failure across both streams: `glab api` prints the HTTP error body
  // (the JSON message) to stdout and a `glab: <message> (HTTP <code>)` line to stderr.
  // Read both so the already-armed guard matches and callers see the full error text.
  const record = err as Record<string, unknown>;
  const streams = [record?.stdout, record?.stderr]
    .map((stream) => (stream == null ? "" : String(stream).trim()))
    .filter((text) => text.length > 0);
  if (streams.length > 0) {
    return streams.join("\n");
  }
  return err instanceof Error ? err.message : String(err);
}

export async function arm(
  // arm discards what run resolves to, and Promise<void> rejects callers
  // returning a real value.
  // oxlint-disable-next-line local/no-unknown-returns
  run: () => Promise<unknown>,
  sleep: (ms: number) => Promise<void> = Bun.sleep,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await run();
      return;
    } catch (err) {
      const message = errorText(err);
      if (message.includes(ALREADY_ARMED)) {
        return;
      }
      if (attempt < MAX_ATTEMPTS && TRANSIENT.some((t) => message.includes(t))) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
}

interface ProjectConfig {
  id: number;
  merge_trains_enabled: boolean;
}

export async function getProjectConfig(): Promise<ProjectConfig> {
  return $`glab api projects/:id`.json();
}

interface MergeRequest {
  iid: number;
}

export async function getMrIid(branch: string): Promise<number> {
  const mrs: MergeRequest[] =
    await $`glab api projects/:id/merge_requests -X GET --field source_branch=${branch} --field state=opened`.json();

  if (mrs.length === 0) {
    throw new Error(`No open MR found for branch: ${branch}`);
  }

  return mrs[0]!.iid;
}

interface MergeTrainOptions {
  projectId: number;
  iid: number;
  squash?: boolean | undefined;
}

export async function addToMergeTrain(opts: MergeTrainOptions): Promise<void> {
  const fields = ["--raw-field auto_merge=true"];
  if (opts.squash) {
    fields.push("--raw-field squash=true");
  }

  await arm(
    () =>
      $`glab api projects/${opts.projectId}/merge_trains/merge_requests/${opts.iid} -X POST ${{ raw: fields.join(" ") }}`,
  );
}

export async function mergeViaGlab(branch: string, autoMerge: boolean): Promise<void> {
  const flags = autoMerge ? "--auto-merge" : "";
  await arm(() => $`glab mr merge ${branch} ${{ raw: flags }} -y`);
}

export interface MergeActions {
  getProjectConfig(): Promise<ProjectConfig>;
  getMrIid(branch: string): Promise<number>;
  addToMergeTrain(opts: MergeTrainOptions): Promise<void>;
  mergeViaGlab(branch: string, autoMerge: boolean): Promise<void>;
}

const defaultActions: MergeActions = { getProjectConfig, getMrIid, addToMergeTrain, mergeViaGlab };

export async function merge(
  branch: string,
  opts: { autoMerge: boolean; squash?: boolean },
  actions: MergeActions = defaultActions,
): Promise<void> {
  const project = await actions.getProjectConfig();

  if (project.merge_trains_enabled && opts.autoMerge) {
    const iid = await actions.getMrIid(branch);
    console.log(`Merge trains enabled: adding !${iid} (${branch}) to merge train`);
    await actions.addToMergeTrain({
      projectId: project.id,
      iid,
      squash: opts.squash,
    });
  } else {
    await actions.mergeViaGlab(branch, opts.autoMerge);
  }
}

if (import.meta.main) {
  const argv = cli({
    name: "merge",
    parameters: ["[branch]"],
    flags: {
      autoMerge: {
        type: Boolean,
        description: "Enable auto-merge",
        default: false,
      },
      squash: {
        type: Boolean,
        description: "Squash commits when merging",
        default: false,
      },
    },
  });

  const branch = argv._.branch || (await $`git branch --show-current`.text()).trim();

  await merge(branch, {
    autoMerge: argv.flags.autoMerge,
    squash: argv.flags.squash,
  });
}
