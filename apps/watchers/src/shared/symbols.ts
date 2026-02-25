export function parseSymbols(
  input: unknown,
  fallback: string[] = [],
): string[] {
  if (!input) return [...fallback];
  const value = String(input);
  return value
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}
