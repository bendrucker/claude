---
fail: [sequence-diagram, diagram-parties]
---
1. The admin page POSTs to the API and opens an EventSource.
2. The API pushes batches onto Redis.
3. The mailer worker pops them and calls SES.
