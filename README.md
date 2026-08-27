# vinfer

A tool to extract TypeScript input/output types from [Valibot](https://valibot.dev) schemas.

vinfer is the Valibot counterpart of [zinfer](https://github.com/toiroakr/zinfer).

## Features

- Extract `v.InferInput<T>` / `v.InferOutput<T>` types as text from Valibot schemas
- Accurate type analysis using the TypeScript Compiler API (ts-morph)
- Non-invasive: does not modify original source files
- Works with both `import * as v from "valibot"` and named imports
- Handles circular references (`v.lazy()`, getter patterns)
- Outputs `v.description()` as TSDoc comments
- Preserves branded and flavored types (`v.brand()`, `v.flavor()`)
- Supports both CLI and library API
- Configuration file support (`vinfer.config.ts`, `package.json`)

## Installation

```bash
npm install vinfer
```

## Quick Start

### CLI

```bash
# Extract all schemas from a single file
vinfer src/schemas/user.ts

# Process multiple files with glob patterns
vinfer "src/**/*.schema.ts"

# Output to files
vinfer src/schemas.ts --outDir ./types

# Merge into a single type when input/output are identical
vinfer src/schemas.ts --merge-same --suffix Schema
```

### Library API

```typescript
import { extractValibotTypes, extractAllSchemas, extractAndFormat } from "vinfer";

// Extract a single schema
const { input, output } = extractValibotTypes("./schemas.ts", "UserSchema");
console.log(input); // { id: string; name: string; }
console.log(output); // { id: string; name: string; }

// Get formatted output
const formatted = extractAndFormat("./schemas.ts", "UserSchema");
console.log(formatted);

// Extract all schemas from a file
const results = extractAllSchemas("./schemas.ts");
for (const result of results) {
  console.log(`${result.schemaName}: ${result.input}`);
}
```

## CLI Options

```
Usage: vinfer [options] [files...]

Arguments:
  files                      File paths or glob patterns

Options:
  -c, --config <path>        Path to config file
  -p, --project <path>       Path to tsconfig.json
  --schemas <names>          Comma-separated schema names to extract
  --input-only               Output only input types
  --output-only              Output only output types
  --merge-same               Single type if input===output
  --suffix <suffix>          Remove suffix from schema names (e.g., 'Schema')
  --input-suffix <suffix>    Suffix for input type names (default: 'Input')
  --output-suffix <suffix>   Suffix for output type names (default: 'Output')
  --map <mappings>           Custom name mappings (e.g., 'UserSchema:User')
  --outDir <dir>             Output directory for generated files
  --outFile <file>           Single output file for all types
  --outPattern <pattern>     Output file naming pattern (e.g., '[name].types.ts')
  -d, --declaration          Generate .d.ts files
  --dry-run                  Preview without writing files
  --with-descriptions        Include v.description() as TSDoc comments
  --generate-tests           Generate vitest type equality tests alongside type files
  --inline-external-types    Inline a plain type that an explicit v.GenericSchema<T> annotation reaches in another file, instead of referencing it
  -v, --verbose              Enable verbose output
  -V, --version              Output the version number
  -h, --help                 Display help
```

## Configuration File

### vinfer.config.ts

```typescript
import { defineConfig } from "vinfer";

export default defineConfig({
  // Target files
  include: ["src/**/*.schema.ts"],

  // Exclude patterns
  exclude: ["**/*.test.ts"],

  // Path to tsconfig.json
  project: "./tsconfig.json",

  // Schema names to extract (all if not specified)
  schemas: ["UserSchema", "PostSchema"],

  // Output options
  outDir: "./types",
  outFile: "./types/index.ts",
  outPattern: "[name].types.ts",
  declaration: true,

  // Type output options
  inputOnly: false, // Output only input types
  outputOnly: false, // Output only output types
  mergeSame: true, // Merge into single type when input === output

  // Type name options
  suffix: "Schema", // Suffix to remove from schema names
  inputSuffix: "Input", // Suffix for input types
  outputSuffix: "Output", // Suffix for output types

  // Custom mappings
  map: {
    UserSchema: "User",
    PostSchema: "Article",
  },

  // Output v.description() as TSDoc
  withDescriptions: true,

  // Inline a plain type that an explicit v.GenericSchema<T> annotation reaches in another file
  inlineExternalTypes: false,
});
```

### package.json

```json
{
  "vinfer": {
    "include": ["src/**/*.schema.ts"],
    "outDir": "./types",
    "mergeSame": true,
    "suffix": "Schema"
  }
}
```

Config file resolution order:

1. `vinfer.config.ts`
2. `vinfer.config.mts`
3. `vinfer.config.js`
4. `vinfer.config.mjs`
5. `vinfer` field in `package.json`

`--config <path>` overrides the search. CLI options take precedence over config file settings.

## Output Examples

### Basic Output

Input schema:

```typescript
import * as v from "valibot";

export const UserSchema = v.object({
  id: v.pipe(v.string(), v.uuid()),
  name: v.string(),
  age: v.optional(v.number()),
});
```

Output (default):

```typescript
export type UserSchemaInput = {
  id: string;
  name: string;
  age?: number | undefined;
};

export type UserSchemaOutput = {
  id: string;
  name: string;
  age?: number | undefined;
};
```

Output (`--merge-same --suffix Schema`):

```typescript
export type User = {
  id: string;
  name: string;
  age?: number | undefined;
};
```

### With Transforms

Input schema:

```typescript
export const DateSchema = v.object({
  createdAt: v.pipe(
    v.string(),
    v.transform((s) => new Date(s)),
  ),
  count: v.pipe(v.string(), v.transform(Number)),
});
```

Output:

```typescript
export type DateSchemaInput = {
  createdAt: string;
  count: string;
};

export type DateSchemaOutput = {
  createdAt: Date;
  count: number;
};
```

### With Defaults

Valibot's defaults make a key optional on input and always present on output:

```typescript
export const SettingsSchema = v.object({
  theme: v.optional(v.string(), "light"),
});
```

```typescript
export type SettingsSchemaInput = {
  theme?: string | undefined;
};

export type SettingsSchemaOutput = {
  theme: string;
};
```

### With TSDoc Comments (`--with-descriptions`)

Input schema:

```typescript
export const UserSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.uuid(), v.description("Unique user identifier")),
    name: v.pipe(v.string(), v.description("User's display name")),
    email: v.pipe(v.string(), v.email(), v.description("Email address")),
  }),
  v.description("User account information"),
);
```

Output:

```typescript
/**
 * User account information
 */
export type UserSchemaInput = {
  /** Unique user identifier */
  id: string;
  /** User's display name */
  name: string;
  /** Email address */
  email: string;
};
```

The description is read from the last `v.description()` action in the pipe, looking
through wrappers such as `v.optional()`. `v.metadata({ description: "..." })` is
accepted as an alternative spelling.

### Branded and Flavored Types

Input schema:

```typescript
export const UserIdSchema = v.pipe(v.string(), v.brand("UserId"));

export const UserSchema = v.object({
  id: v.pipe(v.string(), v.brand("UserId")),
  tags: v.array(v.pipe(v.string(), v.brand("Tag"))),
  name: v.string(),
});
```

Output:

```typescript
import type { Brand } from "valibot";

export type UserIdSchemaInput = string;

export type UserIdSchemaOutput = string & Brand<"UserId">;

export type UserSchemaInput = {
  id: string;
  tags: string[];
  name: string;
};

export type UserSchemaOutput = {
  id: string & Brand<"UserId">;
  tags: (string & Brand<"Tag">)[];
  name: string;
};
```

`v.brand()` and `v.flavor()` are transformation actions, so they only appear in the
output type - never in the input type. Brands are preserved wherever they occur,
including inside arrays, records, unions and nested objects.

## Circular Reference Support

### v.lazy Pattern (Recommended)

```typescript
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: v.GenericSchema<JsonValue> = v.lazy(() =>
  v.union([
    v.string(),
    v.number(),
    v.boolean(),
    v.null(),
    v.array(JsonValueSchema),
    v.record(v.string(), JsonValueSchema),
  ]),
);
```

When an explicit type annotation (`v.GenericSchema<T>` / `v.BaseSchema<...>`) is
present, that type is used for the output - and a type name declared in the same file
is rewritten to the generated type name.

### Getter Pattern

```typescript
export const CategorySchema = v.object({
  name: v.string(),
  get subcategories() {
    return v.array(CategorySchema);
  },
});
```

A getter that refers back to its own schema is beyond what TypeScript can infer, so
`v.InferInput<typeof CategorySchema>` is `any`. vinfer reads the getter's AST instead
and reconstructs the real shape:

```typescript
export type CategoryInput = {
  name: string;
  subcategories: CategoryInput[];
};
```

Annotate the schema (as in the `v.lazy` example above) if you also want Valibot's own
inference to work.

Annotating the getter itself lets TypeScript unfold one whole copy of the schema
before it reaches the recursion. That copy is collapsed away, so the generated type
holds the self-reference directly rather than an extra level of the same shape.

### References Through Schemas That Generate No Types

A schema that is not exported gets no generated type of its own, so it is inlined
into whatever references it. The references _it_ holds are kept, at any depth:

```typescript
export const NodeSchema = v.object({ name: v.string() });

// Not exported - no type is generated for it
const GroupSchema = v.object({ members: v.array(NodeSchema) });

export const TreeSchema = v.object({ group: GroupSchema });
```

```typescript
export type TreeInput = {
  group: {
    members: NodeInput[];
  };
};
```

### Recursive Schemas Across Files

A recursive type has no faithful inline form, so a recursive schema imported from
another file is referenced by name and imported from the file that declares its
types:

```typescript
// out/tree.generated.ts
import type { Node } from "./node.generated";

export type Tree = {
  root: Node;
  index: {
    [x: string]: Node;
  };
};
```

This needs the declaring file to be part of the same run and to get an output file of
its own (`--outDir` / `--outPattern`, or `--outFile`, which puts both declarations in
the one file and needs no import). Passing `--schemas` disables this entirely, since
the filter can drop the very declaration a reference would point at - schemas are
inlined instead, run-wide, regardless of which file declares them.

When nothing declares a name for a recursive schema - because it is not exported, or
because its file is not part of the run, or because `--schemas` filtered it out - it is
inlined as far as it can be, with the recursion point kept as the index signature or
array the getter describes instead of collapsing to a bare `any`.

## Library API

### extractValibotTypes

Extracts types from a single schema.

```typescript
import { extractValibotTypes } from "vinfer";

const { input, output } = extractValibotTypes(
  "./schemas.ts",
  "UserSchema",
  "./tsconfig.json", // optional
);
```

### extractAllSchemas

Extracts all schemas from a file.

```typescript
import { extractAllSchemas } from "vinfer";

const results = extractAllSchemas("./schemas.ts");
// results: ExtractResult[]
```

### extractAndFormat

Extracts types and returns them as a formatted string.

```typescript
import { extractAndFormat } from "vinfer";

const formatted = extractAndFormat("./schemas.ts", "UserSchema");
console.log(formatted);
// Output:
// // input
// { id: string; name: string; }
//
// // output
// { id: string; name: string; }
```

### generateTypeDeclarations

Generates TypeScript type declarations from extraction results.

```typescript
import { extractAllSchemas, generateTypeDeclarations } from "vinfer";

const results = extractAllSchemas("./schemas.ts");
const declarations = generateTypeDeclarations(results, {
  nameMapping: {
    removeSuffix: "Schema",
    inputSuffix: "Input",
    outputSuffix: "Output",
  },
  declaration: {
    mergeSame: true,
  },
});

console.log(declarations);
```

### ValibotTypeExtractor Class

For more fine-grained control:

```typescript
import { ValibotTypeExtractor } from "vinfer";

const extractor = new ValibotTypeExtractor("./tsconfig.json");

// Single schema
const result = extractor.extract({
  filePath: "./schemas.ts",
  schemaName: "UserSchema",
});

// All schemas
const allResults = extractor.extractAll("./schemas.ts");

// Multiple specific schemas
const selectedResults = extractor.extractMultiple("./schemas.ts", ["UserSchema", "PostSchema"]);

// Extract by file (includes file path)
const fileResult = extractor.extractFile("./schemas.ts");
// fileResult: { filePath: string; schemas: ExtractResult[] }

// List schema names
const schemaNames = extractor.getSchemaNames("./schemas.ts");
```

## Type Test Generation

vinfer can automatically generate vitest tests that verify the generated types match
`v.InferInput<typeof Schema>` / `v.InferOutput<typeof Schema>`.

### Usage

```bash
# Generate type definitions and tests simultaneously
vinfer "src/schemas/*.ts" --outDir ./types --generate-tests --suffix Schema
# -> ./types/user.types.ts (type definitions)
# -> ./types/user.types.test.ts (tests)

# When outputting to a single file
vinfer "src/schemas/*.ts" --outFile ./types.ts --generate-tests --suffix Schema
# -> ./types.ts (type definitions)
# -> ./types.test.ts (tests)

# Run the tests
vitest run
```

### Example Generated Test

```typescript
import { describe, it, expectTypeOf } from "vitest";
import type * as v from "valibot";

import { UserSchema } from "../schemas/user";
import type { UserInput, UserOutput } from "./user";

describe("Type equality tests", () => {
  describe("user", () => {
    it("UserSchema input matches v.InferInput", () => {
      expectTypeOf<UserInput>().toEqualTypeOf<v.InferInput<typeof UserSchema>>();
    });

    it("UserSchema output matches v.InferOutput", () => {
      expectTypeOf<UserOutput>().toEqualTypeOf<v.InferOutput<typeof UserSchema>>();
    });
  });
});
```

Re-run with `--generate-tests` after modifying schemas to continuously verify type
correctness.

## Supported Valibot Features

- Primitives: `v.string()`, `v.number()`, `v.boolean()`, `v.date()`, `v.bigint()`, etc.
- Objects: `v.object()`, `v.strictObject()`, `v.looseObject()`, `v.objectWithRest()`
- Arrays and tuples: `v.array()`, `v.tuple()`, `v.tupleWithRest()`, `v.looseTuple()`, `v.strictTuple()`
- Collections: `v.record()`, `v.map()`, `v.set()`
- Unions: `v.union()`, `v.variant()`
- Intersections: `v.intersect()`
- Literals and enums: `v.literal()`, `v.picklist()`, `v.enum()`
- Wrappers: `v.optional()`, `v.exactOptional()`, `v.nullable()`, `v.nullish()`, `v.undefinedable()`, `v.nonOptional()`, `v.nonNullish()`
- Defaults and fallbacks: `v.optional(schema, value)`, `v.fallback()`
- Pipelines: `v.pipe()` with validation, transformation and metadata actions
- Utilities: `v.partial()`, `v.required()`, `v.pick()`, `v.omit()`, `v.keyof()`
- Async schemas: `v.objectAsync()`, `v.arrayAsync()`, `v.pipeAsync()`, `v.optionalAsync()`, ...
- Circular references: `v.lazy()`, getter patterns
- Descriptions: `v.description()`, `v.metadata({ description })`
- Branded types: `v.brand()`, `v.flavor()`
- Imported schemas: relative imports and subpath imports (package.json `imports` field, including the `#/*` form)

### Known type differences

The generated types describe the same values as Valibot's inference, but a few are
printed differently on purpose:

| Case                                     | Valibot infers                   | vinfer generates                                    |
| ---------------------------------------- | -------------------------------- | --------------------------------------------------- |
| `v.intersect([A, B])`                    | `A & B`                          | a single flattened object                           |
| `v.looseObject()` / `v.objectWithRest()` | `entries & { [key: string]: … }` | the index signature inside the object               |
| `v.enum(SomeEnum)`                       | the enum's member types          | the underlying literals, so the output stands alone |

## Inlining External Types (`--inline-external-types`)

When a schema carries an explicit `v.GenericSchema<T>` annotation and `T` reaches a plain (non-Valibot) `type`/`interface`/`enum` declared in another file, TypeScript prints an `import("...").Name` reference to it rather than expanding it - there is nothing else visible to print from that location. By default vinfer keeps that reference (rewritten to resolve correctly from wherever the output is written). Setting `--inline-external-types` replaces it with the referenced type's own structure instead, recursively, so the generated output carries no dependency on the original file layout - useful when generated files are moved, published, or read outside the project that declares those types.

```typescript
// field.types.ts
export type FieldType = "uuid" | "string" | "number" | "boolean";
export type FieldOutput = { type: FieldType; fields?: Record<string, FieldOutput> };

// field.schema.ts
import * as v from "valibot";
import type { FieldOutput } from "./field.types";

export const FieldSchema: v.GenericSchema<FieldOutput> = v.lazy(() =>
  v.object({
    type: v.picklist(["uuid", "string", "number", "boolean"]),
    fields: v.optional(v.record(v.string(), FieldSchema)),
  }),
);
```

Without the flag, `FieldType` is referenced:

```typescript
export type FieldOutput = {
  type: import("./field.types").FieldType;
  fields?: Record<string, FieldOutput>;
};
```

With `--inline-external-types`, it's expanded in place:

```typescript
export type FieldOutput = {
  type: "uuid" | "string" | "number" | "boolean";
  fields?: Record<string, FieldOutput>;
};
```

The expansion follows references across as many files as needed. A reference that would recurse into itself - directly, or by cycling back through another file - is left as an `import(...)` at the point it would repeat; everything outside the cycle is still fully expanded. A same-file type that isn't exported has no importable name to fall back to, so a cycle through one is left as a bare (unresolved) identifier - the same known limitation as a non-exported local explicit-annotation type. Namespace imports (`import * as ns`), default-imported types, and generic instantiations (`import("...").Foo<Bar>`) aren't expanded either; each is left as the reference vinfer would otherwise print.

This only applies to a plain type reached through an explicit `v.GenericSchema<T>` annotation - a Valibot schema imported from another file is unaffected, and continues to be referenced by its own generated type name or inlined as already described elsewhere in this document.

## Subpath Imports

Schemas imported via the package.json
[`imports`](https://nodejs.org/api/packages.html#subpath-imports) field are resolved
automatically, including the `#/*` wildcard form supported by TypeScript 6 / Node 26.

```json
// package.json
{
  "imports": {
    "#/*": "./src/*"
  }
}
```

```typescript
// src/user.ts
import * as v from "valibot";
import { AddressSchema } from "#/address.js";

export const UserSchema = v.object({
  name: v.string(),
  address: AddressSchema,
});
```

The imported `AddressSchema` is resolved through the nearest package.json `imports`
map (wildcard, exact, and conditional targets are all supported) so that its type is
inlined into the generated output.

## License

MIT
