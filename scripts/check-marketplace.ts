#!/usr/bin/env bun

import { loadPlugins } from "../packages/marketplace/index";

const plugins = await loadPlugins();
const missing = plugins.filter((p) => p.dir && !p.listing?.local).map((p) => p.name);

if (missing.length > 0) {
  console.log("Plugins missing from marketplace.json:");
  for (const name of missing) {
    console.log(`  ${name}`);
  }
  process.exit(1);
}

console.log("All plugin directories are listed in marketplace.json");
