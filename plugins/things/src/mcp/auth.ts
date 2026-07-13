/**
 * OAuth resource-server pieces for the Things MCP server.
 *
 * tsidp issues opaque access tokens, so validation goes through its RFC 7662
 * introspection endpoint (discovered from the authorization-server metadata)
 * rather than local JWT verification.
 */

export interface Introspection {
  active: boolean;
  exp?: number;
  [claim: string]: unknown;
}

export type Verifier = (token: string) => Promise<Introspection | null>;

export type Fetcher = (url: string | URL, init?: RequestInit) => Promise<Response>;

const SCOPES = ["openid", "email", "profile"];

/** RFC 9728 protected-resource metadata document. */
export function protectedResourceMetadata(authServerUrl: string, resourceUrl: string) {
  return {
    resource: resourceUrl,
    authorization_servers: [authServerUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: SCOPES,
  };
}

export async function discoverIntrospectionEndpoint(
  authServerUrl: string,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const metadataUrl = new URL("/.well-known/oauth-authorization-server", authServerUrl);
  const response = await fetcher(metadataUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${metadataUrl}: ${response.status}`);
  }
  const metadata = (await response.json()) as Record<string, unknown>;
  const endpoint = metadata.introspection_endpoint;
  if (typeof endpoint !== "string") {
    throw new Error(`introspection_endpoint missing from ${metadataUrl}`);
  }
  return endpoint;
}

const MAX_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Verifies bearer tokens against the introspection endpoint, caching active
 * tokens until they expire (capped at five minutes so revocation is not
 * deferred indefinitely).
 */
export function createVerifier(introspectionEndpoint: string, fetcher: Fetcher = fetch): Verifier {
  const cache = new Map<string, { expires: number; info: Introspection }>();

  return async function verify(token: string): Promise<Introspection | null> {
    const cached = cache.get(token);
    if (cached && cached.expires > Date.now()) return cached.info;
    cache.delete(token);

    const response = await fetcher(introspectionEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    if (!response.ok) return null;

    const info = (await response.json()) as Introspection;
    if (!info.active) return null;

    const tokenExpiry = typeof info.exp === "number" ? info.exp * 1000 : 0;
    const expires = Math.min(
      tokenExpiry || Date.now() + MAX_CACHE_TTL_MS,
      Date.now() + MAX_CACHE_TTL_MS,
    );

    for (const [key, entry] of cache) {
      if (entry.expires <= Date.now()) cache.delete(key);
    }
    cache.set(token, { expires, info });
    return info;
  };
}

export function bearerToken(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer (.+)$/);
  return match?.[1] ?? null;
}

export function wwwAuthenticate(resourceUrl: string): string {
  const metadataUrl = resourceMetadataUrl(resourceUrl);
  return `Bearer resource_metadata="${metadataUrl}"`;
}

/** Path-inserted well-known URL per RFC 9728 §3 (resource path appended). */
export function resourceMetadataUrl(resourceUrl: string): string {
  const url = new URL(resourceUrl);
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}
