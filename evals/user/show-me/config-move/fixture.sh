#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/server src/jobs
cat > src/config.ts <<'TS'
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://localhost/app",
  jobConcurrency: Number(process.env.JOB_CONCURRENCY ?? 4),
  smtpHost: process.env.SMTP_HOST ?? "localhost",
};
TS
cat > src/server/index.ts <<'TS'
import { config } from "../config";
Bun.serve({ port: config.port, fetch: () => new Response("ok") });
TS
cat > src/server/db.ts <<'TS'
import { config } from "../config";
export const dbUrl = config.databaseUrl;
TS
cat > src/jobs/worker.ts <<'TS'
import { config } from "../config";
export const slots = Array.from({ length: config.jobConcurrency });
TS
cat > src/jobs/mailer.ts <<'TS'
import { config } from "../config";
export const smtp = { host: config.smtpHost };
TS
