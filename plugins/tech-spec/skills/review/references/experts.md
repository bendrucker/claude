# Expert Review Personas

## Standard Personas

Always consider these:

| Persona | Focus Areas |
|---------|-------------|
| Security | Auth, data protection, input validation, secrets management |
| API design | Endpoint structure, naming, versioning, error handling |
| Database | Schema design, indexing, migrations, query performance |
| Frontend | Component structure, state management, user experience |
| Infrastructure | Deployment, secrets, environment config, observability |
| Reliability | Error handling, retries, fallbacks, graceful degradation |

## Dynamic Personas

Generate additional personas from spec content:

| Persona | When to Include |
|---------|-----------------|
| Integrations | Connecting to external APIs (Linear, Stripe, etc.) |
| Privacy | Handling user data or PII |
| Performance | Latency or throughput is critical |
| Accessibility | Adding user-facing features |
| Mobile | Changes affect mobile clients |
| Analytics | Adding telemetry or metrics |
| Data pipelines | ETL, batch processing, or data warehousing |

## Example Finding Batch

> **Security Findings**
>
> 1. API key storage: spec mentions environment variable but doesn't specify secret rotation strategy
> 2. Input validation: feedback comment has max length but no sanitization mentioned
> 3. Rate limiting: no mention of rate limits on feedback endpoint
>
> How should we address these?
