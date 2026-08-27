import type { Foo } from "virtual-lib";

// virtual-lib is an ambient module (see ./ambient.d.ts) - a bare package
// specifier, not a relative or absolute path. TypeScript's printer
// synthesizes import("virtual-lib").Foo for it exactly as it would for a
// real node_modules package.
export type Holder = { foo: Foo };
