from dataclasses import dataclass

from pydantic_evals.evaluators import Evaluator, EvaluatorContext


@dataclass
class StartsWithAnswer(Evaluator[str, str]):
    """The reply follows the format the system prompt asks for."""

    def evaluate(self, ctx: EvaluatorContext[str, str]) -> bool:
        return ctx.output.startswith("Answer:")


@dataclass
class ShortReply(Evaluator[str, str]):
    """The reply stays within a word budget."""

    max_words: int = 12

    def evaluate(self, ctx: EvaluatorContext[str, str]) -> bool:
        return len(ctx.output.split()) <= self.max_words
