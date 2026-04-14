#!/usr/bin/env bun

import { $ } from "bun";
import { cli } from "cleye";

// TODO: file upstream glab issue for merge trains 422
// glab mr merge --auto-merge calls PUT /merge_requests/:iid/merge
// instead of POST /merge_trains/merge_requests/:iid

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

  await $`glab api projects/${opts.projectId}/merge_trains/merge_requests/${opts.iid} -X POST ${{ raw: fields.join(" ") }}`;
}

export async function mergeViaGlab(branch: string, autoMerge: boolean): Promise<void> {
  const flags = autoMerge ? "--auto-merge" : "";
  await $`glab mr merge ${branch} ${{ raw: flags }} -y`;
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
    console.log(`Merge trains enabled — adding !${iid} (${branch}) to merge train`);
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
