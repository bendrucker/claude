// Deterministic stand-in for a model: terse when the system prompt asks for it, chatty otherwise.
import process from "node:process";

/** @type {Record<string, string>} */
const ANSWERS = {
  "capital of France": "Paris",
  "largest planet": "Jupiter",
  "chemical symbol for gold": "Au",
  "author of Hamlet": "Shakespeare",
};

/** @type {Map<string, number>} */
const seen = new Map();

/** @param {string} text */
function hash(text) {
  let h = 0;
  for (const c of text) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

export default class StubProvider {
  id() {
    return "stub-model";
  }

  /** @param {string} prompt */
  callApi(prompt) {
    const question = Object.keys(ANSWERS).find((q) => prompt.includes(q));
    if (question === undefined) return Promise.resolve({ error: `unknown question in: ${prompt}` });
    const terse = prompt.includes("one short sentence");
    const n = seen.get(prompt) ?? 0;
    seen.set(prompt, n + 1);
    // Roughly one reply in three loses its answer, so repeats and seeds disagree.
    // oxlint-disable-next-line typescript/no-unsafe-member-access -- node types do not reach this directory
    const slip = hash(`${process.env.STUB_SEED ?? "0"}:${question}:${terse}:${n}`) % 3 === 0;
    const answer = slip ? "I am not sure" : ANSWERS[question];
    const output = terse
      ? `${answer}.`
      : `Great question! Let me think about the ${question} for a moment. The answer is ${answer}, as far as I can tell, though there is more to say about it.`;
    return Promise.resolve({ output });
  }
}
