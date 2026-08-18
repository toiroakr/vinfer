---
"vinfer": patch
---

Fix generated-name matching in `type-printer.ts` for schemas named starting with
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
