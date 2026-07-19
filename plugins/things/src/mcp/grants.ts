/**
 * First-use approval store for the MCP gate.
 *
 * Authentication proves who a caller is and which OAuth client it authorized.
 * This store decides whether that pair is allowed in: an unknown pair is
 * recorded as pending and denied until explicitly approved. The store is a JSON
 * file so the gate process and the approval CLI share state without a database.
 *
 * Grants are keyed by (user, client) rather than user alone because the
 * authorization server issues tokens for any registered client without a
 * consent step. A token minted for an attacker's client still introspects as
 * the legitimate user, so the user alone is not enough to authorize on.
 */

export type GrantStatus = "pending" | "approved" | "denied";

/** The (user, client) pair a grant authorizes, taken from token introspection. */
export interface GrantSubject {
  user: string;
  client: string;
}

export interface Grant extends GrantSubject {
  status: GrantStatus;
  firstSeen: string;
  decidedAt?: string;
}

/**
 * Entries written before grants were keyed by client have no `client`. They
 * match no subject, so a previously approved user re-approves once per client.
 */
type StoredGrant = Omit<Grant, "client"> & { client?: string };

export interface GrantStore {
  get(subject: GrantSubject): Promise<Grant | null>;
  /** Records an unknown subject as pending. Returns the existing grant if one exists. */
  recordPending(subject: GrantSubject): Promise<Grant>;
  set(subject: GrantSubject, status: GrantStatus): Promise<Grant>;
  list(): Promise<StoredGrant[]>;
}

interface GrantsFile {
  grants: StoredGrant[];
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

  /** Client IDs are opaque and case-sensitive. Only the user is case-folded. */
  function normalize({ user, client }: GrantSubject): GrantSubject {
    return { user: user.trim().toLowerCase(), client: client.trim() };
  }

  function find(data: GrantsFile, subject: GrantSubject): Grant | undefined {
    const { user, client } = normalize(subject);
    return data.grants.find(
      (grant): grant is Grant => grant.user === user && grant.client === client,
    );
  }

  // Serializes load-modify-save cycles. Without this, two concurrent writes
  // can both load before either saves, and the second save silently discards
  // the first caller's entry (and its firstSeen timestamp).
  let queue: Promise<unknown> = Promise.resolve();
  function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  }

  return {
    async get(subject) {
      return find(await load(), subject) ?? null;
    },

    recordPending(subject) {
      return withWriteLock(async () => {
        const data = await load();
        const existing = find(data, subject);
        if (existing) return existing;
        const grant: Grant = {
          ...normalize(subject),
          status: "pending",
          firstSeen: new Date().toISOString(),
        };
        data.grants.push(grant);
        await save(data);
        return grant;
      });
    },

    set(subject, status) {
      return withWriteLock(async () => {
        const data = await load();
        let grant = find(data, subject);
        if (!grant) {
          grant = { ...normalize(subject), status, firstSeen: new Date().toISOString() };
          data.grants.push(grant);
        } else {
          grant.status = status;
        }
        grant.decidedAt = new Date().toISOString();
        await save(data);
        return grant;
      });
    },

    async list() {
      const data = await load();
      return data.grants;
    },
  };
}
