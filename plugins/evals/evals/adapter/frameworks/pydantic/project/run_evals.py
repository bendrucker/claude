import argparse
from pathlib import Path

from pydantic_ai import Agent
from pydantic_evals.reporting import EvaluationReport
from pydantic import TypeAdapter

from cases import dataset

REPEATS = 2
PROMPT = Path("prompt.txt")


def run(model, out: Path) -> None:
    """Runs every case with the system prompt and without it, one report file per variant."""
    out.mkdir(parents=True, exist_ok=True)
    variants = {"with": PROMPT.read_text(), "without": None}
    for name, system_prompt in variants.items():
        agent = Agent(model, system_prompt=system_prompt or ())

        async def task(question: str) -> str:
            return (await agent.run(question)).output

        report = dataset.evaluate_sync(
            task, name=name, repeat=REPEATS, max_concurrency=1, progress=False
        )
        report.print()
        (out / f"{name}.json").write_bytes(
            TypeAdapter(EvaluationReport).dump_json(report, indent=2)
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("reports"))
    parser.add_argument("--model", default="anthropic:claude-haiku-4-5")
    args = parser.parse_args()
    run(args.model, args.out)
