---
"vinfer": patch
---

Fix `identifierPattern`-based name substitution in `type-printer.ts` rewriting an unrelated identifier that merely spells out another schema's generated `Input`/`Output` name.

An explicit `v.GenericSchema<T>` annotation prints `T` verbatim, so its own text can contain arbitrary identifiers - including one that happens to match another schema's generated name. Two positions were rewritten anyway even though neither is a type reference to that schema:

- the operand of a `typeof` type query (`typeof NodeInput`), corrupting a value reference into a type reference and producing a real compile error (`TS2693`)
- a method's own name (`NodeInput(): string`), corrupting the method signature into invalid syntax

Both positions are now excluded from every identifier substitution in the file - the schema-name-to-mapped-name rewrite, the recursion dependency lookup, and `mergeSame` unification.
