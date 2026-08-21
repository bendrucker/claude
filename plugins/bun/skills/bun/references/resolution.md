# Resolution

## Flag Ordering

Runtime flags must precede the script path:

```bash
bun --cwd ./packages/app run dev
```

## TypeScript Imports

Never use `.js` extensions in TypeScript imports. Bun resolves `.ts`, `.tsx`, `.jsx`, and `.js` files natively.

```ts fragment
import { handler } from "./routes/auth";  // correct
import { handler } from "./routes/auth.js";  // wrong
```
