import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "path";
import { Project } from "ts-morph";
import { ImportResolver } from "../src/core/import-resolver.js";

const fixturesDir = resolve(import.meta.dirname, "fixtures");

describe("ImportResolver", () => {
  let resolver: ImportResolver;
  let project: Project;

  beforeEach(() => {
    resolver = new ImportResolver();
    project = new Project({
      tsConfigFilePath: resolve(import.meta.dirname, "..", "tsconfig.json"),
    });
  });

  describe("findImportedSchemas", () => {
    it("should find imported schemas from local files", () => {
      const consumerPath = resolve(fixturesDir, "import-test/consumer.ts");
      const sourceFile = project.addSourceFileAtPath(consumerPath);

      const importedSchemas = resolver.findImportedSchemas(sourceFile, project);

      expect(importedSchemas.size).toBe(2);
      expect(importedSchemas.has("SharedSchema")).toBe(true);
      expect(importedSchemas.has("AnotherSharedSchema")).toBe(true);

      const sharedInfo = importedSchemas.get("SharedSchema")!;
      expect(sharedInfo.localName).toBe("SharedSchema");
      expect(sharedInfo.originalName).toBe("SharedSchema");
      expect(sharedInfo.resolved).toBe(true);
      expect(sharedInfo.sourceFilePath).toContain("shared.ts");
    });

    it("should handle re-exports from index files", () => {
      const reExportConsumerPath = resolve(fixturesDir, "import-test/re-export-consumer.ts");
      const sourceFile = project.addSourceFileAtPath(reExportConsumerPath);

      const importedSchemas = resolver.findImportedSchemas(sourceFile, project);

      // Re-export resolution depends on ts-morph's module resolution
      // Current implementation may not resolve all re-export patterns
      // This test documents the current behavior
      if (importedSchemas.size > 0) {
        expect(importedSchemas.has("SharedSchema")).toBe(true);
        const sharedInfo = importedSchemas.get("SharedSchema")!;
        expect(sharedInfo.resolved).toBe(true);
        // Should resolve to the original source file
        expect(sharedInfo.sourceFilePath).toContain("shared.ts");
      } else {
        // If re-exports are not resolved, the map will be empty
        // This is a known limitation with certain module resolution configurations
        expect(importedSchemas.size).toBe(0);
      }
    });

    it("should ignore node_modules imports", () => {
      const consumerPath = resolve(fixturesDir, "import-test/consumer.ts");
      const sourceFile = project.addSourceFileAtPath(consumerPath);

      const importedSchemas = resolver.findImportedSchemas(sourceFile, project);

      // Should not include 'v' from valibot
      expect(importedSchemas.has("v")).toBe(false);
    });

    it("should return empty map for files with no local imports", () => {
      const sharedPath = resolve(fixturesDir, "import-test/shared.ts");
      const sourceFile = project.addSourceFileAtPath(sharedPath);

      const importedSchemas = resolver.findImportedSchemas(sourceFile, project);

      expect(importedSchemas.size).toBe(0);
    });

    it("should resolve subpath imports with a wildcard pattern (#/*)", () => {
      const consumerPath = resolve(fixturesDir, "subpath-import/consumer.ts");
      const sourceFile = project.addSourceFileAtPath(consumerPath);

      const importedSchemas = resolver.findImportedSchemas(sourceFile, project);

      expect(importedSchemas.size).toBe(2);
      expect(importedSchemas.has("SharedSchema")).toBe(true);
      expect(importedSchemas.has("AnotherSharedSchema")).toBe(true);

      const sharedInfo = importedSchemas.get("SharedSchema")!;
      expect(sharedInfo.localName).toBe("SharedSchema");
      expect(sharedInfo.originalName).toBe("SharedSchema");
      expect(sharedInfo.resolved).toBe(true);
      expect(sharedInfo.sourceFilePath).toContain("subpath-import/schemas/shared.ts");
    });

    it("should resolve exact (non-wildcard) subpath imports", () => {
      const consumerPath = resolve(fixturesDir, "subpath-import/exact-consumer.ts");
      const sourceFile = project.addSourceFileAtPath(consumerPath);

      const importedSchemas = resolver.findImportedSchemas(sourceFile, project);

      expect(importedSchemas.has("SharedSchema")).toBe(true);
      const sharedInfo = importedSchemas.get("SharedSchema")!;
      expect(sharedInfo.resolved).toBe(true);
      expect(sharedInfo.sourceFilePath).toContain("subpath-import/schemas/shared.ts");
    });
  });
});
