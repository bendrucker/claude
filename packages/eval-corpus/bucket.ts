export const BUCKET = "ben-drucker-agents-eval-corpus";

export type Direction = "pull" | "push";

/** The AWS profile each direction runs under by default: read-only to pull, admin to push. */
export const PROFILES = { pull: "agents", push: "agents-admin" } as const satisfies Record<
  Direction,
  string
>;

/** An `aws s3 sync` filter. Filters apply in order, and the last one matching a path decides it. */
export type Filter = { exclude: string } | { include: string };

/** A local directory mirrored to a key under its corpus's prefix. */
export interface Mirror {
  local: string;
  /** Key below the corpus prefix, or the prefix itself when omitted. */
  remote?: string;
  filters?: Filter[];
}

export interface Corpus {
  /** Top-level key in the bucket, one per suite. */
  prefix: string;
  /** Noun phrase for help text, such as "the plan gate corpus". */
  description: string;
  mirrors: Mirror[];
  afterPull?: () => Promise<void>;
}

export function key(corpus: Corpus, mirror: Mirror): string {
  return mirror.remote === undefined ? corpus.prefix : `${corpus.prefix}/${mirror.remote}`;
}

/** Skips top-level dot entries and everything under a top-level dot directory. */
export const DOTFILES: Filter = { exclude: ".*" };

export function filters(mirror: Mirror): Filter[] {
  return mirror.filters ?? [];
}

export function url(path: string): string {
  return `s3://${BUCKET}/${path}`;
}
