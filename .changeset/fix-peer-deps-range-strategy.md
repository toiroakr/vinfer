---
"vinfer": patch
---

Fix `peerDependencies` lower bounds that Renovate could silently narrow without any accompanying source change:

- `renovate.json`'s top-level `"rangeStrategy": "bump"` applied to every dependency type, including `peerDependencies`. A `packageRules` entry now scopes `peerDependencies` to `rangeStrategy: "widen"` and `automerge: false`, so Renovate stops mechanically raising peer floors and any future intentional change goes through review.
- `typescript`: `>=5.0.0` verified working (typecheck via both `tsgo` and `tsc`, plus the full test suite) at `5.0.2`, the lowest installable release satisfying that range (`5.0.0` itself was never published on npm).
- `valibot`: `>=1.0.0` was **not** actually correct - `valibot@1.0.0` predates the `flavor`/`Flavor` API (added in 1.1.0), so `tests/fixtures/brand-schema.ts` failed to typecheck, and a `variant` schema type-declaration difference also broke `nested-inline-description-schema.ts`'s snapshot. CI had never installed a `valibot` version matching the declared floor, so this had gone unnoticed. The floor is corrected to `>=1.1.0`, the lowest version verified to pass typecheck and the full test suite.

CI now has a `peer-floor` job (matrix: `typescript` alone, `valibot` alone, and both together) that installs each declared floor over the lockfile and runs typecheck + test against it, so any future floor claim is continuously verified rather than assumed.
