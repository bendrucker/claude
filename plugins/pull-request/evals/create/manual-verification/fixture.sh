#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
# The Linux sandbox mounts placeholder dotfiles into the working tree.
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://github.com/bendrucker/sheet-sync.git
# The sandbox has no network, so pushes land in a local bare repo.
git init -q --bare .git/origin.git
git remote set-url --push origin "$PWD/.git/origin.git"
mkdir -p src
cat > src/sheet.ts <<'TS'
export interface Row {
  id: string;
  values: string[];
}

export interface Sheet {
  find(id: string): Promise<Row | undefined>;
  update(id: string, row: Row): Promise<void>;
  append(row: Row): Promise<void>;
  index(): Promise<Map<string, number>>;
  batchUpdate(rows: Row[]): Promise<void>;
  batchAppend(rows: Row[]): Promise<void>;
}
TS
cat > src/sync.ts <<'TS'
import type { Row, Sheet } from "./sheet";

export async function sync(rows: Row[], sheet: Sheet): Promise<void> {
  for (const row of rows) {
    const existing = await sheet.find(row.id);
    if (existing) await sheet.update(row.id, row);
    else await sheet.append(row);
  }
}
TS
git add -A && git commit -qm "sync: add sheet sync"
git switch -qc batch-sync
cat > src/sync.ts <<'TS'
import type { Row, Sheet } from "./sheet";

export async function sync(rows: Row[], sheet: Sheet): Promise<void> {
  const index = await sheet.index();
  const updates = rows.filter((row) => index.has(row.id));
  const appends = rows.filter((row) => !index.has(row.id));
  await sheet.batchUpdate(updates);
  await sheet.batchAppend(appends);
}
TS
git commit -qam "sync: batch updates and appends"
