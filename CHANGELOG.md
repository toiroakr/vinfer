# vinfer

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
