import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve, basename } from "pathe";
import { ValibotTypeExtractor } from "../src/core/extractor.js";
import { generateDeclarationFile } from "../src/core/type-printer.js";
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
) {
  describe(`${schemaName}.ts`, () => {
    it(description, async () => {
      const results = extractor.extractAll(resolve(fixturesDir, `${schemaName}.ts`));
      const output = generateDeclarationFile(results, mapName);
      await expect(output).toMatchFileSnapshot(`__file_snapshots__/${schemaName}.ts`);
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
