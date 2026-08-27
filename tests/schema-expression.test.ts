import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { ValibotBindings } from "../src/core/valibot-bindings.js";
import { analyzeSchemaExpression, unwrapExpression } from "../src/core/schema-expression.js";

let fileCounter = 0;

/**
 * Analyzes `const Target = <expression>;` against the given known schema names.
 */
function analyze(expression: string, knownSchemas: string[] = ["AddressSchema"]) {
  const project = new Project();
  const sourceFile = project.createSourceFile(
    `expr-${fileCounter++}.ts`,
    ['import * as v from "valibot";', `const Target = ${expression};`].join("\n"),
  );
  const initializer = sourceFile.getVariableDeclarationOrThrow("Target").getInitializerOrThrow();
  const names = new Set(knownSchemas);

  return analyzeSchemaExpression(initializer, ValibotBindings.from(sourceFile), (name) =>
    names.has(name),
  );
}

describe("analyzeSchemaExpression", () => {
  it("resolves a bare reference", () => {
    expect(analyze("AddressSchema")).toEqual({
      refSchema: "AddressSchema",
      isArray: false,
      isRecord: false,
      isOptional: false,
      isNullable: false,
      isUndefinedable: false,
    });
  });

  it("resolves a reference through v.array()", () => {
    expect(analyze("v.array(AddressSchema)")).toMatchObject({
      refSchema: "AddressSchema",
      isArray: true,
      isOptional: false,
    });
  });

  // Per Valibot's own `OptionalEntrySchema` mapped type, only optional/
  // exactOptional/nullish mark the object key itself optional - nullable and
  // undefinedable only widen the value's type (see valibot-bindings.ts).
  it.each([
    ["v.optional(AddressSchema)", { isOptional: true, isNullable: false, isUndefinedable: false }],
    [
      "v.exactOptional(AddressSchema)",
      { isOptional: true, isNullable: false, isUndefinedable: false },
    ],
    ["v.nullable(AddressSchema)", { isOptional: false, isNullable: true, isUndefinedable: false }],
    ["v.nullish(AddressSchema)", { isOptional: true, isNullable: true, isUndefinedable: false }],
    [
      "v.undefinedable(AddressSchema)",
      { isOptional: false, isNullable: false, isUndefinedable: true },
    ],
  ] as const)("resolves a reference through %s", (expression, expected) => {
    expect(analyze(expression)).toMatchObject({
      refSchema: "AddressSchema",
      ...expected,
    });
  });

  it("resolves a reference through nested wrappers", () => {
    expect(analyze("v.optional(v.array(AddressSchema))")).toEqual({
      refSchema: "AddressSchema",
      isArray: true,
      isRecord: false,
      isOptional: true,
      isNullable: false,
      isUndefinedable: false,
    });
  });

  it("accumulates flags across separately composed wrappers", () => {
    // v.optional(v.nullable(...)) has the same effect as v.nullish(...) but is
    // written as two independent wrapper calls peeled one at a time.
    expect(analyze("v.optional(v.nullable(AddressSchema))")).toMatchObject({
      refSchema: "AddressSchema",
      isOptional: true,
      isNullable: true,
      isUndefinedable: false,
    });
  });

  it("resolves the value schema of v.record()", () => {
    expect(analyze("v.record(v.string(), AddressSchema)")).toMatchObject({
      refSchema: "AddressSchema",
      isRecord: true,
    });
  });

  it("resolves a reference behind type-preserving pipe actions", () => {
    expect(analyze('v.pipe(AddressSchema, v.description("an address"))')).toMatchObject({
      refSchema: "AddressSchema",
    });
    expect(analyze("v.pipe(v.array(AddressSchema), v.minLength(1))")).toMatchObject({
      refSchema: "AddressSchema",
      isArray: true,
    });
  });

  it("gives up when a pipe action changes the type", () => {
    expect(analyze("v.pipe(AddressSchema, v.transform((a) => a))")).toBeNull();
    expect(analyze('v.pipe(AddressSchema, v.brand("Address"))')).toBeNull();
    expect(analyze("v.pipe(v.array(AddressSchema), v.readonly())")).toBeNull();
  });

  it("gives up when a pipe ends in another schema", () => {
    expect(analyze("v.pipe(AddressSchema, v.unknown())")).toBeNull();
  });

  it("gives up on an unrecognized pipe item", () => {
    expect(analyze("v.pipe(AddressSchema, customAction)")).toBeNull();
  });

  it("gives up on nested collections, which have nowhere to put the reference", () => {
    expect(analyze("v.array(v.array(AddressSchema))")).toBeNull();
    expect(analyze("v.array(v.record(v.string(), AddressSchema))")).toBeNull();
  });

  it("gives up on schemas that are not references", () => {
    expect(analyze("v.string()")).toBeNull();
    expect(analyze("v.array(v.string())")).toBeNull();
    expect(analyze("v.object({ a: AddressSchema })")).toBeNull();
  });

  it("gives up on identifiers the caller does not accept", () => {
    expect(analyze("OtherSchema")).toBeNull();
    expect(analyze("v.array(OtherSchema)")).toBeNull();
  });

  it("looks through as/satisfies wrappers", () => {
    expect(analyze("v.array(AddressSchema as never)")).toMatchObject({
      refSchema: "AddressSchema",
      isArray: true,
    });
  });

  it("gives up on wrappers called without arguments", () => {
    expect(analyze("v.optional()")).toBeNull();
    expect(analyze("v.array()")).toBeNull();
    expect(analyze("v.record(v.string())")).toBeNull();
    expect(analyze("v.pipe()")).toBeNull();
  });
});

describe("unwrapExpression", () => {
  it("strips as, satisfies and parentheses", () => {
    const project = new Project();
    const sourceFile = project.createSourceFile(
      "unwrap.ts",
      ["type T = unknown;", "const Target = ((1 as T) satisfies T);"].join("\n"),
    );
    const initializer = sourceFile.getVariableDeclarationOrThrow("Target").getInitializerOrThrow();
    expect(unwrapExpression(initializer).getText()).toBe("1");
  });
});
