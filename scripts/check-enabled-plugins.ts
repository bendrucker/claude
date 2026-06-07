#!/usr/bin/env bun

import { loadPlugins } from "../packages/marketplace/index";

const plugins = await loadPlugins();
const missing = plugins.filter((p) => p.listing && !p.enabled).map((p) => p.name);

if (missing.length > 0) {
  console.log("Plugins in marketplace but not enabled in settings.json:");
  for (const name of missing) {
    console.log(`  ${name}`);
  }
  process.exit(1);
}

console.log("All marketplace plugins are enabled in settings.json");
