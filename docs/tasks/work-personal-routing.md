# Work versus personal routing

Decide whether a durable block goes to Linear (work) or GitHub (personal) by reading the git remote.

#### Context

Spec: [Work versus personal routing](../blocking-dispatch.md#work-versus-personal-routing). Matches where you already triage.

#### Depends on

- `dispatch-skill-scaffold.md`

#### Scope

A classifier that maps the current repo to a tracker:

- Read the git remote.
- A day-job org or host routes to Linear.
- A personal GitHub repo routes to GitHub Issues.
- When the remote is ambiguous or absent, ask once and carry the answer for the session.

#### Out of scope

The actuators that file into GitHub or Linear (their own tasks). This task answers which tracker.

#### Approach

Resolve the day-job org or host identifier (spec open question 1) and match the remote against it. Keep the mapping in one place the actuators read. Fail toward asking rather than guessing when the remote does not clearly match either side.

#### Acceptance criteria

- [ ] A work remote routes to Linear, a personal GitHub remote to GitHub.
- [ ] An ambiguous remote triggers a single question, then is remembered.
- [ ] The day-job identifier is recorded in one place.

#### References

- [blocking-dispatch.md, work versus personal routing](../blocking-dispatch.md#work-versus-personal-routing)
