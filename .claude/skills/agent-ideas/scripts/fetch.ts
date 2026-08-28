#!/usr/bin/env bun

import { cli } from "cleye";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { decode } from "../../../../packages/decode/index";
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

/** A parsed XML element: attributes keyed `@_name`, children keyed by tag name. */
const Element = z.record(z.string(), z.unknown());
type Element = z.infer<typeof Element>;

// A repeated tag arrives as an array, a single one as a bare value.
function list<S extends z.ZodType>(item: S) {
  return z
    .union([z.array(item), item])
    .optional()
    .catch(undefined)
    .transform((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]));
}

const Elements = list(Element);
const Links = list(z.union([z.string(), Element]));

/** Normalize a parser value that may be a string, object, or array into a string. */
function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return text(value[0]);
  const element = Element.safeParse(value).data;
  if (element && "#text" in element) return text(element["#text"]);
  return "";
}

/** The first of several parser values that normalizes to a non-empty string. */
function firstText(...values: unknown[]): string {
  for (const value of values) {
    const normalized = text(value);
    if (normalized !== "") return normalized;
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
    .replace(/&#x([0-9a-fA-F]+);/g, (_: string, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_: string, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
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

/** Resolve the alternate link from an Atom entry's `link` field. */
function atomLink(link: unknown): string {
  const links = Links.parse(link);
  if (links.length === 0) return "";
  const alternate = links.find((l) => {
    const rel = typeof l === "string" ? undefined : l["@_rel"];
    return rel === "alternate" || rel == null;
  });
  const chosen = alternate ?? links[0];
  return typeof chosen === "string" ? chosen : text(chosen?.["@_href"]);
}

function parseAtom(feed: Element): Post[] {
  return Elements.parse(feed.entry).map((entry) => ({
    title: stripHtml(text(entry.title)),
    url: atomLink(entry.link),
    date: normalizeDate(firstText(entry.published, entry.updated)),
    excerpt: excerpt(firstText(entry.summary, entry.content)),
  }));
}

function parseRss(channel: Element): Post[] {
  return Elements.parse(channel.item).map((item) => ({
    title: stripHtml(text(item.title)),
    url: text(item.link),
    date: normalizeDate(firstText(item.pubDate, item["dc:date"])),
    excerpt: excerpt(firstText(item.description, item["content:encoded"])),
  }));
}

function normalizeDate(raw: string): string | null {
  if (raw === "") return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const element = Element.optional().catch(undefined);

const Document = z.looseObject({
  feed: element,
  rss: z.looseObject({ channel: element }).optional().catch(undefined),
  "rdf:RDF": element,
});

export function parseFeed(xml: string): Post[] {
  const doc = decode(Document, parser.parse(xml), "feed XML");
  if (doc.feed) return parseAtom(doc.feed);
  if (doc.rss?.channel) return parseRss(doc.rss.channel);
  // Some RSS 1.0 (RDF) feeds put items at the top level.
  if (doc["rdf:RDF"]) return parseRss(doc["rdf:RDF"]);
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
  if (post.date == null) return false;
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

  if (source.feedUrl == null || source.feedUrl === "") return base;

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
      .filter((post) => {
        const hint = source.topicHint;
        return hint == null || hint === "" || matchesTopic(post, hint);
      });
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
