#!/usr/bin/env bun

import { loadPlugins } from "../packages/marketplace/index";
import { runCheck } from "./check";

await runCheck(
  async () => {
    const plugins = await loadPlugins();
    return {
      header: "Plugins in marketplace but not enabled in settings.json:",
      violations: plugins.filter((p) => p.listing && !p.enabled).map((p) => p.name),
    };
  },
  { success: "All marketplace plugins are enabled in settings.json" },
);
