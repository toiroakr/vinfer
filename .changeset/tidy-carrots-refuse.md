---
"vinfer": patch
---

Fix recursive schema generation.

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
  than collapsing to a bare `any`.
- `mergeSame` now merges recursive schemas: the two directions of a schema that
  names itself are compared with those self-references unified, so a recursive
  schema whose input and output agree emits a single type plus `type XInput = X`.
