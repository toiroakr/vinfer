import type { Holder } from "./holder";

// Holder isn't visible from schema.ts (only Wrapper is imported there), so
// reaching it recurses through this file's own declaration - where Kind
// and Box *are* visible - exercising the qualified-name/generic promotion
// path rather than the top-level import(...) synthesis path (see
// direct-schema.ts for that one).
export type Wrapper = { holder: Holder };
