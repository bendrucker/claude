#!/usr/bin/env bun

import { validate } from ".";

const errors = await validate(process.cwd());
if (errors.size > 0) {
  for (const [file, errs] of errors) {
    console.error(`${file}:`);
    for (const err of errs) {
      console.error(`  - ${err}`);
    }
  }
  process.exit(1);
}
