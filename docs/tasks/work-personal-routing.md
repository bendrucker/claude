# Work versus personal routing

Decide whether a durable block goes to Linear (work) or GitHub (personal) by reading the git remote.

#### Context

Spec: [Work versus personal routing](../blocking-dispatch.md#work-versus-personal-routing). Matches where you already triage.

#### Depends on

- `dispatch-skill-scaffold.md`

#### Scope

A classifier that maps the current repo to a tracker:

- Read the git remote.
- A remote matching a configured work pattern routes to Linear.
- Anything else routes to GitHub Issues.
- When no mapping is configured or the remote matches nothing, ask once and carry the answer for the session.

#### Out of scope

The actuators that file into GitHub or Linear (their own tasks). This task answers which tracker.

#### Approach

The work-remote mapping is proprietary and must not be committed to this public repository, since it identifies an employer. The skill reads the patterns from private local config, a gitignored file or an environment variable, and ships only the mechanism. The current rule is a match against a public-SaaS host, no custom domain. Keep the resolved mapping in one place the actuators read. Fail toward asking rather than guessing when the remote does not clearly match.

#### Acceptance criteria

- [ ] A work remote routes to Linear, any other remote to GitHub.
- [ ] An unmatched or unconfigured remote triggers a single question, then is remembered.
- [ ] No work-host identity appears in committed files. The mapping lives in private local config.

#### References

- [blocking-dispatch.md, work versus personal routing](../blocking-dispatch.md#work-versus-personal-routing)
