#!/usr/bin/env bun

import { loadPlugins } from "../packages/marketplace/index";
import { runCheck } from "./check";

await runCheck(
  async () => {
    const plugins = await loadPlugins();
    return {
      header: "Plugins missing from marketplace.json:",
      violations: plugins
        .filter((p) => p.dir !== undefined && p.listing?.local !== true)
        .map((p) => p.name),
    };
  },
  { success: "All plugin directories are listed in marketplace.json" },
);
