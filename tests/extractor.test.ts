import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve, basename } from "pathe";
import { ValibotTypeExtractor, type ExtractContext } from "../src/core/extractor.js";
import { generateDeclarationFile, relativizeImportPaths } from "../src/core/type-printer.js";
import { createNameMapper } from "../src/core/name-mapper.js";
import { DescriptionExtractor } from "../src/core/description-extractor.js";
import { execFileSync } from "child_process";
import { existsSync, readdirSync } from "fs";

const fixturesDir = resolve(import.meta.dirname, "fixtures");
const snapshotsDir = resolve(import.meta.dirname, "__file_snapshots__");
const mapName = createNameMapper({ removeSuffix: "Schema" });

/**
 * Creates a standard schema test case.
 */
function createSchemaTest(
  extractor: ValibotTypeExtractor,
  schemaName: string,
  description: string = "should generate TypeScript declarations",
  options: { context?: ExtractContext; snapshotName?: string } = {},
) {
  const snapshotName = options.snapshotName ?? schemaName;
  describe(`${schemaName}.ts`, () => {
    it(description, async () => {
      const results = extractor.extractAll(
        resolve(fixturesDir, `${schemaName}.ts`),
        options.context,
      );
      const snapshotPath = resolve(snapshotsDir, `${snapshotName}.ts`);
      // Matches the real CLI pipeline (cli-runner.ts), which always runs
      // generated content through relativizeImportPaths before writing it -
      // without this, a cross-file import("...") type (e.g. for the
      // inline-external-types fixtures) would bake this machine's absolute
      // path into the committed snapshot.
      const output = relativizeImportPaths(generateDeclarationFile(results, mapName), snapshotPath);
      await expect(output).toMatchFileSnapshot(`__file_snapshots__/${snapshotName}.ts`);
    });
  });
}

/**
 * Generated type tests whose types are deliberately *not* identical to what
 * Valibot infers, with the reason. Everything else must match exactly, so this
 * list doubles as the record of vinfer's known type differences.
 *
 * Note `expectTypeOf().toEqualTypeOf()` compares nominally, so a difference here
 * means "printed differently", not necessarily "wrong": a flattened
 * intersection describes the same values as the intersection itself.
 */
const KNOWN_TYPE_DIFFERENCES: Record<string, string> = {
  "enum-schema.test.ts":
    "v.enum() infers the TypeScript enum's member types; vinfer expands them to the underlying literals so the output stands alone.",
  "getter-schema.test.ts":
    "A getter that refers back to its own schema makes TypeScript give up and type the schema as any; vinfer reconstructs the real shape from the AST.",
  "lazy-schema.test.ts":
    "Same as getter-schema.test.ts, for CategorySchema / TreeNodeSchema (JsonValueSchema, which is annotated, does match).",
  "intersection-schema.test.ts":
    "v.intersect() infers `A & B`; vinfer flattens it into a single object literal.",
  "strict-object-schema.test.ts":
    "v.looseObject() / v.objectWithRest() infer `entries & { [key: string]: ... }`; vinfer flattens the index signature into the object.",
  "non-generated-intermediate-schema.test.ts":
    "OrganizationSchema holds a recursive schema that is not exported: nothing declares a name for it, so its recursion is inlined as far as it goes and approximated at the recursion point. Everything else in the fixture - including the references reached through the non-generated intermediates - matches exactly.",
  "recursive-record-schema.test.ts":
    "Same as getter-schema.test.ts: a getter that refers back to its own schema is typed as any (or, when annotated, as one inlined copy of the schema) until vinfer rebuilds it from the AST.",
  "mixed-union-reference-schema.test.ts":
    "RecursiveUnionSchema's non-exported recursive member is inlined, and its recursion collapses to any[].",
};

/**
 * TypeScript errors expected inside the fixtures themselves: the recursive
 * getter fixtures cannot be typed without an explicit annotation, which is
 * exactly the situation vinfer's getter resolution exists for.
 */
const EXPECTED_FIXTURE_ERROR_CODES = ["TS7022", "TS7023"];

interface TypeError {
  file: string;
  code: string;
  message: string;
}

/**
 * Type-checks the generated snapshots together with the fixtures they describe.
 */
function typeCheckSnapshots(): TypeError[] {
  const tsconfigPath = resolve(snapshotsDir, "tsconfig.json");
  let output = "";

  try {
    execFileSync("npx", ["tsgo", "--noEmit", "-p", tsconfigPath], {
      stdio: "pipe",
      encoding: "utf-8",
      cwd: resolve(import.meta.dirname, ".."),
    });
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string };
    output = `${execError.stdout ?? ""}\n${execError.stderr ?? ""}`;
  }

  return output
    .split("\n")
    .map((line) => /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ file: basename(match[1]), code: match[2], message: match[3] }));
}

// After all snapshots have been written, type-check them - both on their own and
// against `v.InferInput` / `v.InferOutput` through the generated type tests.
afterAll(() => {
  if (!existsSync(snapshotsDir)) {
    console.log("Snapshots directory not found, skipping type-check");
    return;
  }

  const errors = typeCheckSnapshots();
  const fixtureNames = new Set(readdirSync(fixturesDir));

  const unexpectedFixtureErrors = errors.filter(
    (error) => fixtureNames.has(error.file) && !EXPECTED_FIXTURE_ERROR_CODES.includes(error.code),
  );
  expect(unexpectedFixtureErrors, formatErrors(unexpectedFixtureErrors)).toEqual([]);

  const typeFileErrors = errors.filter(
    (error) => !fixtureNames.has(error.file) && !error.file.endsWith(".test.ts"),
  );
  expect(typeFileErrors, formatErrors(typeFileErrors)).toEqual([]);

  const mismatchedTypeTests = [
    ...new Set(errors.filter((error) => error.file.endsWith(".test.ts")).map((e) => e.file)),
  ].sort();
  expect(mismatchedTypeTests).toEqual(Object.keys(KNOWN_TYPE_DIFFERENCES).sort());
}, 60000);

/**
 * Renders type errors for an assertion message.
 */
