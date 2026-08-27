import type { Box } from "./box";

// Box() is a method signature, not a type reference - even though its
// name collides with the imported type Box. Substituting the method name
// with Box's expanded structure would corrupt the method signature into
// invalid syntax (`{ value: string }(): string`). Only reached through
// bare-reference promotion (see wrapper.ts): TypeScript's own top-level
// synthesis never produces this ambiguity, since it always prefixes with
// `import("...").`.
export type Holder = { Box(): string; value: Box };
