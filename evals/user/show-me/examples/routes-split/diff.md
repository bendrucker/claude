---
fail: []
---
```diff
 src/
-├── routes.ts
+├── routes/
+│   ├── index.ts      # builds the router from the three files
+│   ├── users.ts
+│   ├── invoices.ts
+│   └── reports.ts
 ├── router.ts
 └── server.ts         # import path changes to ./routes
```
