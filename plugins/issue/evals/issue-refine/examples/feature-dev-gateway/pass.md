---
fail: []
---
<issue>
---
title: Route development and preview traffic through the dev gateway
type: feature
---

Local development and preview deploys send traffic through the production gateway. Point every non-production environment at a development gateway that developers can use freely. There are two gateways, development and production. Demo is a production customer environment and stays on production.

## 🤖 Agent Context

- `resolveGatewayUrl` in `gateway/config.ts` returns `PROD_GATEWAY_URL` unconditionally
</issue>
