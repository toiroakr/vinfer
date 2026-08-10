import { glob } from "glob";
import { resolve, dirname, basename, extname, join } from "pathe";
import type { OutputOptions } from "./types.js";

/**
 * Resolves file paths from glob patterns and generates output paths.
 */
export class FileResolver {
  /**
   * Resolves input file paths from a glob pattern or array of patterns.
   *
   * @param pattern - Glob pattern(s) to match
   * @param cwd - Current working directory (default: process.cwd())
   * @param exclude - Glob pattern(s) to exclude
   * @returns Array of absolute file paths
   */
  async resolveInputFiles(
    pattern: string | string[],
    cwd: string = process.cwd(),
    exclude?: string[],
  ): Promise<string[]> {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    const allFiles: string[] = [];

    for (const p of patterns) {
      const files = await glob(p, {
        cwd,
        absolute: true,
        nodir: true,
        ignore: exclude,
      });
      allFiles.push(...files);
    }

    // Remove duplicates and sort
    return [...new Set(allFiles)].sort();
  }

  /**
   * Resolves the output path for a given input file.
   *
   * @param inputPath - Absolute path to the input file
   * @param options - Output options
   * @param cwd - Current working directory
   * @returns Absolute path to the output file
   */
  resolveOutputPath(
    inputPath: string,
    options: OutputOptions,
    cwd: string = process.cwd(),
  ): string {
    // If outFile is specified, use it directly
    if (options.outFile) {
      return resolve(cwd, options.outFile);
    }

    // Determine base name, extension, and parent directory name
    const inputBasename = basename(inputPath);
    const inputExt = extname(inputPath);
    const inputName = inputBasename.slice(0, -inputExt.length);
    const inputDir = basename(dirname(inputPath));

    // Apply output pattern
    let outputName: string;
    if (options.outPattern) {
      outputName = this.applyPattern(options.outPattern, {
        name: inputName,
        dir: inputDir,
        ext: options.declaration ? ".d.ts" : ".ts",
      });
    } else {
      // Default pattern: [name].types.ts or [name].types.d.ts
      const ext = options.declaration ? ".d.ts" : ".ts";
      outputName = `${inputName}.types${ext}`;
    }

    // Determine output directory
    let outputDir: string;
    if (options.outDir) {
      outputDir = resolve(cwd, options.outDir);
    } else {
      // Same directory as input
      outputDir = dirname(inputPath);
    }

    return join(outputDir, outputName);
  }

  /**
   * Applies a pattern template to generate an output filename.
   *
   * Supported placeholders:
   * - [name]: Input filename without extension
   * - [dir]: Parent directory name of the input file
   * - [ext]: Output extension (including dot)
   *
   * @param pattern - Pattern template (e.g., "[name].types[ext]")
   * @param vars - Variables to substitute
   * @returns Generated filename
   */
  applyPattern(pattern: string, vars: { name: string; dir?: string; ext: string }): string {
    // Escape $ in replacement strings to prevent regex special character interpretation
    // In String.replace(), $& means the matched substring, $1 means first capture group, etc.
    const escapedName = vars.name.replace(/\$/g, "$$$$");
    const escapedDir = (vars.dir ?? vars.name).replace(/\$/g, "$$$$");
    const escapedExt = vars.ext.replace(/\$/g, "$$$$");
    return pattern
      .replace(/\[name\]/g, escapedName)
      .replace(/\[dir\]/g, escapedDir)
      .replace(/\[ext\]/g, escapedExt);
  }
}
