---
"vinfer": patch
---

Fix a recursive getter field wrapped in `v.nullable()` losing its `| null` and being wrongly printed as an optional key (`?`) rather than a required one with a nullable value. `v.nullable()` and `v.undefinedable()` widen a field's value type without making the object key itself optional - unlike `v.optional()`, `v.exactOptional()`, and `v.nullish()`, which do. The getter resolver previously collapsed all of these into a single "is this wrapped in something" flag, so a `v.nullable()`-only recursive field ended up both missing `| null` in its printed type and incorrectly marked optional; a `v.undefinedable()`-only one was missing `| undefined` while also incorrectly marked optional. Both are now derived independently from the AST, matching Valibot's own `OptionalEntrySchema` semantics.
