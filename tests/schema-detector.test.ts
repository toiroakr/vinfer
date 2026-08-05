import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { Project } from "ts-morph";
import { SchemaDetector } from "../src/core/schema-detector.js";

const fixturesDir = resolve(import.meta.dirname, "fixtures");

describe("SchemaDetector", () => {
  const detector = new SchemaDetector();

  function getSourceFile(filename: string) {
    const project = new Project();
    return project.addSourceFileAtPath(resolve(fixturesDir, filename));
  }

  function createSourceFile(filename: string, content: string) {
    const project = new Project();
    return project.createSourceFile(filename, content);
  }

  describe("detectExportedSchemas", () => {
    it("should detect schemas from basic-schema.ts", () => {
      const sourceFile = getSourceFile("basic-schema.ts");
      const schemas = detector.detectExportedSchemas(sourceFile);
      expect(schemas).toMatchSnapshot();
    });

    it("should detect schemas from multi-schema.ts", () => {
      const sourceFile = getSourceFile("multi-schema.ts");
      const schemas = detector.detectExportedSchemas(sourceFile);
      expect(schemas).toMatchSnapshot();
    });

    it("should detect schemas from utility-types-schema.ts", () => {
      const sourceFile = getSourceFile("utility-types-schema.ts");
      const schemas = detector.detectExportedSchemas(sourceFile);
      expect(schemas).toMatchSnapshot();
    });

    it("should detect schemas from union-schema.ts", () => {
      const sourceFile = getSourceFile("union-schema.ts");
      const schemas = detector.detectExportedSchemas(sourceFile);
      expect(schemas).toMatchSnapshot();
    });

    it("should detect schemas from mixed-export-schema.ts", () => {
      const sourceFile = getSourceFile("mixed-export-schema.ts");
      const schemas = detector.detectExportedSchemas(sourceFile);
      expect(schemas).toMatchSnapshot();
    });

    it("should detect schemas from named-import-schema.ts", () => {
      const sourceFile = getSourceFile("named-import-schema.ts");
      const schemas = detector.detectExportedSchemas(sourceFile);
      expect(schemas).toMatchSnapshot();
    });

    it("should detect schemas from namespace-alias-schema.ts", () => {
      const sourceFile = getSourceFile("namespace-alias-schema.ts");
      const schemas = detector.detectExportedSchemas(sourceFile);
      expect(schemas).toMatchSnapshot();
    });

    it("should detect schemas whose builder call is formatted across multiple lines", () => {
      // Inline source keeps the line breaks that formatters insert inside long
      // pipes, which fixtures on disk would lose to this repository's own
      // formatter.
      const sourceFile = createSourceFile(
        "multiline-schema.ts",
        [
          'import * as v from "valibot";',
          "export const MultilineUnionSchema = v",
          "  .pipe(",
          '    v.union([v.literal("active"), v.literal("inactive")]),',
          '    v.description("status of the entity"),',
          "  );",
          "export const MultilineStringSchema = v.pipe(",
          "  v.string(),",
          "  v.minLength(1),",
          '  v.description("non-empty string"),',
          ");",
          "export const MultilineLazySchema = v.lazy(",
          "  () => v.object({ name: v.string() }),",
          ");",
        ].join("\n"),
      );
      const names = detector.detectExportedSchemas(sourceFile).map((s) => s.name);
      expect(names).toEqual([
        "MultilineUnionSchema",
        "MultilineStringSchema",
        "MultilineLazySchema",
      ]);
    });

    it("should ignore non-Valibot declarations", () => {
      const sourceFile = createSourceFile(
        "not-a-schema.ts",
        [
          'import * as v from "valibot";',
          'import { object } from "./local-helpers.js";',
          "export const NotASchema = object({ a: 1 });",
          'export const alsoNot = "plain string";',
          "export const stillNot = { entries: {} };",
          "export const IsASchema = v.string();",
        ].join("\n"),
      );
      const names = detector.detectExportedSchemas(sourceFile).map((s) => s.name);
      expect(names).toEqual(["IsASchema"]);
    });

    it("should detect schemas declared with an explicit GenericSchema annotation", () => {
      const sourceFile = createSourceFile(
        "explicit-annotation.ts",
        [
          'import * as v from "valibot";',
          "type Node = { children: Node[] };",
          "export const NodeSchema: v.GenericSchema<Node> = v.lazy(() =>",
          "  v.object({ children: v.array(NodeSchema) }),",
          ");",
          "export const BareSchema: BaseSchema<string, string, never> = anything;",
        ].join("\n"),
      );
      const schemas = detector.detectExportedSchemas(sourceFile);
      expect(schemas.map((s) => [s.name, s.explicitType])).toEqual([
        ["NodeSchema", "Node"],
        ["BareSchema", "string"],
      ]);
    });
  });

  describe("getSchemaNames", () => {
    it("should return schema names from basic-schema.ts", () => {
      const sourceFile = getSourceFile("basic-schema.ts");
      const names = detector.getSchemaNames(sourceFile);
      expect(names).toMatchSnapshot();
    });

    it("should return schema names from multi-schema.ts", () => {
      const sourceFile = getSourceFile("multi-schema.ts");
      const names = detector.getSchemaNames(sourceFile);
      expect(names).toMatchSnapshot();
    });
  });
});
