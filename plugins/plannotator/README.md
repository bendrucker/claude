# Plannotator

Ben's layer over [Plannotator](https://github.com/backnotprop/plannotator), which it depends on as `plannotator@plannotator` for the hooks and inbox support. Plan review stays off through `PLANNOTATOR_PLAN_REVIEW=false` in `managed/settings.json`.

## Contents

- **Skill**: [`gate`](skills/gate) holds the working diff or a file for Ben's approval in Plannotator's browser UI and acts on his decision.
