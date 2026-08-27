---
"vinfer": patch
---

Port several bug fixes from `toiroakr/zinfer`, plus two related fixes found while porting them:

- Fix an enum-to-literal-union expansion bug: when a native `enum` referenced through `v.enum()` had a member whose value couldn't be statically resolved (e.g. initialized from a function call), the generated type silently dropped that member instead of the whole union, printing a type narrower than the enum itself and rejecting values TypeScript accepts. It now leaves the enum unexpanded in that case.
- Fix three occurrences of a naive string-literal boundary check (`prevChar !== "\\"`) that misjudged a string ending in an even number of backslashes (e.g. `"a\\\\"`) as still escaped. Replaced with the correct backslash-parity check already used elsewhere in the codebase, shared through a new `string-scan.ts` module.
- Fix `__Normalize` silently stripping the brand's symbol key - and with it the brand itself - from a schema branded as a whole object (`v.pipe(v.object({...}), v.brand("Tag"))`), instead of only from a branded field inside an object. (The same gap for a directly-branded tuple is deliberately left open; see the comment on `NORMALIZE_TYPE_DEFINITION` in `normalizer.ts` for why.)
- Use Windows-compatible directory junctions instead of symlinks in the CLI runner tests, matching zinfer.
