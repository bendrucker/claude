#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/support evals
cat > pyproject.toml <<'TOML'
[project]
name = "support-bot"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = ["pydantic-ai", "pydantic-evals"]
TOML
cat > src/support/__init__.py <<'PY'
PY
cat > src/support/agent.py <<'PY'
from pydantic_ai import Agent

SYSTEM_PROMPT = """You answer customer questions for an online shop.

- For a refund request, state the refund window (30 days) and ask for the order id.
- For a shipping question, give the carrier's tracking steps and never promise a delivery date.
- Keep every reply under 80 words.
- For anything else, say you can only help with orders and refunds.
"""

agent = Agent("anthropic:claude-sonnet-5-5", system_prompt=SYSTEM_PROMPT)


async def answer(question: str) -> str:
    result = await agent.run(question)
    return result.output
PY
cat > evals/README.md <<'MD'
Evals for the support agent run with `pydantic-evals`: `python -m evals.run`.
MD
