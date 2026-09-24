#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > src/client.ts <<'TS'
export type Http = (url: string, init?: RequestInit) => Promise<Response>;

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly http: Http = fetch,
  ) {}

  async get<T>(path: string): Promise<T> {
    const res = await this.http(`${this.baseUrl}${path}`);
    if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
    return (await res.json()) as T;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.http(`${this.baseUrl}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path}: ${res.status}`);
    return (await res.json()) as T;
  }
}
TS
cat > src/sync.ts <<'TS'
import { ApiClient } from "./client";

export async function syncAccounts(client: ApiClient, ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => client.post(`/accounts/${id}/sync`, {})));
}
TS
