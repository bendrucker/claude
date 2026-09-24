#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/routes src/accounts src/mail
cat > src/routes/signup.ts <<'TS'
import { createAccount } from "../accounts/create";

export async function handleSignup(req: Request): Promise<Response> {
  const { email, password } = await req.json();
  const account = await createAccount(email, password);
  return Response.json({ id: account.id }, { status: 201 });
}
TS
cat > src/accounts/create.ts <<'TS'
import { hashPassword } from "./password";
import { insertAccount, activate } from "./store";
import { sendWelcome } from "../mail/welcome";

export async function createAccount(email: string, password: string) {
  const hash = await hashPassword(password);
  const account = await insertAccount(email, hash);
  await activate(account.id);
  await sendWelcome(email);
  return account;
}
TS
cat > src/accounts/password.ts <<'TS'
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password);
}
TS
cat > src/accounts/store.ts <<'TS'
const accounts = new Map<string, { id: string; email: string; hash: string; active: boolean }>();

export async function insertAccount(email: string, hash: string) {
  const account = { id: crypto.randomUUID(), email, hash, active: false };
  accounts.set(account.id, account);
  return account;
}

export async function activate(id: string) {
  accounts.get(id)!.active = true;
}
TS
cat > src/mail/welcome.ts <<'TS'
export async function sendWelcome(email: string) {
  console.log(`welcome mail to ${email}`);
}
TS
