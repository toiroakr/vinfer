import type { Callback } from "./leaf";

// Callback is visible here (imported for this file's own use), so
// expanding Holder's own declaration prints this field as the bare
// identifier "Callback[]" - once promoted and expanded to Callback's own
// function-type structure, the array suffix must not silently bind to only
// the return type ("(value: string) => string[]" means something entirely
// different: a function returning string[]).
export type Holder = { callbacks: Callback[] };
