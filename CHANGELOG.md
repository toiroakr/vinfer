# vinfer

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
