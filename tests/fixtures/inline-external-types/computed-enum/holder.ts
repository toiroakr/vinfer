import { Kind } from "./kind";

// Kind is visible here (imported for this file's own use), so expanding
// Holder's own declaration prints this field as the bare identifier
// "Kind" - reaching it through promoteBareTypeReferences's own lookup,
// which calls printEnumAsLiteralUnion via resolveExternalTypeReference
// against kind.ts (where Kind is actually declared). Kind being merely
// imported - not declared - into schema.ts itself is deliberate: it keeps
// this fixture out of resolveType()'s own top-level `sourceFile.getEnum()`
// check, which only ever finds a same-file declaration and would silently
// skip straight past an imported name, exercising nothing.
export type Holder = { kind: Kind };
