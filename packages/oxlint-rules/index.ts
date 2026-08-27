import { eslintCompatPlugin } from "@oxlint/plugins";

import { noChainedTypeAssertionsRule } from "./no-chained-type-assertions.ts";
import { noModuleMockingRule } from "./no-module-mocking.ts";
import { noTerminalWidthRule } from "./no-terminal-width.ts";

/** Repo-local Oxlint rules, registered as the `local` plugin in .oxlintrc.json. */
const plugin = eslintCompatPlugin({
  meta: { name: "local" },
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-module-mocking": noModuleMockingRule,
    "no-terminal-width": noTerminalWidthRule,
  },
});

export default plugin;
