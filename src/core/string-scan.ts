/**
 * Checks whether the character at `index` is escaped by a preceding
 * backslash - one that itself is not escaped, so `\\"` (an escaped
 * backslash followed by an unescaped quote) does not count.
 */
export function isEscaped(str: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && str[i] === "\\"; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}
