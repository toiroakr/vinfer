import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "pathe";
import { runCLI, type CLIOptions } from "../src/cli-runner.js";

const repoRoot = resolve(import.meta.dirname, "..");
const fixturesDir = resolve(import.meta.dirname, "fixtures");

let workDir: string;
let originalCwd: string;
let logs: string[];

/**
 * Runs the CLI inside the temporary working directory, capturing stdout.
 */
async function run(files: string[], options: CLIOptions = {}) {
  logs = [];
  await runCLI(files, options);
  return logs.join("\n");
}

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "vinfer-cli-"));

  // A tsconfig.json is what the CLI walks up to find; keeping the fixtures inside
  // the work directory keeps every generated path relative to it. Valibot is
  // reached through a link to the repository's node_modules, since both the type
  // checker and the description extractor resolve it from the schema's location.
  symlinkSync(join(repoRoot, "node_modules"), join(workDir, "node_modules"), "junction");
  mkdirSync(join(workDir, "schemas"), { recursive: true });
  cpSync(join(fixturesDir, "basic-schema.ts"), join(workDir, "schemas/basic-schema.ts"));
  cpSync(join(fixturesDir, "transform-schema.ts"), join(workDir, "schemas/transform-schema.ts"));
  cpSync(join(fixturesDir, "described-schema.ts"), join(workDir, "schemas/described-schema.ts"));
  writeFileSync(
    join(workDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
      },
      include: ["schemas/**/*.ts"],
    }),
  );

  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  process.chdir(workDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  rmSync(workDir, { recursive: true, force: true });
});

