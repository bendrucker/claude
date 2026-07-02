/**
 * Curated source list for the weekly agent-tooling idea harvest.
 *
 * This is the prunable core of the skill: edit it directly to add, drop, or
 * retune sources. Keep it small and high-signal. A source earns its place by
 * regularly producing ideas that map to concrete artifacts in this repo.
 *
 * - `rss` / `blog` / `newsletter`: fetched automatically by `scripts/fetch.ts`.
 *   Set `feedUrl` to a working Atom/RSS URL.
 * - `x-only`: no usable feed; handled by the local triage phase via the
 *   browser fallback after teleport. Leave `feedUrl` null.
 * - `topicHint`: comma-separated keywords. Set it for large org feeds so the
 *   fetch only keeps agent/tooling-relevant posts. Omit for personal blogs
 *   where every post is already on-topic.
 */

export type SourceType = "rss" | "blog" | "newsletter" | "x-only";

export interface Source {
  /** Display name, used in the digest and as the `--source` filter key. */
  name: string;
  /** Atom/RSS feed URL, or null for `x-only` sources. */
  feedUrl: string | null;
  sourceType: SourceType;
  /** X handle without the `@`, or null. Used by the browser fallback. */
  xHandle: string | null;
  /** Comma-separated keywords to topic-filter large org feeds. */
  topicHint?: string;
}

export const sources: Source[] = [
  {
    name: "Simon Willison",
    feedUrl: "https://simonwillison.net/atom/everything/",
    sourceType: "rss",
    xHandle: "simonw",
  },
  {
    name: "Mario Zechner",
    feedUrl: "https://mariozechner.at/rss.xml",
    sourceType: "blog",
    xHandle: "badlogicgames",
  },
  {
    name: "Matt Pocock",
    feedUrl: "https://www.aihero.dev/rss.xml",
    sourceType: "newsletter",
    xHandle: "mattpocockuk",
  },
  {
    name: "Thariq Shihipar",
    feedUrl: "https://thariq.io/rss.xml",
    sourceType: "blog",
    xHandle: "trq212",
  },
  {
    name: "Cloudflare Blog",
    feedUrl: "https://blog.cloudflare.com/rss/",
    sourceType: "rss",
    xHandle: "CloudflareDev",
    topicHint: "agent,claude,mcp,llm,ai,tooling,coding,model context protocol",
  },
  {
    name: "Boris Cherny",
    feedUrl: null,
    sourceType: "x-only",
    xHandle: "bcherny",
  },
  {
    name: "Dillon Mulroy",
    feedUrl: null,
    sourceType: "x-only",
    xHandle: "dillon_mulroy",
  },

  {
    name: "Armin Ronacher",
    feedUrl: "https://lucumr.pocoo.org/feed.atom",
    sourceType: "blog",
    xHandle: "mitsuhiko",
  },

  {
    // humanlayer.dev is a Next.js app with no discoverable RSS feed; handled via
    // the browser fallback until a feed surfaces.
    name: "Dex Horthy",
    feedUrl: null,
    sourceType: "x-only",
    xHandle: "dexhorthy",
  },
  {
    name: "Mitchell Hashimoto",
    feedUrl: "https://mitchellh.com/feed.xml",
    sourceType: "blog",
    xHandle: "mitchellh",
  },
  {
    name: "Thomas Ptacek",
    feedUrl: "https://fly.io/blog/feed.xml",
    sourceType: "rss",
    xHandle: "tqbf",
    topicHint: "agent,claude,mcp,llm,ai,tooling,coding,model context protocol",
  },
  {
    name: "Vicki Boykis",
    feedUrl: "https://vickiboykis.com/index.xml",
    sourceType: "blog",
    xHandle: "vboykis",
  },
  {
    name: "Michael Ramos",
    feedUrl: "https://backnotprop.com/rss.xml",
    sourceType: "blog",
    xHandle: "backnotprop",
  },
];
