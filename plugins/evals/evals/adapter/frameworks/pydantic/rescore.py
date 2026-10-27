"""Runs the project's current evaluators over the outputs stored in a reports directory.

Usage: rescore.py <reports>, from the project. Prints one JSON entry per stored run.
"""

import asyncio
import inspect
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path.cwd()))
from cases import dataset  # noqa: E402


async def verdict(evaluator, ctx):
    result = evaluator.evaluate(ctx)
    if inspect.isawaitable(result):
        result = await result
    return bool(getattr(result, "value", result))


async def main(reports: Path):
    cases = {c.name: c for c in dataset.cases}
    runs = []
    for file in sorted(reports.glob("*.json")):
        report = json.loads(file.read_text())
        seen: dict[str, int] = {}
        for stored in report["cases"]:
            name = stored["source_case_name"]
            ctx = SimpleNamespace(
                name=stored["name"],
                inputs=stored["inputs"],
                metadata=stored["metadata"],
                expected_output=stored["expected_output"],
                output=stored["output"],
            )
            graders = {
                e.get_serialization_name(): await verdict(e, ctx)
                for e in [*dataset.evaluators, *cases[name].evaluators]
            }
            runs.append({"arm": report["name"], "case": name, "run": seen.get(name, 0), "graders": graders})
            seen[name] = seen.get(name, 0) + 1
    print(json.dumps(runs))


asyncio.run(main(Path(sys.argv[1])))
