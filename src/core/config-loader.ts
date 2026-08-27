import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { basename, resolve } from "pathe";
import { pathToFileURL } from "url";

/**
 * Configuration options that can be specified in config file.
 */
export interface VinferConfig {
  /** File paths or glob patterns to process */
  include?: string[];
  /** Glob patterns to exclude */
  exclude?: string[];
  /** Path to tsconfig.json */
  project?: string;
  /** Schema names to extract (if not specified, all are extracted) */
  schemas?: string[];
  /** Output only input types */
  inputOnly?: boolean;
  /** Output only output types */
  outputOnly?: boolean;
  /** Single type if input===output */
  mergeSame?: boolean;
  /** Remove suffix from schema names */
  suffix?: string;
  /** Suffix for input type names */
  inputSuffix?: string;
  /** Suffix for output type names */
  outputSuffix?: string;
  /** Custom name mappings */
  map?: Record<string, string>;
  /** Output directory */
  outDir?: string;
  /** Single output file */
  outFile?: string;
  /** Output file naming pattern */
  outPattern?: string;
  /** Generate .d.ts files */
  declaration?: boolean;
  /** Include `v.description()` as TSDoc comments */
  withDescriptions?: boolean;
  /** Generate vitest type equality tests alongside type files */
  generateTests?: boolean;
  /**
   * Replace the `import("...")` reference an explicit `v.GenericSchema<T>`
   * annotation's `T` synthesizes for a plain type declared in another file
   * with that type's own structure, instead of leaving the generated
   * output pointing back at it.
   */
  inlineExternalTypes?: boolean;
}

/**
 * Result of loading config.
 */
export interface ConfigLoadResult {
  /** The loaded configuration */
  config: VinferConfig;
  /** Path to the config file (if found) */
  configPath?: string;
}

/**
 * Config file names to search for, in order of priority.
 */
const CONFIG_FILES = [
  "vinfer.config.ts",
  "vinfer.config.mts",
  "vinfer.config.js",
  "vinfer.config.mjs",
];

/**
 * Loads vinfer configuration from config file or package.json.
 */
export class ConfigLoader {
  /**
   * Loads configuration from the specified directory.
   *
   * @param cwd - Directory to search for config files
   * @returns Configuration and config file path
   */
  async load(cwd: string): Promise<ConfigLoadResult> {
    // Try config files first
    for (const configFile of CONFIG_FILES) {
      const configPath = resolve(cwd, configFile);
      if (existsSync(configPath)) {
        const config = await this.loadConfigFile(configPath);
        return { config, configPath };
      }
    }

    // Try package.json
    const packageJsonPath = resolve(cwd, "package.json");
    if (existsSync(packageJsonPath)) {
      const config = await this.loadFromPackageJson(packageJsonPath);
      if (config) {
        return { config, configPath: packageJsonPath };
      }
    }

    // No config found, return empty config
    return { config: {} };
  }

  /**
   * Loads configuration from an explicitly requested config file.
   *
   * @param configPath - Path to the config file (`.ts`, `.js`, or a package.json)
   * @throws Error if the file does not exist
   */
  async loadFrom(configPath: string): Promise<ConfigLoadResult> {
    const resolvedPath = resolve(configPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Config file not found: ${resolvedPath}`);
    }

    if (basename(resolvedPath) === "package.json") {
      const config = await this.loadFromPackageJson(resolvedPath);
      return { config: config ?? {}, configPath: resolvedPath };
    }

    return { config: await this.loadConfigFile(resolvedPath), configPath: resolvedPath };
  }

  /**
   * Loads configuration from a TypeScript/JavaScript config file.
   */
  private async loadConfigFile(configPath: string): Promise<VinferConfig> {
    try {
      const fileUrl = pathToFileURL(configPath).href;
      const module = await import(fileUrl);
      return module.default || module;
    } catch (error) {
      console.warn(`Warning: Failed to load config from ${configPath}:`, (error as Error).message);
      return {};
    }
  }

  /**
   * Loads configuration from package.json's "vinfer" field.
   */
  private async loadFromPackageJson(packageJsonPath: string): Promise<VinferConfig | null> {
    let content: string;
    try {
      content = await readFile(packageJsonPath, "utf-8");
    } catch {
      // File read error (permissions, not found, etc.) - silently return null
      // since package.json config is optional
      return null;
    }

    try {
      const packageJson = JSON.parse(content);

      if (packageJson.vinfer && typeof packageJson.vinfer === "object") {
        return packageJson.vinfer as VinferConfig;
      }

      return null;
    } catch (error) {
      // JSON parse error - warn the user since this is likely a syntax error
      console.warn(`Warning: Failed to parse ${packageJsonPath}: ${(error as Error).message}`);
      return null;
    }
  }
}

/**
 * Defines a vinfer configuration with type checking.
 * Use this in vinfer.config.ts for type safety.
 *
 * @example
 * ```typescript
 * // vinfer.config.ts
 * import { defineConfig } from 'vinfer';
 *
 * export default defineConfig({
 *   include: ['src/** /*.schema.ts'],
 *   outDir: './types',
 *   mergeSame: true,
 *   suffix: 'Schema',
 * });
 * ```
 */
export function defineConfig(config: VinferConfig): VinferConfig {
  return config;
}
