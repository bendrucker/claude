#!/usr/bin/env bun

import { join } from "node:path";

export interface Provider {
  name: string;
  configs: string[];
  cli: string;
}

export const PROVIDERS: Provider[] = [
  { name: "greptile", configs: [".greptile/config.json"], cli: "greptile" },
  { name: "coderabbit", configs: [".coderabbit.yaml", ".coderabbit.yml"], cli: "coderabbit" },
];

export type Which = (cli: string) => string | null;

export async function detect(root: string, which: Which = Bun.which): Promise<string> {
  const lines: string[] = [];
  for (const provider of PROVIDERS) {
    let config: string | null = null;
    for (const path of provider.configs) {
      if (await Bun.file(join(root, path)).exists()) {
        config = path;
        break;
      }
    }
    const cli = which(provider.cli) !== null;
    if (config && cli) lines.push(`${provider.name}: repo config (${config}), CLI installed`);
    else if (config) lines.push(`${provider.name}: repo config (${config}), CLI not installed`);
    else if (cli) lines.push(`${provider.name}: CLI installed, no repo config`);
  }
  return lines.length > 0 ? lines.join("\n") : "none: no bot config or CLI found locally";
}

if (import.meta.main) {
  console.log(await detect(process.cwd()));
}
