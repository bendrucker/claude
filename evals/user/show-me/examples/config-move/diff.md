```diff
 src/
-├── config.ts
 ├── server/
+│   ├── config.ts    # port, databaseUrl
 │   ├── index.ts
 │   └── db.ts
 └── jobs/
+    ├── config.ts    # jobConcurrency, smtpHost
     ├── worker.ts
     └── mailer.ts
```

Each importer switches from `../config` to `./config`.
