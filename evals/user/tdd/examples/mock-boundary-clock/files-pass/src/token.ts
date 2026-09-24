export function isExpired(token: Token, now: () => number = Date.now): boolean {
