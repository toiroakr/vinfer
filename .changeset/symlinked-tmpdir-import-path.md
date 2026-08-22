---
"vinfer": patch
---

Fix corrupted `import(...)` paths in generated types when the working directory or an absolute `--outDir`/`--outFile` path goes through a symlink (e.g. macOS's `/var` -> `/private/var` tmpdir). The absolute path built from the schema's source directory and the output directory could resolve from different symlink bases, so the relative path computed between them walked all the way up to the filesystem root instead of staying short - both are now resolved to their real, symlink-free path before being compared.
