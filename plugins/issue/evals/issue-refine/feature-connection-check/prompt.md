Refine this into an issue:

Users connect third-party tools through OAuth, and when a connection silently breaks (revoked token, expired PKCE state, vendor outage) nothing tells them until a chat fails mid-answer. Add a way to check whether a connection still works, independent of chats.

Notes from the planning discussion:
- Endpoint: we settled on `POST /api/oauth/connection/check`, taking a connection id and returning ok or a failure reason. Not a GET, because the check makes an outbound call.
- Open: should the check reprobe automatically on a schedule? Decided no: out of scope for now, the endpoint is on demand only.
- Open: should runtime failures during a chat write back to the integration status? Decided no for now; we don't want chat errors flipping status.
- Open: does the vendor's access policy filter at the tool level or only the server level? Unknown. Nobody has tested it. It decides whether the check needs to call a specific tool or just the server's health endpoint.
- Open: what timeout should the check use? Not discussed.
- Open: PKCE state expiry. It's a real bug but separate, and gets its own issue.
- Failure reasons we've seen: token revoked (401 from vendor), PKCE state expired, vendor 5xx, network timeout.

Files:
- api/oauth/routes.py (connect and callback routes; no check route yet)
- api/oauth/client.py (VendorClient.call_tool and VendorClient.health)
- api/integrations/status.py (IntegrationStatus enum and the status column)

Related issues:
- TEAM-2440 — PKCE state expires before slow users finish consent — https://tracker.example.com/issue/TEAM-2440
