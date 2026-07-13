import { describe, expect, test } from "bun:test";
import {
  bearerToken,
  createVerifier,
  discoverIntrospectionEndpoint,
  protectedResourceMetadata,
  resourceMetadataUrl,
  wwwAuthenticate,
} from "./auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("protectedResourceMetadata", () => {
  test("builds RFC 9728 document", () => {
    expect(
      protectedResourceMetadata("https://idp.example.ts.net", "https://host.example.ts.net/mcp"),
    ).toEqual({
      resource: "https://host.example.ts.net/mcp",
      authorization_servers: ["https://idp.example.ts.net"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "email", "profile"],
    });
  });
});

describe("resourceMetadataUrl", () => {
  test.each([
    [
      "https://host.example.ts.net/mcp",
      "https://host.example.ts.net/.well-known/oauth-protected-resource/mcp",
    ],
    [
      "https://host.example.ts.net/",
      "https://host.example.ts.net/.well-known/oauth-protected-resource",
    ],
  ])("%s -> %s", (resource, expected) => {
    expect(resourceMetadataUrl(resource)).toBe(expected);
  });

  test("wwwAuthenticate embeds the metadata URL", () => {
    expect(wwwAuthenticate("https://host.example.ts.net/mcp")).toBe(
      'Bearer resource_metadata="https://host.example.ts.net/.well-known/oauth-protected-resource/mcp"',
    );
  });
});

describe("bearerToken", () => {
  test.each<[string, string | undefined, string | null]>([
    ["extracts token", "Bearer abc123", "abc123"],
    ["rejects other schemes", "Basic abc123", null],
    ["rejects missing header", undefined, null],
  ])("%s", (_name, header, expected) => {
    expect(bearerToken(header)).toBe(expected);
  });
});

describe("discoverIntrospectionEndpoint", () => {
  test("returns introspection_endpoint from AS metadata", async () => {
    const fetcher = async () =>
      jsonResponse({ introspection_endpoint: "https://idp.example.ts.net/introspect" });
    expect(await discoverIntrospectionEndpoint("https://idp.example.ts.net", fetcher)).toBe(
      "https://idp.example.ts.net/introspect",
    );
  });

  test.each<[string, () => Promise<Response>, string]>([
    ["missing endpoint", async () => jsonResponse({}), "introspection_endpoint missing"],
    ["non-ok response", async () => jsonResponse({}, 500), "Failed to fetch"],
  ])("throws on %s", async (_name, fetcher, message) => {
    expect(discoverIntrospectionEndpoint("https://idp.example.ts.net", fetcher)).rejects.toThrow(
      message,
    );
  });
});

describe("createVerifier", () => {
  test("caches active tokens until expiry", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return jsonResponse({ active: true, exp: Math.floor(Date.now() / 1000) + 3600 });
    };
    const verify = createVerifier("https://idp/introspect", {}, fetcher);

    const first = await verify("token-a");
    const second = await verify("token-a");
    expect(first?.active).toBe(true);
    expect(second).toBe(first);
    expect(calls).toBe(1);

    await verify("token-b");
    expect(calls).toBe(2);
  });

  test.each<[string, () => Promise<Response>]>([
    ["inactive token", async () => jsonResponse({ active: false })],
    ["introspection failure", async () => jsonResponse({}, 500)],
  ])("returns null on %s without caching", async (_name, fetcher) => {
    let calls = 0;
    const counting = async () => {
      calls++;
      return fetcher();
    };
    const verify = createVerifier("https://idp/introspect", {}, counting);
    expect(await verify("bad")).toBeNull();
    expect(await verify("bad")).toBeNull();
    expect(calls).toBe(2);
  });

  const RESOURCE = "https://host.example.ts.net/mcp";

  test.each<{ name: string; aud: unknown; expected: boolean }>([
    { name: "aud array containing the resource", aud: ["client-1", RESOURCE], expected: true },
    { name: "aud string equal to the resource", aud: RESOURCE, expected: true },
    {
      name: "aud for a different resource",
      aud: ["https://host.example.ts.net/other"],
      expected: false,
    },
    { name: "missing aud", aud: undefined, expected: false },
  ])("resource option: $name", async ({ aud, expected }) => {
    const fetcher = async () => jsonResponse({ active: true, aud });
    const verify = createVerifier("https://idp/introspect", { resource: RESOURCE }, fetcher);
    const info = await verify("token");
    expect(info !== null).toBe(expected);
  });
});
