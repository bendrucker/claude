import { eslintCompatPlugin } from "@oxlint/plugins";

import { noChainedTypeAssertionsRule } from "./no-chained-type-assertions.ts";
import { noConditionalEmptyObjectSpreadRule } from "./no-conditional-empty-object-spread.ts";
import { noModuleMockingRule } from "./no-module-mocking.ts";
import { noSilentCatchRule } from "./no-silent-catch.ts";
import { noTerminalWidthRule } from "./no-terminal-width.ts";
import { noUnknownReturnsRule } from "./no-unknown-returns.ts";

/** Repo-local Oxlint rules, registered as the `local` plugin in .oxlintrc.json. */
const plugin = eslintCompatPlugin({
  meta: { name: "local" },
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
    "no-module-mocking": noModuleMockingRule,
    "no-silent-catch": noSilentCatchRule,
    "no-terminal-width": noTerminalWidthRule,
    "no-unknown-returns": noUnknownReturnsRule,
  },
});

export default plugin;
