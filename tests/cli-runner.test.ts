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
  symlinkSync(join(repoRoot, "node_modules"), join(workDir, "node_modules"), "dir");
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
