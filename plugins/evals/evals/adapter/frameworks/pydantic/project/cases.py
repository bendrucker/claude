from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Contains

from evaluators import ShortReply, StartsWithAnswer

dataset = Dataset(
    name="trivia",
    cases=[
        Case(
            name="capital-france",
            inputs="What is the capital of France?",
            metadata={"tags": ["dev"]},
            evaluators=[Contains(value="Paris")],
        ),
        Case(
            name="sum",
            inputs="What is 17 + 25?",
            metadata={"tags": ["dev"]},
            evaluators=[Contains(value="42")],
        ),
        Case(
            name="chemical-symbol",
            inputs="What is the chemical symbol for gold?",
            metadata={"tags": ["holdout"]},
            evaluators=[Contains(value="Au")],
        ),
        Case(
            name="moon-landing",
            inputs="In what year did Apollo 11 land on the Moon?",
            metadata={"tags": ["holdout"]},
            evaluators=[Contains(value="1969")],
        ),
    ],
    evaluators=[StartsWithAnswer(), ShortReply()],
)
