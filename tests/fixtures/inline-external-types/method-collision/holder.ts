import type { Box, GenericBox } from "./box";

// Box() is a method signature, not a type reference - even though its
// name collides with the imported type Box. Substituting the method name
// with Box's expanded structure would corrupt the method signature into
// invalid syntax (`{ value: string }(): string`). Only reached through
// bare-reference promotion (see wrapper.ts): TypeScript's own top-level
// synthesis never produces this ambiguity, since it always prefixes with
// `import("...").`.
//
// GenericBox<T extends (x: string) => void>() is the same collision, but
// with the method's own type parameter list: `<T ...>` reads like a
// generic type instantiation (GenericBox<Args>) at a glance, so this
// exercises the guard that tells the two apart by checking whether `(`
// follows the closing `>`. The constraint's own arrow-function type carries
// a `>` that never opened a matching `<` - exercising the same exclusion
// hasTopLevelUnionOrIntersection needs for an arrow type, here inside the
// balanced-<...> scan instead.
export type Holder = {
  Box(): string;
  GenericBox<T extends (x: string) => void>(): T;
  value: Box;
  boxed: GenericBox<string>;
};
