import { describe, it, expect } from "vitest";
import { resolve } from "pathe";
import { FileResolver } from "../src/core/file-resolver.js";

const testsDir = resolve(import.meta.dirname);
const resolver = new FileResolver();

describe("FileResolver.resolveInputFiles", () => {
  it("resolves a glob pattern to absolute, sorted paths", async () => {
    const files = await resolver.resolveInputFiles("fixtures/basic-*.ts", testsDir);
    expect(files).toEqual([resolve(testsDir, "fixtures/basic-schema.ts")]);
  });

  it("de-duplicates overlapping patterns", async () => {
    const files = await resolver.resolveInputFiles(
      ["fixtures/basic-schema.ts", "fixtures/basic-*.ts"],
      testsDir,
    );
    expect(files).toEqual([resolve(testsDir, "fixtures/basic-schema.ts")]);
  });

  it("returns an empty array when nothing matches", async () => {
    expect(await resolver.resolveInputFiles("fixtures/nope-*.ts", testsDir)).toEqual([]);
  });

  it("returns files in sorted order", async () => {
    const files = await resolver.resolveInputFiles("fixtures/import-test/*.ts", testsDir);
    expect(files).toEqual([...files].sort());
    expect(files.length).toBeGreaterThan(1);
  });

  it("excludes files matching the exclude patterns", async () => {
    const files = await resolver.resolveInputFiles("fixtures/import-test/*.ts", testsDir, [
      "**/consumer.ts",
    ]);
    expect(files).toEqual([
      resolve(testsDir, "fixtures/import-test/index.ts"),
      resolve(testsDir, "fixtures/import-test/re-export-consumer.ts"),
      resolve(testsDir, "fixtures/import-test/shared.ts"),
    ]);
  });
});

describe("FileResolver.resolveOutputPath", () => {
  const input = "/project/src/schemas/user.ts";

  it("defaults to <name>.types.ts next to the input", () => {
    expect(resolver.resolveOutputPath(input, {})).toBe("/project/src/schemas/user.types.ts");
  });

  it("switches the default extension for declarations", () => {
    expect(resolver.resolveOutputPath(input, { declaration: true })).toBe(
      "/project/src/schemas/user.types.d.ts",
    );
  });

  it("writes into outDir, resolved against cwd", () => {
    expect(resolver.resolveOutputPath(input, { outDir: "./types" }, "/project")).toBe(
      "/project/types/user.types.ts",
    );
  });

  it("uses outFile verbatim, ignoring the input", () => {
    expect(resolver.resolveOutputPath(input, { outFile: "./all.ts" }, "/project")).toBe(
      "/project/all.ts",
    );
  });

  it("applies an outPattern", () => {
    expect(resolver.resolveOutputPath(input, { outPattern: "[name].generated.ts" })).toBe(
      "/project/src/schemas/user.generated.ts",
    );
  });

  it("substitutes [dir] and [ext] in an outPattern", () => {
    expect(
      resolver.resolveOutputPath(input, { outPattern: "[dir]-[name][ext]", declaration: true }),
    ).toBe("/project/src/schemas/schemas-user.d.ts");
  });
});

describe("FileResolver.applyPattern", () => {
  it("replaces every placeholder occurrence", () => {
    expect(resolver.applyPattern("[name]/[name][ext]", { name: "user", ext: ".ts" })).toBe(
      "user/user.ts",
    );
  });

  it("falls back to the name when no dir is given", () => {
    expect(resolver.applyPattern("[dir]", { name: "user", ext: ".ts" })).toBe("user");
  });

  it("treats $ in substituted values literally", () => {
    expect(resolver.applyPattern("[name][ext]", { name: "us$&er", ext: ".ts" })).toBe("us$&er.ts");
  });
});
