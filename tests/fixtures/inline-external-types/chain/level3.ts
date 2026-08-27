export type Level3 = "x" | "y" | "z";

// A function type as a union member, printed by TypeScript already
// parenthesized around the arrow: `((value: string) => string) | null`.
// Expanding this exercises the `=>` fix in hasTopLevelUnionOrIntersection -
// its `>` has no matching `<` to close, and without skipping it the scan's
// bracket depth goes negative right after, hiding the top-level "| null"
// that follows and skipping the parens it needs once embedded elsewhere.
export type Formatter = ((value: string) => string) | null;
