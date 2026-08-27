import type { Declared } from "./declared";

// Declared is visible here (imported for this file's own use), so
// expanding Holder's own declaration prints this field as the bare
// identifier "Declared" - exercising promoteBareTypeReferences's lookup
// against a .d.ts-declared type, not just a .ts one.
export type Holder = { declared: Declared };