function formatErrors(errors: TypeError[]): string {
  if (errors.length === 0) return "";
  return `Unexpected type errors:\n${errors.map((e) => `  ${e.file}: ${e.code} ${e.message}`).join("\n")}`;
}

describe("ValibotTypeExtractor - Generated TypeScript Declarations", () => {
  const extractor = new ValibotTypeExtractor();

  // Warm up the ts-morph project by triggering Valibot module resolution.
  // The first type resolution is slow (~5s in CI) as it processes Valibot's
  // entire type system.
  beforeAll(() => {
    extractor.extractAll(resolve(fixturesDir, "basic-schema.ts"));
  });

  // Standard schema tests
  createSchemaTest(extractor, "basic-schema");
  createSchemaTest(
    extractor,
    "transform-schema",
    "should generate TypeScript declarations with transforms",
  );
  createSchemaTest(
    extractor,
    "nested-schema",
    "should generate TypeScript declarations with nested objects",
  );
  createSchemaTest(
    extractor,
    "union-schema",
    "should generate TypeScript declarations with unions",
  );
  createSchemaTest(
    extractor,
    "intersection-schema",
    "should generate TypeScript declarations with intersections",
  );
  createSchemaTest(extractor, "enum-schema", "should generate TypeScript declarations with enums");

  describe("computed-enum-schema.ts", () => {
    it("leaves an enum unexpanded rather than dropping an unresolvable member's value", () => {
      const results = extractor.extractAll(resolve(fixturesDir, "computed-enum-schema.ts"));
      const status = results.find((r) => r.schemaName === "StatusSchema");

      // Silently narrowing to `"active" | "closed"` would reject a value
      // TypeScript itself accepts (Pending). Left as the bare enum name
      // instead, which cannot be printed self-contained here since the enum
      // isn't exported - a known limitation, not asserted against.
      expect(status?.input).toBe("Status");
      expect(status?.output).toBe("Status");
    });
  });

  createSchemaTest(
    extractor,
    "utility-types-schema",
    "should generate TypeScript declarations with utility types",
  );
  createSchemaTest(
    extractor,
    "multi-schema",
    "should generate TypeScript declarations for multiple schemas",
  );
  createSchemaTest(
    extractor,
    "lazy-schema",
    "should generate TypeScript declarations with circular references",
  );
  createSchemaTest(
    extractor,
    "getter-schema",
    "should generate TypeScript declarations with getter-based recursive schemas",
  );
  createSchemaTest(
    extractor,
    "recursive-record-schema",
    "should generate TypeScript declarations with annotated recursive getters",
  );
  createSchemaTest(
    extractor,
    "non-generated-intermediate-schema",
    "should keep named references through schemas that generate no types",
  );
  createSchemaTest(
    extractor,
    "cross-ref-schema",
    "should generate TypeScript declarations with cross-references",
  );
  createSchemaTest(
    extractor,
    "strict-object-schema",
    "should generate TypeScript declarations with strictObject cross-references",
  );
  createSchemaTest(
    extractor,
    "mixed-export-schema",
    "should generate TypeScript declarations respecting export status",
  );
  createSchemaTest(
    extractor,
    "union-ref-schema",
    "should generate TypeScript declarations with union references",
  );
  createSchemaTest(
    extractor,
    "brand-schema",
    "should generate TypeScript declarations with brand information",
  );
  describe("brand-schema.ts (brandStrategy: local-symbol)", () => {
    it("should emit a local symbol marker instead of importing Brand/Flavor from valibot", async () => {
      const results = extractor.extractAll(resolve(fixturesDir, "brand-schema.ts"));
      const output = generateDeclarationFile(results, mapName, { brandStrategy: "local-symbol" });
      await expect(output).toMatchFileSnapshot("__file_snapshots__/brand-schema-local-symbol.ts");
    });
  });
  createSchemaTest(
    extractor,
    "described-ref-schema",
    "should keep named schema references when v.description() wraps them",
  );
  createSchemaTest(
    extractor,
    "mixed-union-reference-schema",
    "should preserve named references through mixed and non-exported union members",
  );
  createSchemaTest(
    extractor,
    "named-import-schema",
    "should generate TypeScript declarations for named Valibot imports",
  );
  createSchemaTest(
    extractor,
    "namespace-alias-schema",
    "should generate TypeScript declarations for an aliased Valibot namespace",
  );
  createSchemaTest(
    extractor,
    "wrapper-schema",
    "should generate TypeScript declarations for Valibot's wrapper schemas",
  );
  createSchemaTest(
    extractor,
    "collection-schema",
    "should generate TypeScript declarations for records, maps and sets",
  );
  createSchemaTest(
    extractor,
    "pipe-validation-schema",
    "should generate TypeScript declarations where pipe actions preserve types",
  );
  createSchemaTest(
    extractor,
    "async-schema",
    "should generate TypeScript declarations for async schemas",
  );

  describe("described-schema.ts", () => {
    it("should generate TypeScript declarations without TSDoc comments by default", async () => {
      const results = extractor.extractAll(resolve(fixturesDir, "described-schema.ts"));
      const output = generateDeclarationFile(results, mapName);
      await expect(output).toMatchFileSnapshot("__file_snapshots__/described-schema.ts");
    });

    it("should generate TypeScript declarations with TSDoc comments when withDescriptions is enabled", async () => {
      const filePath = resolve(fixturesDir, "described-schema.ts");
      const results = extractor.extractAll(filePath);
      const descriptionExtractor = new DescriptionExtractor();

      // Add descriptions to results (same as CLI does with withDescriptions option)
      const schemaNames = results.map((r) => r.schemaName);
      const descriptions = await descriptionExtractor.extractDescriptions(filePath, schemaNames);

      const resultsWithDescriptions = results.map((result) => {
        const desc = descriptions.get(result.schemaName);
        if (!desc) {
          return result;
        }
        return {
          ...result,
          description: desc.description,
          fieldDescriptions: desc.fields,
        };
      });

      const output = generateDeclarationFile(resultsWithDescriptions, mapName);
      await expect(output).toMatchFileSnapshot(
        "__file_snapshots__/described-schema-with-descriptions.ts",
      );
    });
  });

  describe("multiline-description-schema.ts", () => {
    it("should generate TSDoc comments with multiline descriptions", async () => {
      const filePath = resolve(fixturesDir, "multiline-description-schema.ts");
      const results = extractor.extractAll(filePath);
      const descriptionExtractor = new DescriptionExtractor();

      const schemaNames = results.map((r) => r.schemaName);
      const descriptions = await descriptionExtractor.extractDescriptions(filePath, schemaNames);

      const resultsWithDescriptions = results.map((result) => {
        const desc = descriptions.get(result.schemaName);
        if (!desc) {
          return result;
        }
        return {
          ...result,
          description: desc.description,
          fieldDescriptions: desc.fields,
        };
      });

      const output = generateDeclarationFile(resultsWithDescriptions, mapName);
      await expect(output).toMatchFileSnapshot(
        "__file_snapshots__/multiline-description-schema.ts",
      );
    });
  });

  describe("nested-inline-description-schema.ts", () => {
    it("should not leak an unrelated same-named field's description into an inlined nested schema (#340)", async () => {
      const filePath = resolve(fixturesDir, "nested-inline-description-schema.ts");
      const results = extractor.extractAll(filePath);
      const descriptionExtractor = new DescriptionExtractor();

      const schemaNames = results.map((r) => r.schemaName);
      const descriptions = await descriptionExtractor.extractDescriptions(filePath, schemaNames);

      const resultsWithDescriptions = results.map((result) => {
        const desc = descriptions.get(result.schemaName);
        if (!desc) {
          return result;
        }
        return {
          ...result,
          description: desc.description,
          fieldDescriptions: desc.fields,
        };
      });

      const output = generateDeclarationFile(resultsWithDescriptions, mapName);
      expect(output).toContain("/** Item description, distinct from container description */");
      expect(output).not.toMatch(/flag: boolean;\s*\/\*\* Container-level description \*\//);
      // Sibling union members must each keep their own field description,
      // not inherit the other member's last-parsed field name.
      expect(output).toContain("/** A description */");
      expect(output).toContain("/** B description */");
      await expect(output).toMatchFileSnapshot(
        "__file_snapshots__/nested-inline-description-schema.ts",
      );
    });
  });

  describe("recursive-record-schema.ts", () => {
    /**
     * Runs the fixture through the same steps the CLI does for
     * `--with-descriptions`.
     */
    async function generateWithDescriptions(): Promise<string> {
      const filePath = resolve(fixturesDir, "recursive-record-schema.ts");
      const results = extractor.extractAll(filePath);
      const descriptionExtractor = new DescriptionExtractor();

      const descriptions = await descriptionExtractor.extractDescriptions(
        filePath,
        results.map((r) => r.schemaName),
      );

      const resultsWithDescriptions = results.map((result) => {
        const desc = descriptions.get(result.schemaName);
        if (!desc) {
          return result;
        }
        return {
          ...result,
          description: desc.description,
          fieldDescriptions: desc.fields,
        };
      });

      return generateDeclarationFile(resultsWithDescriptions, mapName);
    }

    it("emits the self-reference straight away instead of one inlined copy first", async () => {
      const output = await generateWithDescriptions();

      // Required key: `children: Record<string, Self>`.
      expect(output).toContain(
        [
          "export type RecursiveRecordInput = {",
          "  /** The node name */",
          "  name: string;",
          "  children: {",
          "    [x: string]: RecursiveRecordInput;",
          "  };",
          "};",
        ].join("\n"),
      );

      // Optional key: `children?: Record<string, Self>`, both when the getter is
      // annotated and when its shape is reconstructed from the AST.
      for (const typeName of ["OptionalRecursiveRecordInput", "InferredOptionalRecordInput"]) {
        expect(output).toMatch(
          new RegExp(
            `export type ${typeName} = \\{\\n  /\\*\\* The \\w+ node name \\*/\\n  name: string;\\n  children\\?: \\{\\n    \\[x: string\\]: ${typeName};\\n  \\};\\n\\};`,
          ),
        );
      }

      // Array-shaped recursion stays a plain self-referencing array.
      expect(output).toContain("children: RecursiveArrayInput[];");

      // No level of any of them is an expanded copy of the schema.
      expect(output).not.toMatch(/children\??: \{\n\s+\[x: string\]: \{/);
      expect(output).not.toContain("any");
    });

    it("keeps v.description() on every inlined level", async () => {
      const output = await generateWithDescriptions();

      // A description on a field behind an index signature is written at the
      // path of the field holding the record, so the index signature must not
      // count as a path segment of its own.
      expect(output).toContain(
        [
          "export type LeafRecordInput = {",
          "  leaves: {",
          "    [x: string]: {",
          "      /** The leaf label */",
          "      label: string;",
          "    };",
          "  };",
          "};",
        ].join("\n"),
      );

      // Every recursive schema keeps its description in both directions.
      expect(output.match(/\/\*\* The node name \*\//g)).toHaveLength(2);
      expect(output.match(/\/\*\* The optional node name \*\//g)).toHaveLength(2);
      expect(output.match(/\/\*\* The inferred node name \*\//g)).toHaveLength(2);
      expect(output.match(/\/\*\* The array node name \*\//g)).toHaveLength(2);
      expect(output.match(/\/\*\* The leaf label \*\//g)).toHaveLength(2);
    });

    it("merges the two directions of a recursive schema with mergeSame", () => {
      const results = extractor.extractAll(resolve(fixturesDir, "recursive-record-schema.ts"));
      const output = generateDeclarationFile(results, mapName, { mergeSame: true });

      expect(output).toContain("export type RecursiveRecordOutput = RecursiveRecord;");
      expect(output).toContain("export type RecursiveRecordInput = RecursiveRecord;");
      expect(output).toContain("[x: string]: RecursiveRecord;");
    });
  });

  describe("annotated-inline-schema.ts", () => {
    it("prints an optional key's `| undefined` once, however the annotation spells it", () => {
      const results = extractor.extractAll(resolve(fixturesDir, "annotated-inline-schema.ts"));
      const output = generateDeclarationFile(results, mapName);

      // `__Normalize` is a mapped type, and a mapped type copying an optional
      // property whose declared type already names `undefined` makes
      // TypeScript's printer spell it twice. No type can hold that.
      expect(output).not.toMatch(/(?:boolean|string) \| undefined \| undefined/);
      expect(output).toContain(
        [
          "  node: {",
          "    kind: string;",
          "    meta: {",
          "      required?: boolean | undefined;",
          "      label?: string | undefined;",
          "    };",
          "  };",
        ].join("\n"),
      );
    });

    it("does not collapse text that only looks like a repeated union", () => {
      const results = extractor.extractAll(resolve(fixturesDir, "annotated-inline-schema.ts"));
      const literal = results.find((r) => r.schemaName === "LiteralUndefinedSchema");

      expect(literal?.input).toBe('{ label: "a | undefined | undefined"; }');
    });

    it("leaves an annotation's own printed form to TypeScript when inlining it", () => {
      const results = extractor.extractAll(resolve(fixturesDir, "annotated-inline-schema.ts"));
      const holder = results.find((r) => r.schemaName === "AnnotatedHolderSchema");

      // The annotation is printed as written, `import()` types and all, so it
      // says nothing TypeScript's own expansion at the reference site does not.
      // Inlining it would only drag the module reference along.
      expect(holder?.input).not.toContain("import(");
    });

    it("makes an annotation's import() specifier absolute, ready to re-anchor", () => {
      const results = extractor.extractAll(resolve(fixturesDir, "annotated-inline-schema.ts"));
      const node = results.find((r) => r.schemaName === "AnnotatedNodeSchema");

      // TypeScript prints the specifier relative to the file the type was read
      // from, which is not where the generated file goes. Absolute is the form
      // `relativizeImportPaths` re-anchors onto the output directory.
      expect(node?.input).toContain(
        `import("${resolve(fixturesDir, "annotated-inline-types")}").AnnotatedMeta`,
      );
    });
  });

  describe("typeof-and-method-name-collision-schema.ts", () => {
    it("does not rewrite a typeof operand or a method's own name just because the text matches another schema's generated Input name", () => {
      // WeirdSchema's explicit annotation prints Weird verbatim - a typeof
      // operand and a method name that both happen to spell out
      // "NodeSchemaInput" (the Input name NodeSchema generates), without
      // being references to it at all.
      const results = extractor.extractAll(
        resolve(fixturesDir, "typeof-and-method-name-collision-schema.ts"),
      );
      const output = generateDeclarationFile(results, mapName);

      expect(output).toContain(
        ["export type WeirdInput = {", "  value: typeof import("].join("\n"),
      );
      expect(output).toMatch(/\)\.NodeSchemaInput;\n\s*NodeSchemaInput\(\): string;/);
    });
  });

  describe("nested-import-path fixtures", () => {
    it("should rebase an already-relative import(...) reference against the output file, not the source file, when the output directory differs from the source directory", () => {
      const results = extractor.extractAll(
        resolve(fixturesDir, "nested-import-path/deep/nested/schema.ts"),
      );
      const raw = generateDeclarationFile(results, mapName);

      // Simulates outDir/outPattern remapping: the source lives two
      // directories deeper (deep/nested/) than the output (out/), so a path
      // that is merely left untouched from the printer's source-relative
      // "./common" would be wrong once rebased against this output location.
      const outputPath = resolve(fixturesDir, "nested-import-path/out/schema.generated.ts");
      const output = relativizeImportPaths(raw, outputPath);

      expect(output).toContain('import("../deep/nested/common")');
      expect(output).not.toContain('import("./common")');
    });
  });

  describe("nested-import-path/deep/nested/schema.ts", () => {
    it("should generate a type-checkable declaration when the referenced type lives in a sibling file two directories deep", async () => {
      const results = extractor.extractAll(
        resolve(fixturesDir, "nested-import-path/deep/nested/schema.ts"),
      );
      const snapshotPath = resolve(snapshotsDir, "nested-import-path/deep/nested/schema.ts");
      // Relativized against the snapshot's own location so this machine's
      // absolute path is never baked into the committed snapshot.
      const output = relativizeImportPaths(generateDeclarationFile(results, mapName), snapshotPath);
      await expect(output).toMatchFileSnapshot(
        "__file_snapshots__/nested-import-path/deep/nested/schema.ts",
      );
    });
  });

  describe("inline-external-types fixtures", () => {
    it("should leave an import(...) reference untouched by default, and inline the referenced type's own literal union when the flag is set", () => {
      const filePath = resolve(fixturesDir, "nested-import-path/deep/nested/schema.ts");

      const withoutFlag = extractor.extractAll(filePath);
      const field = withoutFlag.find((r) => r.schemaName === "FieldSchema");
      expect(field?.input).toContain('import("');

      const withFlag = extractor.extractAll(filePath, { inlineExternalTypes: true });
      const inlinedField = withFlag.find((r) => r.schemaName === "FieldSchema");
      expect(inlinedField?.input).not.toContain("import(");
    });

    it("should recursively inline a type reached through a chain of three separate files", () => {
      const results = extractor.extractAll(
        resolve(fixturesDir, "inline-external-types/chain/schema.ts"),
        { inlineExternalTypes: true },
      );
      const chain = results.find((r) => r.schemaName === "ChainSchema");

      // Level2 (reached from Level1) and Level3/Formatter (reached from
      // Level2's own import, invisible from schema.ts) are all expanded -
      // not just the outermost level TypeScript's own printer already
      // expands for free.
      expect(chain?.input).not.toContain("import(");
      expect(chain?.input).toContain("name: string");
      for (const literal of ['"x"', '"y"', '"z"']) {
        expect(chain?.input).toContain(literal);
      }

      // Formatter is a union with a function type member - TypeScript
      // prints the function type already parenthesized, so the "| null"
      // that follows only reads as top-level if the scan correctly skips
      // the arrow's `=>` (which has no matching `<` to close) rather than
      // letting it desync the bracket depth. A desync would silently drop
      // the wrapping parens instead of failing to compile, so this checks
      // the exact string rather than relying on tsgo to catch it.
      expect(chain?.input).toContain("format: (((value: string) => string) | null)");
    });

    it("should stop at a cross-file cycle between plain types and leave a resolvable import(...) reference there, never a dangling bare identifier", () => {
      const results = extractor.extractAll(
        resolve(fixturesDir, "inline-external-types/cycle/schema.ts"),
        { inlineExternalTypes: true },
      );
      const cycle = results.find((r) => r.schemaName === "CycleSchema");

      // NodeA and NodeB refer to each other through their own imports, so
      // expanding one hits the other's bare "NodeA"/"NodeB" identifier -
      // valid only inside node-a.ts/node-b.ts's own scope. The cycle must
      // resolve to an absolute import(...), never survive as that bare name.
      expect(cycle?.input).not.toMatch(/[^."]\bNodeA\b/);
      expect(cycle?.input).not.toMatch(/[^."]\bNodeB\b/);
      expect(cycle?.input).toMatch(/import\(".*node-b"\)\.NodeB/);
    });

    it("should never expand a qualified name (an enum member) or a generic instantiation - only reference them", () => {
      // Holder is imported directly, so Kind/Box (invisible here) print as
      // import("kind").Kind.A / import("kind").Box<string> in the raw text
      // resolveType() reads at the top level.
      const direct = extractor.extractAll(
        resolve(fixturesDir, "inline-external-types/qualified/direct-schema.ts"),
        { inlineExternalTypes: true },
      );
      const directHolder = direct.find((r) => r.schemaName === "DirectQualifiedSchema");
      expect(directHolder?.input).toMatch(/import\(".*kind"\)\.Kind\.A/);
      expect(directHolder?.input).toMatch(/import\(".*kind"\)\.Box<string>/);

      // Holder isn't visible from schema.ts (only Wrapper is), so reaching
      // it recurses into holder.ts's own declaration - where Kind and Box
      // *are* visible, printing as the bare "Kind.A"/"Box<string>" that
      // promoteBareTypeReferences has to turn into the same valid form.
      const viaWrapper = extractor.extractAll(
        resolve(fixturesDir, "inline-external-types/qualified/schema.ts"),
        { inlineExternalTypes: true },
      );
      const wrapped = viaWrapper.find((r) => r.schemaName === "QualifiedSchema");
      expect(wrapped?.input).toMatch(/import\(".*kind"\)\.Kind\.A/);
      expect(wrapped?.input).toMatch(/import\(".*kind"\)\.Box<string>/);
      // Holder itself has no such ambiguity, so it's still expanded, not referenced.
      expect(wrapped?.input).not.toMatch(/import\(".*holder"\)/);
    });

    it("should document the known limitation: a cycle through a non-exported same-file type has no fallback and is left as a bare identifier", () => {
      const results = extractor.extractAll(
        resolve(fixturesDir, "inline-external-types/nonexported-cycle/schema.ts"),
        { inlineExternalTypes: true },
      );
      const result = results.find((r) => r.schemaName === "NonExportedCycleSchema");

      // Middle (exported, reached through outer.ts) is expanded; Hidden -
      // declared but not exported from middle.ts, and self-referential -
      // has no importable name to fall back to on the cycle, so it's left
      // as the bare "Hidden" instead. Not asserting this is correct output
      // (it isn't, on its own) - just the accepted, documented limitation.
      expect(result?.input).toBe("{ middle: { hidden: { self?: Hidden; }; }; }");
    });

    it("should never expand a computed enum member reached through the bare-reference promotion path either", () => {
      // Unlike computed-enum-schema.ts (which exercises resolveType()'s own
      // top-level `sourceFile.getEnum()` branch on a same-file enum), Kind
      // here is only imported into holder.ts, so this only reaches
      // printEnumAsLiteralUnion through promoteBareTypeReferences ->
      // resolveExternalTypeReference, the --inline-external-types-specific path.
      const results = extractor.extractAll(
        resolve(fixturesDir, "inline-external-types/computed-enum/schema.ts"),
        { inlineExternalTypes: true },
      );
      const result = results.find((r) => r.schemaName === "ComputedEnumSchema");

      expect(result?.input).toMatch(/import\(".*kind"\)\.Kind/);
      expect(result?.input).not.toContain('"a"');
    });

    it("should resolve a reference to a type declared in a .d.ts file, not just a .ts one", () => {
      // A .d.ts file's derived module specifier ("declared", not
      // "declared.d") has to match what TypeScript's own printer
      // synthesizes for it, or resolveModuleSourceFile()'s lookup misses -
      // exercised through the bare-reference promotion path (holder.ts's
      // own import of Declared), not just the top-level synthesis path.
      const results = extractor.extractAll(
        resolve(fixturesDir, "inline-external-types/dts-source/schema.ts"),
        { inlineExternalTypes: true },
      );
      const result = results.find((r) => r.schemaName === "DtsSourceSchema");

      expect(result?.input).toBe("{ declared: { value: string; }; }");
    });

    it("should not treat a bare package specifier as a filesystem path to probe", () => {
      // "virtual-lib" is an ambient module (package-specifier/ambient.d.ts),
      // not a relative or absolute path - import("virtual-lib") is exactly
      // the form a real node_modules package would print. Resolving it
      // against the filesystem (e.g. probing "virtual-lib.ts") could
      // accidentally match an unrelated same-named local file; it must be
      // left as the reference, not expanded, however the file is named.
      //
      // ambient.d.ts needs to be loaded into the shared project before
      // schema.ts is (skipFileDependencyResolution means extractAll never
      // pulls it in on its own) - getSchemaNames touches it for that,
      // independent of it having no schemas of its own.
      extractor.getSchemaNames(
        resolve(fixturesDir, "inline-external-types/package-specifier/ambient.d.ts"),
      );
      const results = extractor.extractAll(
        resolve(fixturesDir, "inline-external-types/package-specifier/schema.ts"),
        { inlineExternalTypes: true },
      );
      const result = results.find((r) => r.schemaName === "PackageSpecifierSchema");

      expect(result?.input).toBe('{ foo: import("virtual-lib").Foo; }');
    });

    it("should never expand a typeof operand - only reference it - at both the top-level synthesis and bare-reference promotion paths", () => {
      // Holder is imported directly, so `typeof Kind` reaches through
      // TypeScript's own top-level synthesis: typeof import("./kind").Kind.
      const direct = extractor.extractAll(
        resolve(fixturesDir, "inline-external-types/typeof-query/direct-schema.ts"),
        { inlineExternalTypes: true },
      );
      const directResult = direct.find((r) => r.schemaName === "DirectTypeofQuerySchema");
      expect(directResult?.input).toMatch(/typeof import\(".*kind"\)\.Kind/);

      // Holder isn't visible from schema.ts (only Wrapper is), so reaching
      // it recurses into holder.ts's own declaration - the bare-reference
      // promotion path's own typeof guard.
      const viaWrapper = extractor.extractAll(
        resolve(fixturesDir, "inline-external-types/typeof-query/schema.ts"),
        { inlineExternalTypes: true },
      );
      const wrapped = viaWrapper.find((r) => r.schemaName === "TypeofQuerySchema");
      expect(wrapped?.input).toMatch(/typeof import\(".*kind"\)\.Kind/);
    });

    it("should never rewrite a method's own name just because it collides with an in-scope type also reached through bare-reference promotion", () => {
      const results = extractor.extractAll(
        resolve(fixturesDir, "inline-external-types/method-collision/schema.ts"),
        { inlineExternalTypes: true },
      );
      const result = results.find((r) => r.schemaName === "MethodCollisionSchema");

      // Box() is the method's own name and must survive unrewritten; the
      // field named `value` (a real reference to Box) must still be
      // expanded into Box's own structure, not the method signature.
      expect(result?.input).toContain("Box(): string");
      expect(result?.input).toContain("value: { value: string; }");

      // GenericBox<T extends ...>() is the same collision via the method's
      // own type parameter list - `<T ...>` must not be read as a generic
      // instantiation of the imported GenericBox, which would strand it
      // after an import("...").GenericBox rewrite. The constraint's own
      // arrow-function type carries a `>` that never opened a matching `<`
      // (the same case hasTopLevelUnionOrIntersection excludes), so this
      // also verifies the balanced-<...> scan isn't fooled by it into
      // ending early. The `boxed` field is a genuine generic instantiation
      // of GenericBox (unlike the method signature above it), so it stays
      // referenced rather than expanded - the same qualified-name/generic-
      // instantiation rule the qualified/ fixtures already cover.
      expect(result?.input).toContain("GenericBox<T extends (x: string) => void>(): T");
      expect(result?.input).toMatch(/boxed: import\(".*box"\)\.GenericBox<string>/);
    });

    it("should wrap an expanded function type in parens before an array suffix, not just a union or intersection", () => {
      // Callback is visible in holder.ts, so expanding Holder's own
      // declaration prints "callbacks: Callback[]" - a bare identifier
      // that promoteBareTypeReferences expands to Callback's own
      // function-type structure. Without wrapping, "(value: string) =>
      // string[]" would mean a function returning string[], not an array
      // of such functions.
      const results = extractor.extractAll(
        resolve(fixturesDir, "inline-external-types/suffix-wrap/schema.ts"),
        { inlineExternalTypes: true },
      );
      const result = results.find((r) => r.schemaName === "SuffixWrapSchema");

      expect(result?.input).toBe("{ callbacks: ((value: string) => string)[]; }");
    });
  });

  createSchemaTest(extractor, "inline-external-types/chain/schema");
  createSchemaTest(extractor, "inline-external-types/cycle/schema");
  createSchemaTest(extractor, "inline-external-types/qualified/direct-schema");
  createSchemaTest(extractor, "inline-external-types/qualified/schema");

  // The tests above assert on individual substrings of the raw extracted
  // type; none of them get run through tsgo. These mirror createSchemaTest
  // but with the flag on, so the afterAll sweep below actually type-checks
  // the novel output shapes this feature produces - parenthesized unions,
  // the cycle fallback, and multi-file expansion - the same way every other
  // fixture's declaration file is verified to compile.
  createSchemaTest(
    extractor,
    "inline-external-types/chain/schema",
    "should generate TypeScript declarations",
    {
      context: { inlineExternalTypes: true },
      snapshotName: "inline-external-types/chain/schema-inlined",
    },
  );
  createSchemaTest(
    extractor,
    "inline-external-types/cycle/schema",
    "should generate TypeScript declarations",
    {
      context: { inlineExternalTypes: true },
      snapshotName: "inline-external-types/cycle/schema-inlined",
    },
  );
  createSchemaTest(
    extractor,
    "inline-external-types/qualified/schema",
    "should generate TypeScript declarations",
    {
      context: { inlineExternalTypes: true },
      snapshotName: "inline-external-types/qualified/schema-inlined",
    },
  );
  createSchemaTest(
    extractor,
    "inline-external-types/dts-source/schema",
    "should generate TypeScript declarations",
    {
      context: { inlineExternalTypes: true },
      snapshotName: "inline-external-types/dts-source/schema-inlined",
    },
  );

  describe("non-generated-intermediate-schema.ts", () => {
    /**
     * Runs the fixture through the same steps the CLI does for
     * `--with-descriptions`.
     */
    async function generateWithDescriptions(): Promise<string> {
      const filePath = resolve(fixturesDir, "non-generated-intermediate-schema.ts");
      const results = extractor.extractAll(filePath);
      const descriptionExtractor = new DescriptionExtractor();

      const descriptions = await descriptionExtractor.extractDescriptions(
        filePath,
        results.map((r) => r.schemaName),
      );

      return generateDeclarationFile(
        results.map((result) => {
          const desc = descriptions.get(result.schemaName);
          if (!desc) {
            return result;
          }
          return { ...result, description: desc.description, fieldDescriptions: desc.fields };
        }),
        mapName,
      );
    }

    it("keeps referencing a generated type through schemas that generate none", async () => {
      const output = await generateWithDescriptions();

      // The reference works one level down, which is the baseline.
      expect(output).toContain("direct: IntermediateNodeInput;");

      // It has to survive being nested inside an inlined schema too - through
      // one non-generated level, and through two.
      expect(output).toContain(
        [
          "  viaGroup: {",
          "    members: IntermediateNodeInput[];",
          "    byKey: {",
          "      [x: string]: IntermediateNodeInput;",
          "    };",
          "    lead?: IntermediateNodeInput;",
          "  };",
        ].join("\n"),
      );
      expect(output).toContain(
        [
          "  viaDepartment: {",
          "    /** The group */",
          "    group: {",
          "      members: IntermediateNodeInput[];",
        ].join("\n"),
      );

      // The output direction resolves to the output names, not the input ones.
      expect(output).toContain("members: IntermediateNodeOutput[];");
    });

    it("approximates a recursive schema no file declares a name for", async () => {
      const output = await generateWithDescriptions();

      // Nothing declares this one, so it stays inlined - but the recursion point
      // keeps its index signature, without which property access would go
      // unchecked, and no undeclared name leaks out.
      expect(output).toContain(
        [
          "  localRecursive: {",
          "    /** The local label */",
          "    label: string;",
          "    kids: {",
          "      [x: string]: {",
          "        /** The local label */",
          "        label: string;",
          "        kids: {",
          "          [x: string]: any;",
          "        };",
          "      };",
          "    };",
          "  };",
        ].join("\n"),
      );
      expect(output).not.toContain("LocalRecursive");
      expect(output).not.toMatch(/kids: any/);
    });

    it("keeps v.description() on every inlined level", async () => {
      const output = await generateWithDescriptions();

      // `viaDepartment.group` is the only field this description sits on, so it
      // appears once per direction.
      expect(output.match(/\/\*\* The group \*\//g)).toHaveLength(2);
      // Depth 0 and the level below the index signature, in both directions.
      expect(output.match(/\/\*\* The local label \*\//g)).toHaveLength(4);
      expect(output.match(/\/\*\* The node name \*\//g)).toHaveLength(2);
    });
  });

  describe("cross-file-recursive", () => {
    it("falls back to an index signature, never a bare any, without an importable declaration", () => {
      const results = extractor.extractAll(
        resolve(fixturesDir, "cross-file-recursive/tree-schema.ts"),
      );
      const tree = results.find((r) => r.schemaName === "CrossFileTreeSchema");

      // Nothing declares the imported schema's types here, so it stays inlined -
      // but its recursion point keeps the index signature, without which
      // property access would go unchecked.
      expect(tree?.importedFrom).toBeUndefined();
      expect(tree?.input).toContain("children: { [x: string]: any; }");
      expect(tree?.input).not.toMatch(/children: any/);
    });

    it("references the imported recursive schema by name when its file is generated too", () => {
      const nodeFile = resolve(fixturesDir, "cross-file-recursive/node-schema.ts");
      const results = extractor.extractAll(
        resolve(fixturesDir, "cross-file-recursive/tree-schema.ts"),
        { importableFiles: new Set([nodeFile]) },
      );

      const tree = results.find((r) => r.schemaName === "CrossFileTreeSchema");
      expect(tree?.input).toBe(
        "{ root: CrossFileNodeSchemaInput; index: { [x: string]: CrossFileNodeSchemaInput; }; " +
          "group: { members: CrossFileNodeSchemaInput[]; }; }",
      );

      const node = results.find((r) => r.schemaName === "CrossFileNodeSchema");
      expect(node?.importedFrom).toBe(nodeFile);
      expect(node?.isExported).toBe(false);
    });

    it("imports the referenced types from the file that declares them", () => {
      const nodeFile = resolve(fixturesDir, "cross-file-recursive/node-schema.ts");
      const results = extractor.extractAll(
        resolve(fixturesDir, "cross-file-recursive/tree-schema.ts"),
        { importableFiles: new Set([nodeFile]) },
      );

      const output = generateDeclarationFile(results, mapName, {
        importSources: new Map([["CrossFileNodeSchema", "./node-schema.generated"]]),
      });

      expect(output).toContain(
        'import type { CrossFileNodeInput, CrossFileNodeOutput } from "./node-schema.generated";',
      );
      expect(output).toContain("root: CrossFileNodeInput;");
      expect(output).toContain("[x: string]: CrossFileNodeOutput;");
      // The imported schema is declared by the other file, not re-declared here.
      expect(output).not.toContain("export type CrossFileNodeInput = {");
    });
  });

  describe("array-readonly-schema.ts", () => {
    it("should not add readonly modifier to regular arrays", async () => {
      const results = extractor.extractAll(resolve(fixturesDir, "array-readonly-schema.ts"));
      const output = generateDeclarationFile(results, mapName);
      await expect(output).toMatchFileSnapshot("__file_snapshots__/array-readonly-schema.ts");
    });
  });

  describe("tuple-schema.ts", () => {
    it("should preserve tuple types instead of expanding to arrays", async () => {
      const results = extractor.extractAll(resolve(fixturesDir, "tuple-schema.ts"));
      const output = generateDeclarationFile(results, mapName);
      await expect(output).toMatchFileSnapshot("__file_snapshots__/tuple-schema.ts");
    });
  });

  describe("union-nonexport-member-schema.ts", () => {
    it("should inline non-exported union members instead of using named references", async () => {
      const results = extractor.extractAll(
        resolve(fixturesDir, "union-nonexport-member-schema.ts"),
      );
      const output = generateDeclarationFile(results, mapName);
      await expect(output).toMatchFileSnapshot(
        "__file_snapshots__/union-nonexport-member-schema.ts",
      );
    });
  });

  describe("mixed-union-reference-schema.ts", () => {
    it("preserves named references through mixed and non-exported union members", () => {
      const results = extractor.extractAll(resolve(fixturesDir, "mixed-union-reference-schema.ts"));
      const mixedValue = results.find((result) => result.schemaName === "MixedValueSchema");
      const referencedValue = results.find(
        (result) => result.schemaName === "ReferencedValueSchema",
      );
      const spreadOverride = results.find((result) => result.schemaName === "SpreadOverrideSchema");
      const satisfiedSpreadOverride = results.find(
        (result) => result.schemaName === "SatisfiedSpreadOverrideSchema",
      );
      const recursiveUnion = results.find((result) => result.schemaName === "RecursiveUnionSchema");
      const mixedPlainUnion = results.find(
        (result) => result.schemaName === "MixedPlainUnionSchema",
      );
      const inlineImportedUnion = results.find(
        (result) => result.schemaName === "InlineImportedUnionSchema",
      );

      expect(mixedValue?.input).toBe("JsonValueSchemaInput | Function");
      expect(mixedValue?.output).toBe("JsonValueSchemaOutput | Function");
      expect(referencedValue?.input).not.toContain("any");
      expect(referencedValue?.output).not.toContain("any");
      expect(referencedValue?.input.match(/value\?: MixedValueSchemaInput/g)).toHaveLength(2);
      expect(referencedValue?.output.match(/value\?: MixedValueSchemaOutput/g)).toHaveLength(2);
      expect(spreadOverride?.input).toBe("{ value?: { [x: string]: unknown; } | undefined; }");
      expect(spreadOverride?.output).toBe("{ value?: { [x: string]: unknown; } | undefined; }");
      expect(satisfiedSpreadOverride?.input).toBe(
        "{ value?: { [x: string]: unknown; } | undefined; }",
      );
      expect(satisfiedSpreadOverride?.output).toBe(
        "{ value?: { [x: string]: unknown; } | undefined; }",
      );
      expect(recursiveUnion?.input).not.toContain("InternalNodeSchemaInput");
      expect(recursiveUnion?.output).not.toContain("InternalNodeSchemaOutput");
      expect(mixedPlainUnion?.input).not.toContain("PublicPlainSchemaInput");
      expect(mixedPlainUnion?.output).not.toContain("PublicPlainSchemaOutput");
      expect(inlineImportedUnion?.input).toContain("string");
      expect(inlineImportedUnion?.output).toContain("string");
    });
  });

  describe("declaration options", () => {
    it("should generate with inputOnly option", async () => {
      const results = extractor.extractAll(resolve(fixturesDir, "transform-schema.ts"));
      const output = generateDeclarationFile(results, mapName, { inputOnly: true });
      await expect(output).toMatchFileSnapshot("__file_snapshots__/options-inputOnly.ts");
    });

    it("should generate with outputOnly option", async () => {
      const results = extractor.extractAll(resolve(fixturesDir, "transform-schema.ts"));
      const output = generateDeclarationFile(results, mapName, { outputOnly: true });
      await expect(output).toMatchFileSnapshot("__file_snapshots__/options-outputOnly.ts");
    });

    it("should generate with mergeSame option", async () => {
      const results = extractor.extractAll(resolve(fixturesDir, "basic-schema.ts"));
      const output = generateDeclarationFile(results, mapName, { mergeSame: true });
      await expect(output).toMatchFileSnapshot("__file_snapshots__/options-mergeSame.ts");
    });

    it("should merge transitively and emit aliases for multi-schema with mergeSame", async () => {
      const results = extractor.extractAll(resolve(fixturesDir, "mergeSame-multi-schema.ts"));
      const output = generateDeclarationFile(results, mapName, { mergeSame: true });
      await expect(output).toMatchFileSnapshot("__file_snapshots__/options-mergeSame-multi.ts");
    });
  });

  describe('subpath imports (package.json "imports" field)', () => {
    it("should resolve schemas imported via the #/* wildcard pattern", () => {
      const results = extractor.extractAll(resolve(fixturesDir, "subpath-import/consumer.ts"));
      const consumer = results.find((r) => r.schemaName === "ConsumerSchema");

      expect(consumer).toBeDefined();
      // The imported SharedSchema / AnotherSharedSchema must be fully resolved
      // (not collapsed to `any`) for the object shape to be inferred correctly.
      expect(consumer!.input).toContain("shared: {");
      expect(consumer!.input).toContain("id: string");
      expect(consumer!.input).toContain("another: {");
      expect(consumer!.input).toContain("value: number");
      expect(consumer!.input).not.toContain("any");
    });

    it("should resolve schemas imported via an exact subpath key", () => {
      const results = extractor.extractAll(
        resolve(fixturesDir, "subpath-import/exact-consumer.ts"),
      );
      const consumer = results.find((r) => r.schemaName === "ExactConsumerSchema");

      expect(consumer).toBeDefined();
      expect(consumer!.input).toContain("shared: {");
      expect(consumer!.input).toContain("id: string");
      expect(consumer!.input).not.toContain("any");
    });

    it("should preserve field descriptions when a schema imports via the #/* wildcard pattern", async () => {
      const filePath = resolve(fixturesDir, "subpath-import/described-consumer.ts");
      const descriptionExtractor = new DescriptionExtractor();

      const descriptions = await descriptionExtractor.extractDescriptions(filePath, [
        "DescribedConsumerSchema",
      ]);

      const desc = descriptions.get("DescribedConsumerSchema");
      const nameField = desc?.fields.find((f) => f.path === "name");
      expect(nameField?.description).toBe("The user's name");
    });

    it("should preserve field descriptions when a schema imports via a named subpath prefix (#src/*)", async () => {
      const filePath = resolve(fixturesDir, "subpath-import/described-named-consumer.ts");
      const descriptionExtractor = new DescriptionExtractor();

      const descriptions = await descriptionExtractor.extractDescriptions(filePath, [
        "DescribedNamedConsumerSchema",
      ]);

      const desc = descriptions.get("DescribedNamedConsumerSchema");
      const nameField = desc?.fields.find((f) => f.path === "name");
      expect(nameField?.description).toBe("The user's name");
    });

    it("should preserve field descriptions when the #/* target has a suffix after the wildcard (#/* -> ./src/*.ts)", async () => {
      const filePath = resolve(fixturesDir, "subpath-import-suffix/consumer.ts");
      const descriptionExtractor = new DescriptionExtractor();

      const descriptions = await descriptionExtractor.extractDescriptions(filePath, [
        "SuffixConsumerSchema",
      ]);

      const desc = descriptions.get("SuffixConsumerSchema");
      const nameField = desc?.fields.find((f) => f.path === "name");
      expect(nameField?.description).toBe("The user's name");
    });
  });
});
