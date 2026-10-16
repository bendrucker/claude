Wrote `bench/CLIMB.md` and stopped at the end of the Frame.

The harness in `bench/` times the up-to-date exit: its fixture lockfile already matches the manifest, so it skips fetch and apply. The run maintainers wait on after a release takes 133.6s, mostly fetch (71.8s) and apply (57.9s). Every Rules item the brief left open is marked `assumed:`. The Checkpoint plans a release-sync harness before any baseline.
