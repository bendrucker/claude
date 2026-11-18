# Measurement Lens

Check that the plan proves its change works with a loop that fits the change type.

Classify the change: deterministic code, model behavior, performance, UI, or infra and config. Then check the plan's Measurement against that type:

- Deterministic code: a failing test written first.
- Model behavior: an eval suite run, with a baseline arm.
- Performance: a benchmark before and after, and a profile before choosing the fix.
- UI: before and after screenshots.
- Infra or config: observation of the live system.

For each loop, check that the plan names a signal that catches a wrong change the test suite misses, states whether each metric is informational or a target, and names the artifact the loop leaves. Confirm each named command, query, suite, or path exists, citing where.

Report each gap with the loop the plan should use instead and the artifact it should name. Report "measurement fits" when none apply.
