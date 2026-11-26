# Many Units

Use this when the same change repeats across many units, such as fifty scripts moving to a new argument parser or every call site of one library moving to another. Past about five units, or once the work outgrows one session's context, pilot by hand and then run a workflow over the rest.

## Pilot

Do one to three units by hand, picked to span the variation. Include the largest unit and the one with the most unusual use. Run the full method on each, harness and ledger included.

Record the pilot findings in a recipe file beside the ledger, such as `tmp/<task>/recipe.md`:

- The transformation, as steps a fresh agent can follow without this conversation.
- Each quirk the pilots hit, with how to detect it in another unit and how it was settled.
- The per-unit verification command and what a pass looks like.
- The parts a codemod can do (`ast-grep`, `jscodeshift`, `comby`, `sed` over a fixed pattern), and the parts that need judgment.

Run the codemod for the mechanical part before any agent starts. Agents handle only what the codemod leaves.

## Workflow

Author a workflow with the Workflow tool that applies the recipe to the remaining units, one agent per unit or per small batch. Each agent:

- Reads the recipe and its units, and nothing about the pilot conversation.
- Runs the per-unit verification and returns its result with any new ledger rows.
- Returns a unit that does not fit the recipe as unfit, with the reason.

Add a verify stage that reruns each unit's check independently of the agent that changed it, and an audit stage that reviews the diffs for special cases, weakened assertions, and edits to the harness.

When unfit units cluster around one cause, update the recipe and rerun only those units. Do the stragglers by hand.

When the Workflow tool is unavailable, dispatch one `Agent` per batch with the same brief. Without either, work through the units inline in recipe order, and say so.

## Order and Routing

- Move leaves before the units that depend on them. Each unit's dependencies are then already on the new side.
- While old and new coexist, route each caller to one side through one point, such as a re-export or a flag. Callers move by flipping their route, and the routing point goes in the cutover change.
- Instrumenting the oracle with extra checkpoints is an edit to the oracle. Commit it alone, and run the oracle's own tests against it before trusting its output.
