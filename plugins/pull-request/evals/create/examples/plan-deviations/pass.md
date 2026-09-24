---
fail: []
---
Title: deploy: report machine count after deploy

After `fly deploy` and the health check, the skill now runs `fly status` and reports how many machines are running, so a deploy that leaves fewer machines up is visible. That step needs `fly status` in allowed-tools, which this adds. The modes are renamed from quick/careful to fast/verified.
