/**
 * Replacement token for code identifiers (paths, camelCase, snake_case,
 * inline code). A plain lowercase word so every tokenizer passes it
 * through intact and tags it noun-like. Adapters map it to CODE by
 * matching the normal form.
 */
export const CODE_SENTINEL = "codeterm";
