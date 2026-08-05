import { describe, it, expect } from "vitest";
import {
  TestGenerator,
  generateTypeTests,
  generateImportPrefix,
  createTestSchemaInfo,
  toPascalCase,
  type TestFileInfo,
} from "../src/core/test-generator.js";

const userFile: TestFileInfo = {
  schemaFilePath: "../schemas/user.ts",
  typesFilePath: "./user.ts",
  importPrefix: "User",
  schemas: [{ schemaName: "UserSchema", inputTypeName: "UserInput", outputTypeName: "UserOutput" }],
};

describe("toPascalCase", () => {
  it.each([
    ["basic-schema", "BasicSchema"],
    ["basic_schema", "BasicSchema"],
    ["user", "User"],
    ["a-b-c", "ABC"],
  ])("converts %s to %s", (input, expected) => {
    expect(toPascalCase(input)).toBe(expected);
  });
});

describe("generateImportPrefix", () => {
  it("derives a PascalCase prefix from the file name", () => {
    expect(generateImportPrefix("src/schemas/basic-schema.ts")).toBe("BasicSchema");
  });

  it.each([".ts", ".js", ".mts", ".cjs", ".tsx"])("strips the %s extension", (ext) => {
    expect(generateImportPrefix(`user${ext}`)).toBe("User");
  });

  it("leaves an unknown extension in place", () => {
    expect(generateImportPrefix("user.schema")).toBe("User.schema");
  });
});

describe("createTestSchemaInfo", () => {
  it("pairs the schema name with its mapped type names", () => {
    expect(
      createTestSchemaInfo("UserSchema", {
        originalName: "UserSchema",
        inputName: "UserInput",
        outputName: "UserOutput",
        unifiedName: "User",
      }),
    ).toEqual({
      schemaName: "UserSchema",
      inputTypeName: "UserInput",
      outputTypeName: "UserOutput",
    });
  });
});

describe("TestGenerator", () => {
  it("returns an empty string when there are no files", () => {
    expect(new TestGenerator().generate([])).toBe("");
  });

  it("imports vitest and Valibot's inference types", () => {
    const output = generateTypeTests([userFile]);
    expect(output).toContain('import { describe, it, expectTypeOf } from "vitest";');
    expect(output).toContain('import type * as v from "valibot";');
  });

  it("asserts both directions against v.InferInput / v.InferOutput", () => {
    const output = generateTypeTests([userFile]);
    expect(output).toContain(
      "expectTypeOf<UserUserInput>().toEqualTypeOf<v.InferInput<typeof UserUserSchema>>();",
    );
    expect(output).toContain(
      "expectTypeOf<UserUserOutput>().toEqualTypeOf<v.InferOutput<typeof UserUserSchema>>();",
    );
  });

  it("imports schemas and types with the file's prefix, without extensions", () => {
    const output = generateTypeTests([userFile]);
    expect(output).toContain('import { UserSchema as UserUserSchema } from "../schemas/user";');
    expect(output).toContain(
      'import type { UserInput as UserUserInput, UserOutput as UserUserOutput } from "./user";',
    );
  });

  it("wraps long type-import lists across lines", () => {
    const output = generateTypeTests([
      {
        ...userFile,
        schemas: [
          ...userFile.schemas,
          { schemaName: "PostSchema", inputTypeName: "PostInput", outputTypeName: "PostOutput" },
        ],
      },
    ]);
    expect(output).toContain("import type {\n  UserInput as UserUserInput,");
  });

  it("groups tests per file with a describe block", () => {
    const output = generateTypeTests([
      userFile,
      {
        schemaFilePath: "../schemas/post.ts",
        typesFilePath: "./post.ts",
        importPrefix: "Post",
        schemas: [
          { schemaName: "PostSchema", inputTypeName: "PostInput", outputTypeName: "PostOutput" },
        ],
      },
    ]);
    expect(output).toContain('describe("user", () => {');
    expect(output).toContain('describe("post", () => {');
    expect(output).toContain('describe("Type equality tests", () => {');
  });

  it("can omit the header comment", () => {
    const output = new TestGenerator({ includeHeader: false }).generate([userFile]);
    expect(output).not.toContain("auto-generated");
    expect(output.startsWith("import { describe")).toBe(true);
  });
});