describe("runCLI", () => {
  it("prints declarations to stdout when no output option is given", async () => {
    const output = await run(["schemas/basic-schema.ts"]);
    expect(output).toContain("export type UserSchemaInput = {");
    expect(output).toContain("export type UserSchemaOutput = {");
  });

  it("removes the configured suffix from type names", async () => {
    const output = await run(["schemas/basic-schema.ts"], { suffix: "Schema" });
    expect(output).toContain("export type UserInput = {");
    expect(output).not.toContain("UserSchemaInput");
  });

  it("applies custom name mappings", async () => {
    const output = await run(["schemas/basic-schema.ts"], { map: "UserSchema:Account" });
    expect(output).toContain("export type AccountInput = {");
  });

  it("honors custom input and output suffixes", async () => {
    const output = await run(["schemas/basic-schema.ts"], {
      suffix: "Schema",
      inputSuffix: "In",
      outputSuffix: "Out",
    });
    expect(output).toContain("export type UserIn = {");
    expect(output).toContain("export type UserOut = {");
  });

  it("writes one file per input into outDir", async () => {
    await run(["schemas/*.ts"], { outDir: "types", suffix: "Schema" });

    const generated = readFileSync(join(workDir, "types/basic-schema.types.ts"), "utf-8");
    expect(generated).toContain("export type UserInput = {");
    expect(existsSync(join(workDir, "types/transform-schema.types.ts"))).toBe(true);
  });

  it("honors outPattern", async () => {
    await run(["schemas/basic-schema.ts"], {
      outDir: "types",
      outPattern: "[name].generated.ts",
    });
    expect(existsSync(join(workDir, "types/basic-schema.generated.ts"))).toBe(true);
  });

  it("writes declaration files with -d", async () => {
    await run(["schemas/basic-schema.ts"], { outDir: "types", declaration: true });
    expect(existsSync(join(workDir, "types/basic-schema.types.d.ts"))).toBe(true);
  });

  it("merges every input into a single outFile", async () => {
    await run(["schemas/*.ts"], { outFile: "types/all.ts", suffix: "Schema" });

    const generated = readFileSync(join(workDir, "types/all.ts"), "utf-8");
    expect(generated).toContain("export type UserInput = {");
    expect(generated).toContain("export type DateInput = {");
  });

  it("emits a single type per schema with mergeSame", async () => {
    const output = await run(["schemas/basic-schema.ts"], { suffix: "Schema", mergeSame: true });
    expect(output).toContain("export type User = {");
    expect(output).toContain("export type UserInput = User;");
  });

  it("emits only the requested direction", async () => {
    expect(await run(["schemas/transform-schema.ts"], { inputOnly: true })).not.toContain("Output");
    expect(await run(["schemas/transform-schema.ts"], { outputOnly: true })).not.toContain(
      "Input =",
    );
  });

  it("extracts only the requested schemas", async () => {
    const output = await run(["schemas/described-schema.ts"], {
      schemas: "AddressSchema",
      suffix: "Schema",
    });
    expect(output).toContain("export type AddressInput = {");
    expect(output).not.toContain("export type ProfileInput");
  });

  it("adds TSDoc comments with --with-descriptions", async () => {
    const output = await run(["schemas/described-schema.ts"], {
      withDescriptions: true,
      suffix: "Schema",
    });
    expect(output).toContain("/** Unique user identifier */");
    expect(output).toContain(" * User account information");
  });

  it("previews without writing anything in dry-run mode", async () => {
    const output = await run(["schemas/basic-schema.ts"], { outDir: "types", dryRun: true });
    expect(output).toContain("Would write to:");
    expect(existsSync(join(workDir, "types"))).toBe(false);
  });

  it("generates type tests alongside the type files", async () => {
    await run(["schemas/basic-schema.ts"], {
      outDir: "types",
      suffix: "Schema",
      generateTests: true,
    });

    const testFile = readFileSync(join(workDir, "types/basic-schema.types.test.ts"), "utf-8");
    expect(testFile).toContain('import type * as v from "valibot";');
    expect(testFile).toContain("v.InferInput<typeof BasicSchemaUserSchema>");
    expect(testFile).toContain('from "../schemas/basic-schema"');
  });

  it("generates one test file next to a single outFile", async () => {
    await run(["schemas/*.ts"], {
      outFile: "types/all.ts",
      suffix: "Schema",
      generateTests: true,
    });

    const testFile = readFileSync(join(workDir, "types/all.test.ts"), "utf-8");
    expect(testFile).toContain('describe("basic-schema", () => {');
    expect(testFile).toContain('describe("transform-schema", () => {');
  });

  describe("recursive schemas across output files", () => {
    /**
     * Copies the cross-file recursive fixtures into the work directory, each in
     * its own subdirectory so the generated names come from `[dir]`.
     */
    function copyCrossFileFixtures() {
      const source = join(fixturesDir, "cross-file-recursive");
      mkdirSync(join(workDir, "schemas/node"), { recursive: true });
      mkdirSync(join(workDir, "schemas/tree"), { recursive: true });
      cpSync(join(source, "node-schema.ts"), join(workDir, "schemas/node/schema.ts"));
      writeFileSync(
        join(workDir, "schemas/tree/schema.ts"),
        readFileSync(join(source, "tree-schema.ts"), "utf-8").replace(
          './node-schema"',
          '../node/schema"',
        ),
      );
    }

    it("imports a recursive schema from the file that generates it", async () => {
      copyCrossFileFixtures();
      await run(["schemas/**/schema.ts"], {
        outDir: "types",
        outPattern: "[dir].generated[ext]",
        suffix: "Schema",
        outputSuffix: "",
        mergeSame: true,
        withDescriptions: true,
      });

      const node = readFileSync(join(workDir, "types/node.generated.ts"), "utf-8");
      // The recursion points straight at the type, with no inlined copy in
      // between - and every level keeps its description.
      expect(node).toContain(
        [
          "export type CrossFileNode = {",
          "  /** The node name */",
          "  name: string;",
          "  children: {",
          "    [x: string]: CrossFileNode;",
          "  };",
          "};",
        ].join("\n"),
      );
      expect(node).toContain("export type CrossFileNodeInput = CrossFileNode;");

      const tree = readFileSync(join(workDir, "types/tree.generated.ts"), "utf-8");
      expect(tree).toContain('import type { CrossFileNode } from "./node.generated";');
      expect(tree).toContain(
        [
          "export type CrossFileTree = {",
          "  /** Root node */",
          "  root: CrossFileNode;",
          "  index: {",
          "    [x: string]: CrossFileNode;",
          "  };",
          "  /** Through a non-generated schema */",
          "  group: {",
          "    members: CrossFileNode[];",
          "  };",
          "};",
        ].join("\n"),
      );
      expect(tree).not.toMatch(/\bany\b/);
    });

    it("declares both directions when a recursive schema's input and output differ", async () => {
      copyCrossFileFixtures();
      await run(["schemas/**/schema.ts"], {
        outDir: "types",
        outPattern: "[dir].generated[ext]",
        suffix: "Schema",
      });

      const tree = readFileSync(join(workDir, "types/tree.generated.ts"), "utf-8");
      expect(tree).toContain(
        'import type { CrossFileNodeInput, CrossFileNodeOutput } from "./node.generated";',
      );
      expect(tree).toContain("root: CrossFileNodeInput;");
      expect(tree).toContain("root: CrossFileNodeOutput;");
    });

    it("keeps a single output file self-contained, with no import to itself", async () => {
      copyCrossFileFixtures();
      await run(["schemas/**/schema.ts"], { outFile: "types/all.ts", suffix: "Schema" });

      const generated = readFileSync(join(workDir, "types/all.ts"), "utf-8");
      expect(generated).not.toContain("import type {");
      expect(generated).toContain("export type CrossFileNodeInput = {");
      expect(generated).toContain("root: CrossFileNodeInput;");
    });

    it("still declares a schema another file imports when mergeSame collapses it", async () => {
      copyCrossFileFixtures();
      await run(["schemas/**/schema.ts"], {
        outFile: "types/all.ts",
        suffix: "Schema",
        outputSuffix: "",
        mergeSame: true,
      });

      const generated = readFileSync(join(workDir, "types/all.ts"), "utf-8");
      // The schema appears twice in the results - once declared here, once as
      // the copy the importing file carries - and the declaration must survive.
      expect(generated).toContain("export type CrossFileNode = {");
      expect(generated).toContain("export type CrossFileNodeInput = CrossFileNode;");
      expect(generated).toContain("root: CrossFileNode;");
    });

    it("bridges an aliased import to the name the declaring file actually exports", async () => {
      const source = join(fixturesDir, "cross-file-recursive");
      mkdirSync(join(workDir, "schemas/node"), { recursive: true });
      mkdirSync(join(workDir, "schemas/tree"), { recursive: true });
      cpSync(join(source, "node-schema.ts"), join(workDir, "schemas/node/schema.ts"));
      writeFileSync(
        join(workDir, "schemas/tree/schema.ts"),
        [
          'import * as v from "valibot";',
          'import { CrossFileNodeSchema as AliasedNode } from "../node/schema";',
          "",
          "export const CrossFileTreeSchema = v.object({",
          "  root: AliasedNode,",
          "});",
        ].join("\n"),
      );

      await run(["schemas/**/schema.ts"], {
        outDir: "types",
        outPattern: "[dir].generated[ext]",
        suffix: "Schema",
        outputSuffix: "",
        mergeSame: true,
      });

      const node = readFileSync(join(workDir, "types/node.generated.ts"), "utf-8");
      const tree = readFileSync(join(workDir, "types/tree.generated.ts"), "utf-8");
      // The declaring file exports "CrossFileNode" (its own name), not the
      // "AliasedNode" the importing file uses locally - the import has to
      // bridge the two, or the alias name would not exist in that module.
      expect(node).toContain("export type CrossFileNode = {");
      expect(tree).toContain(
        'import type { CrossFileNode as AliasedNode } from "./node.generated";',
      );
      expect(tree).toContain("root: AliasedNode;");
    });

    it("imports a $-prefixed recursive schema from the file that generates it", async () => {
      // `\b` treats `$` as a non-word character, so a schema named with a `$`
      // prefix used to make crossFileImportLines' own name-detection regex
      // never match, silently dropping the import this test checks for.
      mkdirSync(join(workDir, "schemas/node"), { recursive: true });
      mkdirSync(join(workDir, "schemas/tree"), { recursive: true });
      writeFileSync(
        join(workDir, "schemas/node/schema.ts"),
        [
          'import * as v from "valibot";',
          "",
          "export const $CrossFileNodeSchema = v.object({",
          "  name: v.string(),",
          "  get children(): v.GenericSchema<Record<string, unknown>> {",
          "    return v.record(v.string(), $CrossFileNodeSchema);",
          "  },",
          "});",
        ].join("\n"),
      );
      writeFileSync(
        join(workDir, "schemas/tree/schema.ts"),
        [
          'import * as v from "valibot";',
          'import { $CrossFileNodeSchema } from "../node/schema";',
          "",
          "export const CrossFileTreeSchema = v.object({",
          "  root: $CrossFileNodeSchema,",
          "});",
        ].join("\n"),
      );

      await run(["schemas/**/schema.ts"], {
        outDir: "types",
        outPattern: "[dir].generated[ext]",
        suffix: "Schema",
        outputSuffix: "",
        mergeSame: true,
      });

      const node = readFileSync(join(workDir, "types/node.generated.ts"), "utf-8");
      const tree = readFileSync(join(workDir, "types/tree.generated.ts"), "utf-8");
      expect(node).toContain("export type $CrossFileNode = {");
      expect(tree).toContain('import type { $CrossFileNode } from "./node.generated";');
      expect(tree).toContain("root: $CrossFileNode;");
    });

    it("emits no import line for a cross-file schema that is imported but never referenced", async () => {
      // Every import declaration is picked up regardless of whether anything
      // in the file actually uses it, so an unused one still lands in this
      // file's own results with importedFrom set - and its name never shows
      // up in the declarations, leaving nothing to import.
      mkdirSync(join(workDir, "schemas/node"), { recursive: true });
      mkdirSync(join(workDir, "schemas/tree"), { recursive: true });
      cpSync(
        join(fixturesDir, "cross-file-recursive/node-schema.ts"),
        join(workDir, "schemas/node/schema.ts"),
      );
      writeFileSync(
        join(workDir, "schemas/tree/schema.ts"),
        [
          'import * as v from "valibot";',
          'import { CrossFileNodeSchema } from "../node/schema";',
          "",
          "export const CrossFileTreeSchema = v.object({",
          "  label: v.string(),",
          "});",
        ].join("\n"),
      );

      await run(["schemas/**/schema.ts"], {
        outDir: "types",
        outPattern: "[dir].generated[ext]",
        suffix: "Schema",
      });

      const tree = readFileSync(join(workDir, "types/tree.generated.ts"), "utf-8");
      expect(tree).not.toContain("import type");
    });
  });

  it("rewrites an annotation's import() specifier to reach from the output file", async () => {
    cpSync(
      join(fixturesDir, "annotated-inline-types.ts"),
      join(workDir, "schemas/annotated-inline-types.ts"),
    );
    cpSync(
      join(fixturesDir, "annotated-inline-schema.ts"),
      join(workDir, "schemas/annotated-inline-schema.ts"),
    );

    await run(["schemas/annotated-inline-schema.ts"], { outDir: "types", suffix: "Schema" });

    const generated = readFileSync(
      join(workDir, "types/annotated-inline-schema.types.ts"),
      "utf-8",
    );
    // Written as "./annotated-inline-types" in the schema file, which resolves
    // to nothing from types/.
    expect(generated).toContain('import("../schemas/annotated-inline-types").AnnotatedMeta');
    expect(generated).not.toContain('import("./annotated-inline-types")');
    expect(generated).not.toMatch(/(?:boolean|string) \| undefined \| undefined/);
  });

  it("reads options from vinfer.config.mjs", async () => {
    writeFileSync(
      join(workDir, "vinfer.config.mjs"),
      'export default { include: ["schemas/basic-schema.ts"], suffix: "Schema", outDir: "types" };',
    );

    await run([]);
    expect(readFileSync(join(workDir, "types/basic-schema.types.ts"), "utf-8")).toContain(
      "export type UserInput = {",
    );
  });

  it("lets CLI options override the config file", async () => {
    writeFileSync(
      join(workDir, "vinfer.config.mjs"),
      'export default { include: ["schemas/basic-schema.ts"], suffix: "Schema" };',
    );

    const output = await run([], { suffix: "NotThere" });
    expect(output).toContain("export type UserSchemaInput = {");
  });

  it("reads options from an explicit --config path", async () => {
    writeFileSync(
      join(workDir, "custom.config.mjs"),
      'export default { include: ["schemas/basic-schema.ts"], suffix: "Schema" };',
    );

    const output = await run([], { config: "custom.config.mjs" });
    expect(output).toContain("export type UserInput = {");
  });

  it("reads options from the package.json vinfer field", async () => {
    writeFileSync(
      join(workDir, "package.json"),
      JSON.stringify({ vinfer: { include: ["schemas/basic-schema.ts"], suffix: "Schema" } }),
    );

    expect(await run([])).toContain("export type UserInput = {");
  });

  it("rebases import() paths when outDir is an absolute path through a symlinked directory", async () => {
    const realBase = mkdtempSync(join(tmpdir(), "vinfer-real-"));
    const linkPath = mkdtempSync(join(tmpdir(), "vinfer-link-"));
    rmSync(linkPath, { recursive: true, force: true });
    symlinkSync(realBase, linkPath, "junction");

    try {
      symlinkSync(join(repoRoot, "node_modules"), join(realBase, "node_modules"), "junction");
      mkdirSync(join(realBase, "src/shared"), { recursive: true });
      mkdirSync(join(realBase, "src/schemas"), { recursive: true });
      writeFileSync(join(realBase, "src/shared/kind.ts"), 'export type Kind = "a" | "b" | "c";\n');
      writeFileSync(
        join(realBase, "src/shared/model.ts"),
        'import type { Kind } from "./kind";\n\nexport type Model = { kind: Kind; name: string };\n',
      );
      writeFileSync(
        join(realBase, "src/schemas/schema.ts"),
        'import * as v from "valibot";\n' +
          'import type { Model } from "../shared/model";\n\n' +
          "export const ModelSchema: v.GenericSchema<Model> = v.object({\n" +
          '  kind: v.picklist(["a", "b", "c"]),\n' +
          "  name: v.string(),\n" +
          "});\n",
      );
      process.chdir(linkPath);

      // outDir is given as an absolute path built from the symlink entry
      // point, not derived from process.cwd() (which Node always reports
      // fully resolved) - this is what a caller does when it stores a
      // directory path before any chdir happens.
      await runCLI(["src/schemas/schema.ts"], {
        outDir: join(linkPath, "out"),
        suffix: "Schema",
      });

      const output = readFileSync(join(realBase, "out/schema.types.ts"), "utf-8");
      expect(output).toContain('import("../src/shared/kind").Kind');
    } finally {
      process.chdir(originalCwd);
      rmSync(linkPath, { recursive: true, force: true });
      rmSync(realBase, { recursive: true, force: true });
    }
  });

  describe("failures", () => {
    it("rejects when no files are given", async () => {
      await expect(run([])).rejects.toThrow(/No files matched/);
    });

    it("rejects when a pattern matches nothing", async () => {
      await expect(run(["schemas/nope-*.ts"])).rejects.toThrow(/No files matched/);
    });

    it("rejects when no schema is found in the matched files", async () => {
      writeFileSync(join(workDir, "schemas/empty.ts"), "export const notASchema = 1;\n");
      await expect(run(["schemas/empty.ts"])).rejects.toThrow(/No Valibot schemas found/);
    });

    it("rejects when the requested schemas do not exist", async () => {
      await expect(run(["schemas/basic-schema.ts"], { schemas: "MissingSchema" })).rejects.toThrow(
        /Requested schemas not found/,
      );
    });

    it("rejects --input-only together with --output-only", async () => {
      await expect(
        run(["schemas/basic-schema.ts"], { inputOnly: true, outputOnly: true }),
      ).rejects.toThrow(/Cannot use both options together/);
    });

    it("rejects --outFile together with --outDir", async () => {
      await expect(
        run(["schemas/basic-schema.ts"], { outFile: "all.ts", outDir: "types" }),
      ).rejects.toThrow(/Cannot use with --outDir/);
    });

    it("rejects an empty --suffix", async () => {
      await expect(run(["schemas/basic-schema.ts"], { suffix: "" })).rejects.toThrow(
        /Empty suffix is not allowed/,
      );
    });

    it("rejects --generate-tests without a file output", async () => {
      await expect(run(["schemas/basic-schema.ts"], { generateTests: true })).rejects.toThrow(
        /--generate-tests requires --outDir or --outFile/,
      );
    });

    it("rejects an invalid schema name", async () => {
      await expect(
        run(["schemas/basic-schema.ts"], { schemas: "not-an-identifier" }),
      ).rejects.toThrow(/must be valid TypeScript identifiers/);
    });

    it.each([
      ["UserSchema", /Expected "SchemaName:TypeName"/],
      ["UserSchema:", /Both schema name and type name are required/],
      ["not-an-identifier:User", /Must be a valid TypeScript identifier/],
      ["UserSchema:not-an-identifier", /Must be a valid TypeScript identifier/],
    ])("rejects the invalid mapping %s", async (mapping, expected) => {
      await expect(run(["schemas/basic-schema.ts"], { map: mapping })).rejects.toThrow(expected);
    });
  });
});
