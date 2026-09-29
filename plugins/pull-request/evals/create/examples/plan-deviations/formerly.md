---
fail: []
---
Title: deploy: report machine count after deploy

After `fly deploy` and the health check, the skill now runs `fly status` and reports how many machines are running. That step needs `fly status` in allowed-tools, which this adds. The modes are now fast and verified (formerly quick and careful), since quick read as careless.
