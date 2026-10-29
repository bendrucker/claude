#!/usr/bin/env bun

import { ensurePackages, valeBinary } from "../detection/vale";

const binary = valeBinary();
if (binary !== null) await ensurePackages(binary);
