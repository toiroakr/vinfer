#!/usr/bin/env node
import { Command } from "commander";
import { resolve, dirname } from "pathe";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { formatError } from "./core/index.js";
import { runCLI, type CLIOptions } from "./cli-runner.js";

const program = new Command();

program
  .name("vinfer")
  .description("Extract input/output types from Valibot schemas")
  .version(readPackageVersion());

program
  .argument("[files...]", "File paths or glob patterns")
  .option("-c, --config <path>", "Path to config file")
  .option("-p, --project <path>", "Path to tsconfig.json")
  .option("--schemas <names>", "Comma-separated schema names to extract")
  .option("--input-only", "Output only input types")
  .option("--output-only", "Output only output types")
  .option("--merge-same", "Single type if input===output")
  .option("--suffix <suffix>", "Remove suffix from schema names (e.g., 'Schema')")
  .option("--input-suffix <suffix>", "Suffix for input type names (default: 'Input')")
  .option("--output-suffix <suffix>", "Suffix for output type names (default: 'Output')")
  .option("--map <mappings>", "Custom name mappings (e.g., 'UserSchema:User')")
  .option("--outDir <dir>", "Output directory for generated files")
  .option("--outFile <file>", "Single output file for all types")
  .option("--outPattern <pattern>", "Output file naming pattern (e.g., '[name].types.ts')")
  .option("-d, --declaration", "Generate .d.ts files")
  .option("--dry-run", "Preview without writing files")
  .option("--with-descriptions", "Include v.description() as TSDoc comments")
  .option("--generate-tests", "Generate vitest type equality tests alongside type files")
  .option(
    "--inline-external-types",
    "Inline a plain type that an explicit v.GenericSchema<T> annotation reaches in another file, instead of referencing it",
  )
  .option("-v, --verbose", "Enable verbose output")
  .action(async (files: string[], options: CLIOptions) => {
    try {
      await runCLI(files, options);
    } catch (error) {
      console.error(formatError(error));
      process.exit(1);
    }
  });

program.parse();

/**
 * Reads vinfer's own version from its package.json.
 *
 * The path is the same whether this file runs from `src` or from `dist`, since
 * both sit one directory below the package root.
 */
function readPackageVersion(): string {
  try {
    const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return JSON.parse(readFileSync(packageJsonPath, "utf-8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
