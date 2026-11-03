Here's my draft of the latency metrics doc. Save it as `docs/metrics.rst` and add a section documenting the new `p95_ms` column: the 95th percentile request latency per service per day, in milliseconds.

```rst
Latency Metrics
===============

The ``latency_daily`` job runs nightly; it writes one row per service to the warehouse.

It's important to note that timestamps are stored in UTC.

Rows are partitioned by day.

Dashboards leverage these rows to chart each service's tail latency.

The job is idempotent, so a rerun overwrites the day's rows.

The trend line is fit with robust regression, so a single outage day barely moves it.

Rows older than 400 days are very rarely queried and are archived monthly.
```
