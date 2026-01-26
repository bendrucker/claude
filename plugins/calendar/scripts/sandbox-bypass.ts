#!/usr/bin/env npx tsx

import { sandboxBypass } from "@bendrucker/hooks/sandbox-bypass";

await sandboxBypass({
  autoAllow: (command) => /cal\.swift\s+(calendars|list|get)\b/.test(command),
});
