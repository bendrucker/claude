"""Runs the project's evals against a scripted model, so pass and fail vary by design.

Usage: fake_run.py <seen|held> <out>, from a setup.sh copy of the project.
"""

import sys
from collections import Counter
from pathlib import Path

from pydantic_ai.messages import ModelRequest, ModelResponse, SystemPromptPart, TextPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel

sys.path.insert(0, str(Path.cwd()))
import run_evals  # noqa: E402

LONG = "Paris, the capital and largest city of France, on the Seine river in the north"
RAMBLE = "Apollo 11 landed on the Moon in 1969 during the first crewed lunar mission, watched by millions"

# question -> variant -> one reply per repeat
SCRIPTS = {
    "seen": {
        "What is the capital of France?": {
            "with": ["Answer: Paris", "Answer: Paris"],
            "without": [f"The capital of France is {LONG}", "Paris."],
        },
        "What is 17 + 25?": {
            "with": ["Answer: 42", "Answer: 41"],
            "without": ["17 + 25 = 42.", "It is 42"],
        },
        "What is the chemical symbol for gold?": {
            "with": ["Answer: Au", "Answer: Au"],
            "without": ["Au", "Gold's symbol is Au."],
        },
        "In what year did Apollo 11 land on the Moon?": {
            "with": ["Answer: 1969", "Answer: 1970"],
            "without": ["1969", RAMBLE],
        },
    },
    "held": {
        "What is the capital of France?": {
            "with": ["Answer: Paris", f"Answer: {LONG}"],
            "without": [f"The capital of France is {LONG}", f"It is {LONG}"],
        },
        "What is 17 + 25?": {
            "with": ["Answer: 41", "Answer: 41"],
            "without": ["42", "I think 42"],
        },
        "What is the chemical symbol for gold?": {
            "with": ["Answer: Ag", "Answer: Au"],
            "without": ["Au", "Ag"],
        },
        "In what year did Apollo 11 land on the Moon?": {
            "with": ["Answer: 1969", "Answer: 1969"],
            "without": ["1970", RAMBLE],
        },
    },
}


def scripted(script):
    calls: Counter = Counter()

    def respond(messages, info):
        request = next(m for m in reversed(messages) if isinstance(m, ModelRequest))
        question = next(p.content for p in request.parts if isinstance(p, UserPromptPart))
        has_prompt = any(isinstance(p, SystemPromptPart) for m in messages if isinstance(m, ModelRequest) for p in m.parts)
        variant = "with" if has_prompt else "without"
        i = calls[variant, question]
        calls[variant, question] += 1
        return ModelResponse(parts=[TextPart(script[question][variant][i])])

    return FunctionModel(respond)


if __name__ == "__main__":
    mode, out = sys.argv[1], Path(sys.argv[2])
    run_evals.run(scripted(SCRIPTS[mode]), out)
