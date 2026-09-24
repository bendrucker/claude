---
fail: [diff-block, diff-shows-move]
---
Create `src/server/config.ts`:

```ts
export const config = { port: Number(process.env.PORT ?? 3000) };
```

and `src/jobs/config.ts` with the job settings, then delete `src/config.ts`.
