/**
 * First-use approval store for the MCP gate.
 *
 * Authentication proves who a caller is. This store decides whether that
 * identity is allowed in: unknown users are recorded as pending and denied
 * until explicitly approved. The store is a JSON file so the gate process and
 * the approval CLI share state without a database.
 */

export type GrantStatus = "pending" | "approved" | "denied";

export interface Grant {
  user: string;
  status: GrantStatus;
  firstSeen: string;
  decidedAt?: string;
}

export interface GrantStore {
  get(user: string): Promise<Grant | null>;
  /** Records an unknown user as pending. Returns the existing grant if one exists. */
  recordPending(user: string): Promise<Grant>;
  set(user: string, status: GrantStatus): Promise<Grant>;
  list(): Promise<Grant[]>;
}

interface GrantsFile {
  grants: Grant[];
}

export function createGrantStore(path: string): GrantStore {
  async function load(): Promise<GrantsFile> {
    const file = Bun.file(path);
    if (!(await file.exists())) return { grants: [] };
    return (await file.json()) as GrantsFile;
  }

  async function save(data: GrantsFile): Promise<void> {
    await Bun.write(path, `${JSON.stringify(data, null, 2)}\n`);
  }

  function normalize(user: string): string {
    return user.trim().toLowerCase();
  }

  return {
    async get(user) {
      const data = await load();
      return data.grants.find((grant) => grant.user === normalize(user)) ?? null;
    },

    async recordPending(user) {
      const data = await load();
      const existing = data.grants.find((grant) => grant.user === normalize(user));
      if (existing) return existing;
      const grant: Grant = {
        user: normalize(user),
        status: "pending",
        firstSeen: new Date().toISOString(),
      };
      data.grants.push(grant);
      await save(data);
      return grant;
    },

    async set(user, status) {
      const data = await load();
      let grant = data.grants.find((entry) => entry.user === normalize(user));
      if (!grant) {
        grant = { user: normalize(user), status, firstSeen: new Date().toISOString() };
        data.grants.push(grant);
      } else {
        grant.status = status;
      }
      grant.decidedAt = new Date().toISOString();
      await save(data);
      return grant;
    },

    async list() {
      const data = await load();
      return data.grants;
    },
  };
}
