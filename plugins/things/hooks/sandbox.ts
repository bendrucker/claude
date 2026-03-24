#!/usr/bin/env bun

import { main } from "sandbox-bypass";

export { processInput } from "sandbox-bypass";

if (import.meta.main) {
  main().catch(console.error);
}
