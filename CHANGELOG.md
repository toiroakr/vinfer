# vinfer

## 0.2.1

### Patch Changes

- 1b00ee4: Add `--brand-strategy` (config `brandStrategy`) to control how a `.brand()`/`.flavor()` marker is represented in the generated output.

  The existing behavior - printing `Brand<"Tag">`/`Flavor<"Tag">` and importing `Brand`/`Flavor` from `"valibot"` - is now `--brand-strategy valibot-import` (the default, unchanged). `--brand-strategy local-symbol` instead declares a single `unique symbol` per generated file and prints a self-contained `{ readonly [__brand]: "Tag" }` / `{ readonly [__flavor]?: "Tag" }` property, so the generated output never imports valibot.

  `--brand-strategy local-symbol` cannot be combined with `--generate-tests`, since the generated companion test asserts full type equality against `v.InferOutput<>`/`v.InferInput<>`, which always carries valibot's own `Brand<Tag>`/`Flavor<Tag>` for a branded/flavored schema - a local-symbol marker is intentionally a different (self-contained) shape.

  Ported from [toiroakr/zinfer#462](https://github.com/toiroakr/zinfer/pull/462).

## 0.2.0

### Minor Changes

- 3699f73: Add `--inline-external-types` (config `inlineExternalTypes`) to replace an `import("...")` reference to a plain type reached through an explicit `v.GenericSchema<T>` annotation with that type's own structure, recursively across as many files as needed, instead of leaving the generated output pointing back at them. Off by default; existing generated output is unchanged unless the flag is set.

  - A reference that would recurse into itself, directly or through another file, is left as a resolvable `import(...)` at the point it would repeat. A same-file type that isn't exported has no importable name to fall back to, so a cycle through one is left as a bare (unresolved) identifier instead - the same known limitation already documented for a local explicit annotation.
  - A reference reached through a recursed-into file's own imports - printed by TypeScript as a bare name valid only in that file's own scope - is re-anchored to the same explicit, resolvable form before being embedded in the output.
  - A qualified name (e.g. an enum member, `Kind.A`) or a generic instantiation (`Box<string>`) is never expanded, only referenced - expanding just the base name would strand the rest against whatever replaced it.
  - A `typeof` operand and a method signature's own name are never expanded either, only referenced - substituting either would produce invalid syntax.
  - An enum whose member value ts-morph cannot statically resolve (e.g. initialized from a function call) is left unexpanded entirely, rather than silently printing a literal union narrower than the enum itself - this also fixes the same silent-narrowing bug in the existing (flag-independent) same-file enum expansion `resolveType()` already performed.

  Ported from [toiroakr/zinfer#446](https://github.com/toiroakr/zinfer/pull/446), [#447](https://github.com/toiroakr/zinfer/pull/447), and their review-fix follow-ups.

### Patch Changes

- bf9a76e: Fix a recursive getter field wrapped in `v.nullable()` losing its `| null` and being wrongly printed as an optional key (`?`) rather than a required one with a nullable value. `v.nullable()` and `v.undefinedable()` widen a field's value type without making the object key itself optional - unlike `v.optional()`, `v.exactOptional()`, and `v.nullish()`, which do. The getter resolver previously collapsed all of these into a single "is this wrapped in something" flag, so a `v.nullable()`-only recursive field ended up both missing `| null` in its printed type and incorrectly marked optional; a `v.undefinedable()`-only one was missing `| undefined` while also incorrectly marked optional. Both are now derived independently from the AST, matching Valibot's own `OptionalEntrySchema` semantics.
- 4845e93: Port several bug fixes from `toiroakr/zinfer`, plus two related fixes found while porting them:

  - Fix an enum-to-literal-union expansion bug: when a native `enum` referenced through `v.enum()` had a member whose value couldn't be statically resolved (e.g. initialized from a function call), the generated type silently dropped that member instead of the whole union, printing a type narrower than the enum itself and rejecting values TypeScript accepts. It now leaves the enum unexpanded in that case.
  - Fix three occurrences of a naive string-literal boundary check (`prevChar !== "\\"`) that misjudged a string ending in an even number of backslashes (e.g. `"a\\\\"`) as still escaped. Replaced with the correct backslash-parity check already used elsewhere in the codebase, shared through a new `string-scan.ts` module.
  - Fix `__Normalize` silently stripping the brand's symbol key - and with it the brand itself - from a schema branded as a whole object (`v.pipe(v.object({...}), v.brand("Tag"))`), instead of only from a branded field inside an object. (The same gap for a directly-branded tuple is deliberately left open; see the comment on `NORMALIZE_TYPE_DEFINITION` in `normalizer.ts` for why.)
  - Use Windows-compatible directory junctions instead of symlinks in the CLI runner tests, matching zinfer.

## 0.1.4

### Patch Changes

- 91b7d99: Fix corrupted `import(...)` paths in generated types when the working directory or an absolute `--outDir`/`--outFile` path goes through a symlink (e.g. macOS's `/var` -> `/private/var` tmpdir). The absolute path built from the schema's source directory and the output directory could resolve from different symlink bases, so the relative path computed between them walked all the way up to the filesystem root instead of staying short - both are now resolved to their real, symlink-free path before being compared.
- 86c6809: Fix `identifierPattern`-based name substitution in `type-printer.ts` rewriting an unrelated identifier that merely spells out another schema's generated `Input`/`Output` name.

  An explicit `v.GenericSchema<T>` annotation prints `T` verbatim, so its own text can contain arbitrary identifiers - including one that happens to match another schema's generated name. Two positions were rewritten anyway even though neither is a type reference to that schema:

  - the operand of a `typeof` type query (`typeof NodeInput`), corrupting a value reference into a type reference and producing a real compile error (`TS2693`)
  - a method's own name (`NodeInput(): string`), corrupting the method signature into invalid syntax

  Both positions are now excluded from every identifier substitution in the file - the schema-name-to-mapped-name rewrite, the recursion dependency lookup, and `mergeSame` unification.

## 0.1.3

### Patch Changes

- da167f4: Fix generated-name matching in `type-printer.ts` for schemas named starting with
  `$` or with Unicode identifier characters. Every name-matching regex there used
  `\b`, which is defined in terms of `\w` (`[A-Za-z0-9_]`) and so never matches a
  name that starts with `$` (legal at the start of a JS/TS identifier) or with a
  Unicode letter. For a schema like `$NodeSchema`, this silently broke:

  - name-replacement during `mergeSame` unification, leaving the un-renamed
    `$NodeSchemaInput`/`$NodeSchemaOutput` in the generated output instead of the
    mapped name
  - cross-file `import type` detection, producing an empty `import type { }`
    instead of importing the actual name

  All of the file's name-matching regexes now use a shared identifier-aware
  boundary check instead of `\b`.

- fcbb017: Fix recursive schema generation.

  - A recursive getter now prints its self-reference straight away. When the getter
    carries an explicit return type, TypeScript unfolds one whole copy of the
    schema before it reaches the recursion; that copy is collapsed away, so
    `children: Record<string, Self>` prints as `children: { [x: string]: Self; }`
    instead of an extra level of the same shape.
  - `v.description()` now reaches fields behind an index signature. A record's
    value schema is described at the path of the field holding the record, so the
    index signature no longer counts as a path segment of its own and inlined
    levels keep their TSDoc.
  - A reference to a generated type now survives being nested inside a schema that
    generates none. A non-exported schema still has to be inlined, but it is
    inlined from its own resolved form, so the named references it holds are kept
    instead of the whole structure being re-expanded.
  - A recursive schema imported from another generated file is referenced by name
    and `import type`d from that file, instead of being inlined into an
    approximation that lost its recursion point. When nothing declares a name for
    a recursive schema - neither this file nor another generated one - the
    recursion point keeps the index signature or array the getter describes rather
    than collapsing to a bare `any`. An aliased import (`import { X as Y }`) is
    bridged with `as` so the generated `import type` names the schema's actual
    export rather than the local alias, which the declaring file never uses.
  - `mergeSame` now merges recursive schemas: the two directions of a schema that
    names itself are compared with those self-references unified, so a recursive
    schema whose input and output agree emits a single type plus `type XInput = X`.
  - An optional key no longer prints `| undefined` twice. A mapped type copying an
    optional property whose declared type already names `undefined` makes
    TypeScript's printer spell it once from the property's type and once for the
    optional key, which surfaced through any `v.GenericSchema<T>` annotation whose
    `T` wrote `foo?: string | undefined`.
  - The `import()` types an explicit annotation carries are now rewritten to reach
    from the output file. TypeScript prints those specifiers relative to the schema
    file, so a relative one (`./types`) resolved to nothing from the output
    directory; projects using path aliases were unaffected.

## 0.1.2

### Patch Changes

- 5fa97c1: Fix `peerDependencies` lower bounds that Renovate could silently narrow without any accompanying source change:

  - `renovate.json`'s top-level `"rangeStrategy": "bump"` applied to every dependency type, including `peerDependencies`, overriding Renovate's built-in `peerDependencies` safeguard (which only kicks in when `rangeStrategy` is left unset, i.e. `"auto"`). The top-level setting is now `"auto"`, and explicit `packageRules` entries restore the previous per-depType behavior: `dependencies` keeps `rangeStrategy: "bump"`, `devDependencies` now uses `rangeStrategy: "pin"` (exact versions instead of `^` ranges, removing the ambiguity of a plain `pnpm install` drifting outside the lockfile between Renovate runs), and `peerDependencies` gets no explicit `rangeStrategy` (so it falls back to Renovate's safe default of `"widen"`) plus `automerge: false`, so peer floor changes always go through review.
  - `typescript`: `>=5.0.0` verified working (typecheck via both `tsgo` and `tsc`, plus the full test suite) at `5.0.2`, the lowest installable release satisfying that range (`5.0.0` itself was never published on npm).
  - `valibot`: `>=1.0.0` was **not** actually correct - `valibot@1.0.0` predates the `flavor`/`Flavor` API (added in 1.1.0), so `tests/fixtures/brand-schema.ts` failed to typecheck, and a `variant` schema type-declaration difference also broke `nested-inline-description-schema.ts`'s snapshot. CI had never installed a `valibot` version matching the declared floor, so this had gone unnoticed. The floor is corrected to `>=1.1.0`, the lowest version verified to pass typecheck and the full test suite.

  CI now has a `peer-floor` job (matrix: `typescript` alone, `valibot` alone, and both together) that installs each declared floor over the lockfile and runs typecheck + test against it, so any future floor claim is continuously verified rather than assumed.

## 0.1.1

### Patch Changes

- accc4f1: Fix `exclude` config option being declared but never wired up, so patterns like `exclude: ["**/*.test.ts"]` had no effect. Also fix the lefthook `oxfmt` pre-commit hook failing when a commit only touches files ignored by `.oxfmtrc.json` (e.g. `tests/__file_snapshots__`).

## 0.1.0

### Minor Changes

- e679024: Initial release: extract TypeScript input/output types from Valibot schemas.

  vinfer is the Valibot counterpart of [zinfer](https://github.com/toiroakr/zinfer):

  - CLI and library API for turning `v.InferInput` / `v.InferOutput` into standalone type declarations
  - Recognizes both `import * as v from "valibot"` and named imports
  - Preserves `v.brand()` / `v.flavor()` in output types, wherever they appear
  - Emits `v.description()` (and `v.metadata({ description })`) as TSDoc comments
  - Resolves cross-file, re-exported and subpath (`#/*`) schema references
  - Reconstructs recursive schemas from `v.lazy()` and from getter entries TypeScript cannot infer
  - Generates vitest type-equality tests with `--generate-tests`
