import { Kind } from "./kind";
import type { Box } from "./kind";

// A qualified name (an enum member, Kind.A) and a generic instantiation
// (Box<string>) - substituting only the identifier before the "." or "<"
// would strand the rest against whatever replaces it, so these are only
// ever referenced, never expanded.
export type Holder = { kind: Kind.A; box: Box<string> };
