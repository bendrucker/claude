#!/usr/bin/env bun

import { cli } from "cleye";
import { XMLParser } from "fast-xml-parser";
import { type Source, sources } from "../sources";

export interface Post {
  title: string;
  url: string;
  /** ISO 8601 date string, or null when the feed omits one. */
  date: string | null;
  excerpt: string;
}

export interface FetchResult {
  source: string;
  sourceType: Source["sourceType"];
  feedUrl: string | null;
  posts: Post[];
  /** Populated when the feed could not be fetched or parsed. */
  error?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Large full-content feeds (e.g. Simon Willison's "everything") trip the
  // built-in entity-expansion DoS guard. Skip parser-side entity decoding and
  // let stripHtml handle the common entities when building excerpts.
  processEntities: false,
});

/** Normalize a parser value that may be a string, object, or array into a string. */
function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("#text" in record) return text(record["#text"]);
  }
  return "";
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

function stripHtml(html: string): string {
  // Decode entities before stripping tags so escaped markup (e.g. &lt;b&gt;)
  // becomes real tags and gets removed rather than leaking into the excerpt.
  return decodeEntities(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(html: string, limit = 320): string {
  const clean = stripHtml(html);
  return clean.length > limit ? `${clean.slice(0, limit).trimEnd()}…` : clean;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Resolve the alternate link from an Atom entry's `link` field. */
function atomLink(link: unknown): string {
  const links = asArray(link as Record<string, unknown> | Record<string, unknown>[]);
  if (links.length === 0) return "";
  const alternate = links.find((l) => l?.["@_rel"] === "alternate" || l?.["@_rel"] == null);
  const chosen = alternate ?? links[0];
  return typeof chosen === "string" ? chosen : text(chosen?.["@_href"]);
}

function parseAtom(feed: Record<string, unknown>): Post[] {
  return asArray(feed.entry as Record<string, unknown> | Record<string, unknown>[]).map(
    (entry) => ({
      title: stripHtml(text(entry.title)),
      url: atomLink(entry.link),
      date: normalizeDate(text(entry.published) || text(entry.updated)),
      excerpt: excerpt(text(entry.summary) || text(entry.content)),
    }),
  );
}

function parseRss(channel: Record<string, unknown>): Post[] {
  return asArray(channel.item as Record<string, unknown> | Record<string, unknown>[]).map(
    (item) => ({
      title: stripHtml(text(item.title)),
      url: text(item.link),
      date: normalizeDate(text(item.pubDate) || text(item["dc:date"])),
      excerpt: excerpt(text(item.description) || text(item["content:encoded"])),
    }),
  );
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseFeed(xml: string): Post[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  if (doc.feed) return parseAtom(doc.feed as Record<string, unknown>);
  const rss = doc.rss as Record<string, unknown> | undefined;
  if (rss?.channel) return parseRss(rss.channel as Record<string, unknown>);
  // Some RSS 1.0 (RDF) feeds put items at the top level.
  if (doc["rdf:RDF"]) {
    const rdf = doc["rdf:RDF"] as Record<string, unknown>;
    return parseRss(rdf);
  }
  return [];
}

function matchesTopic(post: Post, topicHint: string): boolean {
  const keywords = topicHint
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  if (keywords.length === 0) return true;
  const haystack = `${post.title} ${post.excerpt}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function withinDays(post: Post, days: number, now: number): boolean {
  if (!post.date) return false;
  const age = now - new Date(post.date).getTime();
  return age >= 0 && age <= days * 24 * 60 * 60 * 1000;
}

export async function fetchSource(source: Source, days: number, now: number): Promise<FetchResult> {
  const base: FetchResult = {
    source: source.name,
    sourceType: source.sourceType,
    feedUrl: source.feedUrl,
    posts: [],
  };

  if (!source.feedUrl) return base;

  try {
    const response = await fetch(source.feedUrl, {
      headers: { "User-Agent": "agent-ideas/1.0 (+https://github.com/bendrucker/claude)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return { ...base, error: `HTTP ${response.status}` };
    }
    const xml = await response.text();
    const posts = parseFeed(xml)
      .filter((post) => withinDays(post, days, now))
      .filter((post) => (source.topicHint ? matchesTopic(post, source.topicHint) : true));
    return { ...base, posts };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function fetchAll(
  selected: Source[],
  days: number,
  now: number,
): Promise<FetchResult[]> {
  return Promise.all(selected.map((source) => fetchSource(source, days, now)));
}

if (import.meta.main) {
  const argv = cli({
    name: "fetch",
    flags: {
      days: {
        type: Number,
        description: "Look back this many days for posts",
        default: 8,
      },
      source: {
        type: [String],
        description: "Only fetch sources whose name contains this (repeatable, case-insensitive)",
      },
      includeXOnly: {
        type: Boolean,
        description: "Include x-only sources in the output (they have no feed and yield no posts)",
        default: false,
      },
    },
  });

  const filters = argv.flags.source.map((s) => s.toLowerCase());
  const selected = sources.filter((source) => {
    if (source.sourceType === "x-only" && !argv.flags.includeXOnly) return false;
    if (filters.length === 0) return true;
    return filters.some((filter) => source.name.toLowerCase().includes(filter));
  });

  const results = await fetchAll(selected, argv.flags.days, Date.now());
  console.log(JSON.stringify(results, null, 2));
}
