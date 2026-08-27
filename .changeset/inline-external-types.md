---
"vinfer": minor
---

Add `--inline-external-types` (config `inlineExternalTypes`) to replace an `import("...")` reference to a plain type reached through an explicit `v.GenericSchema<T>` annotation with that type's own structure, recursively across as many files as needed, instead of leaving the generated output pointing back at them. Off by default; existing generated output is unchanged unless the flag is set.

- A reference that would recurse into itself, directly or through another file, is left as a resolvable `import(...)` at the point it would repeat. A same-file type that isn't exported has no importable name to fall back to, so a cycle through one is left as a bare (unresolved) identifier instead - the same known limitation already documented for a local explicit annotation.
- A reference reached through a recursed-into file's own imports - printed by TypeScript as a bare name valid only in that file's own scope - is re-anchored to the same explicit, resolvable form before being embedded in the output.
- A qualified name (e.g. an enum member, `Kind.A`) or a generic instantiation (`Box<string>`) is never expanded, only referenced - expanding just the base name would strand the rest against whatever replaced it.
- A `typeof` operand and a method signature's own name are never expanded either, only referenced - substituting either would produce invalid syntax.
- An enum whose member value ts-morph cannot statically resolve (e.g. initialized from a function call) is left unexpanded entirely, rather than silently printing a literal union narrower than the enum itself - this also fixes the same silent-narrowing bug in the existing (flag-independent) same-file enum expansion `resolveType()` already performed.

Ported from [toiroakr/zinfer#446](https://github.com/toiroakr/zinfer/pull/446), [#447](https://github.com/toiroakr/zinfer/pull/447), and their review-fix follow-ups.
