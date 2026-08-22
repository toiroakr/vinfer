# vinfer

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
