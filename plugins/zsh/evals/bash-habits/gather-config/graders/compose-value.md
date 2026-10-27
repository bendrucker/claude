---
type: regex
pattern: 'db:5432/orders'
match: contains
---
The reply gives the compose file's `DATABASE_URL`, which only a command that reads `docker-compose.yml` finds.
