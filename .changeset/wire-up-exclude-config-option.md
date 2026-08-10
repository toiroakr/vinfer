---
"vinfer": patch
---

Fix `exclude` config option being declared but never wired up, so patterns like `exclude: ["**/*.test.ts"]` had no effect. Also fix the lefthook `oxfmt` pre-commit hook failing when a commit only touches files ignored by `.oxfmtrc.json` (e.g. `tests/__file_snapshots__`).
