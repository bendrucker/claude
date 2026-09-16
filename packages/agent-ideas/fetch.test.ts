import { describe, expect, test } from "bun:test";
import { parseFeed } from "./fetch";

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example</title>
  <entry>
    <title>Agentic coding with Claude</title>
    <link rel="alternate" href="https://example.com/post-1"/>
    <published>2026-05-28T12:00:00Z</published>
    <summary>A &lt;b&gt;post&lt;/b&gt; about &amp; MCP tooling.</summary>
  </entry>
  <entry>
    <title>Second post</title>
    <link href="https://example.com/post-2"/>
    <updated>2026-05-20T08:00:00Z</updated>
    <content type="html">Body content here.</content>
  </entry>
</feed>`;

const rss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example RSS</title>
    <item>
      <title>RSS item one</title>
      <link>https://example.com/rss-1</link>
      <pubDate>Wed, 28 May 2026 12:00:00 GMT</pubDate>
      <description>&lt;p&gt;HTML stripped&lt;/p&gt; description.</description>
    </item>
  </channel>
</rss>`;

describe("parseFeed", () => {
  test("parses Atom entries with alternate links and HTML-stripped excerpts", () => {
    expect(parseFeed(atom)).toMatchInlineSnapshot(`
      [
        {
          "date": "2026-05-28T12:00:00.000Z",
          "excerpt": "A post about & MCP tooling.",
          "title": "Agentic coding with Claude",
          "url": "https://example.com/post-1",
        },
        {
          "date": "2026-05-20T08:00:00.000Z",
          "excerpt": "Body content here.",
          "title": "Second post",
          "url": "https://example.com/post-2",
        },
      ]
    `);
  });

  test("parses RSS items and normalizes pubDate to ISO", () => {
    expect(parseFeed(rss)).toMatchInlineSnapshot(`
      [
        {
          "date": "2026-05-28T12:00:00.000Z",
          "excerpt": "HTML stripped description.",
          "title": "RSS item one",
          "url": "https://example.com/rss-1",
        },
      ]
    `);
  });

  test("returns no posts for an unrecognized document", () => {
    expect(parseFeed("<html><body>not a feed</body></html>")).toEqual([]);
  });

  test("handles a single-entry feed without an array wrapper", () => {
    const single = `<rss version="2.0"><channel><item>
      <title>Lone item</title><link>https://example.com/x</link>
    </item></channel></rss>`;
    const posts = parseFeed(single);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.title).toBe("Lone item");
  });
});
