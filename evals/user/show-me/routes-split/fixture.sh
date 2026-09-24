#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/routes.ts <<'TS'
import { Router } from "./router";

export const router = new Router();

router.get("/users", listUsers);
router.get("/users/:id", getUser);
router.post("/users", createUser);
router.get("/invoices", listInvoices);
router.post("/invoices/:id/pay", payInvoice);
router.get("/reports/monthly", monthlyReport);

async function listUsers() {}
async function getUser() {}
async function createUser() {}
async function listInvoices() {}
async function payInvoice() {}
async function monthlyReport() {}
TS
cat > src/router.ts <<'TS'
export class Router {
  get(path: string, h: () => Promise<void>) {}
  post(path: string, h: () => Promise<void>) {}
}
TS
cat > src/server.ts <<'TS'
import { router } from "./routes";
export function start() {
  return router;
}
TS
