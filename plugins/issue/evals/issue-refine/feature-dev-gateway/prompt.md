Refine this into an issue:

Add a DEV_GATEWAY_URL env var and change `resolveGatewayUrl()` in gateway/config.ts to return it whenever NODE_ENV isn't production, so local development and preview deploys stop sending traffic through the production gateway. Developers should be able to do whatever they want against the dev gateway. There are exactly two gateways, development and production. The demo environment is a production customer environment and uses the production gateway.

Files:
- gateway/config.ts (resolveGatewayUrl returns PROD_GATEWAY_URL unconditionally)
- deploy/preview.yaml (preview deploys set NODE_ENV=preview)
