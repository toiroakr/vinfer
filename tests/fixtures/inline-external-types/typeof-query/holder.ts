import { Kind } from "./kind";

// `typeof Kind` is a type query pointing at the enum's own value, not at
// its type - expanding Kind into its literal union here would print
// `typeof ("a" | "b")`, which isn't valid TypeScript (`typeof` only takes
// an identifier/qualified-name expression, never a type). This must stay
// a reference, never be expanded, regardless of which code path reaches
// it (see direct-schema.ts and wrapper.ts below for the two different
// paths).
export type Holder = { value: typeof Kind };
