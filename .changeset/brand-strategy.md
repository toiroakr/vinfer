---
"vinfer": patch
---

Add `--brand-strategy` (config `brandStrategy`) to control how a `.brand()`/`.flavor()` marker is represented in the generated output.

The existing behavior - printing `Brand<"Tag">`/`Flavor<"Tag">` and importing `Brand`/`Flavor` from `"valibot"` - is now `--brand-strategy valibot-import` (the default, unchanged). `--brand-strategy local-symbol` instead declares a single `unique symbol` per generated file and prints a self-contained `{ readonly [__brand]: "Tag" }` / `{ readonly [__flavor]?: "Tag" }` property, so the generated output never imports valibot.

`--brand-strategy local-symbol` cannot be combined with `--generate-tests`, since the generated companion test asserts full type equality against `v.InferOutput<>`/`v.InferInput<>`, which always carries valibot's own `Brand<Tag>`/`Flavor<Tag>` for a branded/flavored schema - a local-symbol marker is intentionally a different (self-contained) shape.

Ported from [toiroakr/zinfer#462](https://github.com/toiroakr/zinfer/pull/462).
