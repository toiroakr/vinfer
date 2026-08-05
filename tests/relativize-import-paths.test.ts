import { describe, it, expect } from "vitest";
import { relativizeImportPaths } from "../src/core/type-printer.js";

describe("relativizeImportPaths", () => {
  it("should convert absolute import paths to relative paths", () => {
    const content = `export type Foo = import("/Users/dev/project/src/types/bar").Bar;`;
    const outputPath = "/Users/dev/project/src/types/foo.generated.ts";

    const result = relativizeImportPaths(content, outputPath);

    expect(result).toBe(`export type Foo = import("./bar").Bar;`);
  });

  it("should handle imports from parent directories", () => {
    const content = `export type Foo = import("/Users/dev/project/src/other/bar").Bar;`;
    const outputPath = "/Users/dev/project/src/types/foo.generated.ts";

    const result = relativizeImportPaths(content, outputPath);

    expect(result).toBe(`export type Foo = import("../other/bar").Bar;`);
  });

  it("should leave relative import paths unchanged", () => {
    const content = `export type Foo = import("./bar").Bar;`;
    const outputPath = "/Users/dev/project/src/types/foo.generated.ts";

    const result = relativizeImportPaths(content, outputPath);

    expect(result).toBe(`export type Foo = import("./bar").Bar;`);
  });

  it("should handle multiple import paths in the same content", () => {
    const content = [
      `export type A = import("/Users/dev/project/src/types/plugin").TypeA;`,
      `export type B = import("/Users/dev/project/src/types/plugin-gen").TypeB;`,
    ].join("\n");
    const outputPath = "/Users/dev/project/src/types/foo.generated.ts";

    const result = relativizeImportPaths(content, outputPath);

    expect(result).toBe(
      [
        `export type A = import("./plugin").TypeA;`,
        `export type B = import("./plugin-gen").TypeB;`,
      ].join("\n"),
    );
  });

  it("should handle Windows-style absolute paths", () => {
    const content = `export type Foo = import("D:/a/project/src/types/bar").Bar;`;
    const outputPath = "D:/a/project/src/types/foo.generated.ts";

    const result = relativizeImportPaths(content, outputPath);

    expect(result).toBe(`export type Foo = import("./bar").Bar;`);
  });

  it("should return content unchanged when no import() paths exist", () => {
    const content = `export type Foo = { bar: string };`;
    const outputPath = "/Users/dev/project/src/types/foo.generated.ts";

    const result = relativizeImportPaths(content, outputPath);

    expect(result).toBe(content);
  });
});
