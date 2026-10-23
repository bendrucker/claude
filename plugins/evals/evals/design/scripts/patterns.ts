/** A JSON string body: anything but an unescaped quote. */
export const STR = String.raw`(?:[^"\\]|\\.)*`;

/** Leading keys of a tool input before the one a pattern reads. */
const KEYS = String.raw`(?:"[a-z_]+":(?:"${STR}"|true|false),)*?`;

const FLOW_TAGS = String.raw`(?:[^\]"\\]|\\.)*`;
const BLOCK_ITEM = String.raw`(?:\\n *- *["']?[\w-]+["']?)*?\\n *- *["']?`;

/** Lookaheads that each search a JSON string value from its start. */
function within(checks: string[]): string {
  return checks.map((c) => `(?=${STR}(?:${c}))`).join("");
}

/**
 * A `Write` or `Edit` tool call in the trace whose content (or new text) satisfies every
 * check. Anchoring on the tool call keeps the injected skill text and the prompt out of the
 * match, and walking the input keys keeps it independent of their order.
 */
export function written(...checks: string[]): string {
  return String.raw`"name":"(?:Write|Edit)","input":\{${KEYS}"(?:content|new_string)":"${within(checks)}`;
}

/** A `Write` or `Edit` call with any field satisfying every check, such as a path. */
export function touched(...checks: string[]): string {
  return String.raw`"name":"(?:Write|Edit)","input":\{${KEYS}"[a-z_]+":"${within(checks)}`;
}

/**
 * A `Write` to a path matching `path` with content satisfying every check, in either key
 * order of the serialized input.
 */
export function writtenTo(path: string, ...checks: string[]): string {
  const body = within(checks);
  return [
    String.raw`"name":"Write","input":\{"file_path":"${STR}(?:${path})","content":"${body}`,
    String.raw`"name":"Write","input":\{"content":"${body}${STR}","file_path":"${STR}(?:${path})"`,
  ]
    .map((p) => `(?:${p})`)
    .join("|");
}

/** The tag list of a `case.yaml` names every token, as a flow list or a block list. */
export function tagged(...tokens: string[]): string {
  const flow = tokens
    .slice(0, -1)
    .map((t) => `(?=${FLOW_TAGS}\\b${t}\\b)`)
    .join("");
  const block = tokens
    .slice(0, -1)
    .map((t) => `(?=${BLOCK_ITEM}${t}\\b)`)
    .join("");
  const last = tokens.at(-1) ?? "";
  return `tags:(?: ?\\[${flow}${FLOW_TAGS}\\b${last}\\b|${block}${BLOCK_ITEM}${last}\\b)`;
}

/**
 * A line of the reply's case list whose tags, after the first `|`, name every token in any order.
 * Read with the `m` flag.
 */
export function listed(...tokens: string[]): string {
  return `^[^|\\n]*\\|${tokens.map((t) => `(?=[^\\n]*\\b${t}\\b)`).join("")}`;
}

/** The judge model of a `suite.yaml`, anything but the model under test. */
export const JUDGE_MODEL = String.raw`judge_model: ?\\?["']?claude-(?!sonnet-5-5\b)`;

/** An `LLMJudge(...)` call, allowing one level of parentheses inside. */
const CALL_ARG = String.raw`(?:[^()]|\([^()]*\))`;

/** An `LLMJudge` call with no `model=` or the model under test. */
export const PYDANTIC_JUDGE_UNSET = String.raw`LLMJudge\((?:(?!\bmodel=)${CALL_ARG})*\)|LLMJudge\(${CALL_ARG}*?\bmodel=\\?["']anthropic:claude-sonnet-5-5`;

/** An `LLMJudge` call whose arguments never state a pass bar. */
export const PYDANTIC_JUDGE_NO_BAR = String.raw`LLMJudge\((?:(?!pass)${CALL_ARG})*\)`;

/** A grader file with `type: llm` and no pass bar anywhere in it. */
export const LLM_NO_BAR = String.raw`"name":"(?:Write|Edit)","input":\{${KEYS}"(?:content|new_string)":"(?=${STR}type: llm)(?!${STR}pass)`;

/** A grader file with `type: regex` and no `not_contains`, carrying a fact that must survive. */
export function survival(fact: string): string {
  return String.raw`"name":"(?:Write|Edit)","input":\{${KEYS}"(?:content|new_string)":"(?=${STR}type: regex)(?!${STR}not_contains)(?=${STR}${fact})`;
}

/** A grader file that fails a reply for containing text. */
export const REMOVAL = written(String.raw`match: ?\\?["']?not_contains`);

/** Text that belongs in a grader and not in a fixture. */
export const GRADER_TEXT = String.raw`type: (?:regex|llm|tool_used|file_exists)|\bgraders?\b|\bpass bar\b|\bpattern:`;

/** Where a session keeps a case's fixture. */
export const FIXTURE_PATH = String.raw`/(?:fixtures?/${STR}|(?:fixtures?|scaffold|setup|repo)[^"/\\]*)`;

/** A `Write` or `Edit` to a path matching `path`, whatever order the input keys serialize in. */
export function toPath(path: string): string {
  return String.raw`"name":"(?:Write|Edit)","input":\{${KEYS}"file_path":"${STR}(?:${path})"`;
}
