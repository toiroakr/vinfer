// Hidden isn't exported, so nothing can `import(...)` it - a cycle through
// it (its own self-reference below) has no resolvable fallback at all,
// unlike node-a.ts/node-b.ts's mutual cycle. This is the same limitation
// as a non-exported local explicit-annotation type: reaching it is left as
// the bare, unresolved identifier.
type Hidden = { self?: Hidden };

export type Middle = { hidden: Hidden };
