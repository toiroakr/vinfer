// A .d.ts file has no source extension to strip other than ".ts" itself -
// modulePathFor() has to recognize the ".d" suffix too, or the derived
// module specifier ("declared.d" instead of "declared") won't match what
// TypeScript's own printer synthesizes, breaking both cycle-detection keys
// and resolveModuleSourceFile()'s lookup.
export type Declared = { value: string };
