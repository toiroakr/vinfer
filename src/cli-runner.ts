/**
 * The CLI's behavior, separated from its commander wiring so it can be driven
 * directly - from tests, or from another tool embedding vinfer.
 */
import { resolve, dirname, basename, relative, parse as parsePath } from "pathe";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import {
  ValibotTypeExtractor,
  generateDeclarationFile,
  relativizeImportPaths,
  NameMapper,
  FileResolver,
  DescriptionExtractor,
  ConfigLoader,
  NoFilesMatchedError,
  NoSchemasFoundError,
  InvalidOptionError,
  generateTypeTests,
  generateImportPrefix,
  setVerbose,
  logVerbose,
  logProgress,
  type ExtractContext,
  type ExtractResult,
  type NameMappingOptions,
  type OutputOptions,
  type DeclarationOptions,
  type VinferConfig,
  type TestFileInfo,
  type TestSchemaInfo,
} from "./core/index.js";

/**
 * Options accepted by the CLI, after commander has parsed them.
 */
export interface CLIOptions {
  project?: string;
  schemas?: string;
  inputOnly?: boolean;
  outputOnly?: boolean;
  mergeSame?: boolean;
  suffix?: string;
  inputSuffix?: string;
  outputSuffix?: string;
  map?: string;
  outDir?: string;
  outFile?: string;
  outPattern?: string;
  declaration?: boolean;
  dryRun?: boolean;
  withDescriptions?: boolean;
  config?: string;
  generateTests?: boolean;
  verbose?: boolean;
  inlineExternalTypes?: boolean;
}

/**
 * Main CLI execution logic.
 */
export async function runCLI(files: string[], options: CLIOptions): Promise<void> {
  const cwd = process.cwd();

  // Enable verbose mode if requested
  if (options.verbose) {
    setVerbose(true);
    logVerbose("Verbose mode enabled");
  }

  // Load config file
  logVerbose("Loading configuration...");
  const configLoader = new ConfigLoader();
  const { config: fileConfig, configPath } = options.config
    ? await configLoader.loadFrom(options.config)
    : await configLoader.load(cwd);
  logVerbose(`Using config: ${configPath ?? "(none)"}`);

  // Merge CLI options with config file (CLI takes precedence)
  const config = mergeCliWithConfig(options, fileConfig);

  // Validate options
  validateOptions(config);
  logVerbose("Configuration validated");

  // Use files from CLI args, or from config, or fail
  const inputFiles = files.length > 0 ? files : config.include || [];

  if (inputFiles.length === 0) {
    throw new NoFilesMatchedError(["(no files specified)"]);
  }

  // Resolve file paths (support glob patterns)
  logVerbose("Resolving input files...");
  const fileResolver = new FileResolver();
  const resolvedFiles = await fileResolver.resolveInputFiles(inputFiles, cwd, config.exclude);

  if (resolvedFiles.length === 0) {
    throw new NoFilesMatchedError(inputFiles);
  }
  logVerbose(`Found ${resolvedFiles.length} file(s) to process`);

  // Find tsconfig
  const tsconfigPath = config.project ? resolve(cwd, config.project) : findTsConfig(cwd);
  logVerbose(`Using tsconfig: ${tsconfigPath || "(none)"}`);

  // Validate --generate-tests requires file output
  if (config.generateTests && !config.outDir && !config.outFile) {
    throw new Error("--generate-tests requires --outDir or --outFile");
  }

  // Create extractor and name mapper
  const extractor = new ValibotTypeExtractor(tsconfigPath);
  const nameMapper = createNameMapper(config);
  const descriptionExtractor = config.withDescriptions
    ? new DescriptionExtractor({ tsconfigPath: tsconfigPath })
    : null;

  // Parse schema names if specified
  const schemaFilter = config.schemas;

  // Output options
  const outputOptions: OutputOptions = {
    outDir: config.outDir,
    outFile: config.outFile,
    outPattern: config.outPattern,
    declaration: config.declaration,
  };

  // Declaration options
  const declOptions: DeclarationOptions = {
    inputOnly: config.inputOnly,
    outputOnly: config.outputOnly,
    mergeSame: config.mergeSame,
  };

  // Types are only referenced across files when every matched file actually
  // gets written out: without a file output there is nowhere to import from,
  // and a schema filter may drop the very declaration a reference points at.
  const writesFiles = Boolean(config.outDir || config.outFile || config.outPattern);
  const extractContext: ExtractContext = {
    inlineExternalTypes: config.inlineExternalTypes,
    ...(writesFiles && !schemaFilter ? { importableFiles: new Set(resolvedFiles) } : {}),
  };

  // Single output file mode
  if (config.outFile) {
    logVerbose("Processing files for single output...");
    const allResults: ExtractResult[] = [];
    const fileResultsMap: Map<string, ExtractResult[]> = new Map();

    for (let i = 0; i < resolvedFiles.length; i++) {
      const filePath = resolvedFiles[i];
      logProgress(i + 1, resolvedFiles.length, `Processing ${basename(filePath)}`);
      let results = getFilteredResults(extractor, filePath, schemaFilter, extractContext);

      // Add descriptions if enabled
      if (descriptionExtractor) {
        results = await addDescriptionsToResults(descriptionExtractor, filePath, results);
      }

      if (results.length > 0) {
        allResults.push(...results);
        fileResultsMap.set(filePath, results);
      }
    }

    if (allResults.length === 0) {
      throw new NoSchemasFoundError(resolvedFiles, schemaFilter);
    }

    let content = generateDeclarationFile(allResults, nameMapper.createMapFunction(), declOptions);

    const outputPath = resolve(cwd, config.outFile);
    content = relativizeImportPaths(content, outputPath);

    if (options.dryRun) {
      console.log(`Would write to: ${outputPath}`);
      console.log("---");
      console.log(content);
    } else {
      ensureDir(dirname(outputPath));
      writeFile(outputPath, content);
      console.log(`Generated: ${outputPath} (${allResults.length} types)`);
    }

    // Generate test file if requested
    if (config.generateTests) {
      const testPath = outputPath.replace(/\.ts$/, ".test.ts");
      const testContent = generateTestFileForSingleOutput(
        fileResultsMap,
        outputPath,
        testPath,
        nameMapper,
      );

      if (options.dryRun) {
        console.log(`Would write to: ${testPath}`);
        console.log("---");
        console.log(testContent);
      } else {
        writeFile(testPath, testContent);
        console.log(`Generated: ${testPath} (${allResults.length * 2} test cases)`);
      }
    }

    return;
  }

  // Per-file output mode or console output
  logVerbose("Processing files...");
  let totalResults = 0;

  for (let i = 0; i < resolvedFiles.length; i++) {
    const filePath = resolvedFiles[i];
    logProgress(i + 1, resolvedFiles.length, `Processing ${basename(filePath)}`);
    let results = getFilteredResults(extractor, filePath, schemaFilter, extractContext);

    if (results.length === 0) {
      logVerbose(`  No schemas found in ${basename(filePath)}`);
      continue;
    }

    totalResults += results.length;

    // Add descriptions if enabled
    if (descriptionExtractor) {
      results = await addDescriptionsToResults(descriptionExtractor, filePath, results);
    }

    // File output mode
    if (config.outDir || config.outPattern) {
      const outputPath = fileResolver.resolveOutputPath(filePath, outputOptions, cwd);
      const importSources = buildImportSources(
        results,
        outputPath,
        outputOptions,
        cwd,
        fileResolver,
      );

      let content = generateDeclarationFile(results, nameMapper.createMapFunction(), {
        ...declOptions,
        importSources,
      });
      content = relativizeImportPaths(content, outputPath);

      if (options.dryRun) {
        console.log(`Would write to: ${outputPath}`);
        console.log("---");
        console.log(content);
        console.log("");
      } else {
        ensureDir(dirname(outputPath));
        writeFile(outputPath, content);
        console.log(`Generated: ${outputPath} (${results.length} types)`);
      }

      // Generate test file if requested
      if (config.generateTests) {
        const testPath = outputPath.replace(/\.ts$/, ".test.ts");
        const testContent = generateTestFileForPerFile(
          filePath,
          outputPath,
          testPath,
          results,
          nameMapper,
        );

        if (options.dryRun) {
          console.log(`Would write to: ${testPath}`);
          console.log("---");
          console.log(testContent);
          console.log("");
        } else {
          writeFile(testPath, testContent);
          console.log(`Generated: ${testPath} (${results.length * 2} test cases)`);
        }
      }
    } else {
      // Console output mode
      if (resolvedFiles.length > 1) {
        console.log(`// File: ${filePath}`);
      }

      const content = generateDeclarationFile(results, nameMapper.createMapFunction(), declOptions);
      console.log(content);
    }
  }

  // Error if no schemas were found
  if (totalResults === 0) {
    throw new NoSchemasFoundError(resolvedFiles, schemaFilter);
  }
}

/**
 * Adds descriptions from Valibot schemas to extraction results.
 */
async function addDescriptionsToResults(
  descriptionExtractor: DescriptionExtractor,
  filePath: string,
  results: ExtractResult[],
): Promise<ExtractResult[]> {
  const schemaNames = results.map((r) => r.schemaName);
  const descriptions = await descriptionExtractor.extractDescriptions(filePath, schemaNames);

  return results.map((result) => {
    const desc = descriptions.get(result.schemaName);
    if (!desc) {
      return result;
    }

    return {
      ...result,
      description: desc.description,
      fieldDescriptions: desc.fields,
    };
  });
}

/**
 * Gets extraction results, filtering by schema names if specified.
 * Only extracts schemas that actually exist in the file.
 */
function getFilteredResults(
  extractor: ValibotTypeExtractor,
  filePath: string,
  schemaFilter?: string[],
  context: ExtractContext = {},
): ExtractResult[] {
  if (!schemaFilter) {
    return extractor.extractAll(filePath, context);
  }

  const existingSchemas = extractor.getSchemaNames(filePath);
  const schemasToExtract = schemaFilter.filter((name) => existingSchemas.includes(name));

  if (schemasToExtract.length === 0) {
    return [];
  }

  return extractor.extractMultiple(filePath, schemasToExtract, context);
}

/**
 * Resolves where each cross-file type reference has to be imported from.
 *
 * A schema whose declaring file lands in the very file being written needs no
 * import, so it is left out; everything else is addressed by the path from this
 * output file to the one that declares it, extension dropped.
 *
 * @returns Map of schema name to module specifier
 */
function buildImportSources(
  results: ExtractResult[],
  outputPath: string,
  outputOptions: OutputOptions,
  cwd: string,
  fileResolver: FileResolver,
): Map<string, string> {
  const importSources = new Map<string, string>();

  for (const result of results) {
    if (!result.importedFrom) continue;

    const declaringOutputPath = fileResolver.resolveOutputPath(
      result.importedFrom,
      outputOptions,
      cwd,
    );
    if (declaringOutputPath === outputPath) continue;

    const withoutExtension = declaringOutputPath.replace(/\.d\.ts$|\.ts$/, "");
    let specifier = relative(dirname(outputPath), withoutExtension);
    if (!specifier.startsWith(".")) {
      specifier = `./${specifier}`;
    }

    importSources.set(result.schemaName, specifier);
  }

  return importSources;
}

/**
 * Merges CLI options with config file options.
 * CLI options take precedence.
 */
function mergeCliWithConfig(cliOptions: CLIOptions, fileConfig: VinferConfig): VinferConfig {
  const merged: VinferConfig = { ...fileConfig };

  // Merge CLI options (only non-undefined values)
  if (cliOptions.project !== undefined) merged.project = cliOptions.project;
  if (cliOptions.schemas !== undefined) {
    merged.schemas = parseSchemaNames(cliOptions.schemas);
  }
  if (cliOptions.inputOnly !== undefined) merged.inputOnly = cliOptions.inputOnly;
  if (cliOptions.outputOnly !== undefined) merged.outputOnly = cliOptions.outputOnly;
  if (cliOptions.mergeSame !== undefined) merged.mergeSame = cliOptions.mergeSame;
  if (cliOptions.suffix !== undefined) merged.suffix = cliOptions.suffix;
  if (cliOptions.inputSuffix !== undefined) merged.inputSuffix = cliOptions.inputSuffix;
  if (cliOptions.outputSuffix !== undefined) merged.outputSuffix = cliOptions.outputSuffix;
  if (cliOptions.map !== undefined) {
    merged.map = parseCustomMap(cliOptions.map);
  }
  if (cliOptions.outDir !== undefined) merged.outDir = cliOptions.outDir;
  if (cliOptions.outFile !== undefined) merged.outFile = cliOptions.outFile;
  if (cliOptions.outPattern !== undefined) merged.outPattern = cliOptions.outPattern;
  if (cliOptions.declaration !== undefined) merged.declaration = cliOptions.declaration;
  if (cliOptions.withDescriptions !== undefined)
    merged.withDescriptions = cliOptions.withDescriptions;
  if (cliOptions.generateTests !== undefined) merged.generateTests = cliOptions.generateTests;
  if (cliOptions.inlineExternalTypes !== undefined)
    merged.inlineExternalTypes = cliOptions.inlineExternalTypes;

  return merged;
}

/**
 * Validates CLI options for conflicts and invalid values.
 * @throws InvalidOptionError if any validation fails
 */
function validateOptions(config: VinferConfig): void {
  // Check mutually exclusive options
  if (config.inputOnly && config.outputOnly) {
    throw new InvalidOptionError(
      "--input-only / --output-only",
      "Cannot use both options together",
      "Use only one of --input-only or --output-only",
    );
  }

  // Check conflicting output options
  if (config.outFile && (config.outDir || config.outPattern)) {
    throw new InvalidOptionError(
      "--outFile",
      "Cannot use with --outDir or --outPattern",
      "Use --outFile for single output, or --outDir/--outPattern for multiple outputs",
    );
  }

  // Check empty suffix
  if (config.suffix === "") {
    throw new InvalidOptionError(
      "--suffix",
      "Empty suffix is not allowed",
      "Provide a non-empty suffix value or omit the option",
    );
  }
}

/**
 * Creates a NameMapper from config.
 */
function createNameMapper(config: VinferConfig): NameMapper {
  const mappingOptions: NameMappingOptions = {};

  if (config.suffix) {
    mappingOptions.removeSuffix = config.suffix;
  }
  if (config.inputSuffix != null) {
    mappingOptions.inputSuffix = config.inputSuffix;
  }
  if (config.outputSuffix != null) {
    mappingOptions.outputSuffix = config.outputSuffix;
  }
  if (config.map) {
    mappingOptions.customMap = config.map;
  }

  return new NameMapper(mappingOptions);
}

/**
 * Parses schema names from a comma-separated string.
 * Filters out empty strings and validates identifier format.
 *
 * @param schemasStr - Comma-separated schema names
 * @returns Array of valid schema names
 * @throws Error if any schema name is invalid
 */
function parseSchemaNames(schemasStr: string): string[] {
  const schemas = schemasStr
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Validate that each schema name is a valid identifier
  const identifierPattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
  for (const schema of schemas) {
    if (!identifierPattern.test(schema)) {
      throw new Error(
        `Invalid schema name: "${schema}". Schema names must be valid TypeScript identifiers.`,
      );
    }
  }

  return schemas;
}

/**
 * Parses custom mapping string: "Schema1:Type1,Schema2:Type2"
 * Validates both schema names and type names.
 *
 * @param mapStr - Custom mapping string
 * @returns Map of schema names to type names
 * @throws Error if any mapping is invalid
 */
function parseCustomMap(mapStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  const identifierPattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

  for (const pair of mapStr.split(",")) {
    const trimmedPair = pair.trim();
    if (!trimmedPair) continue;

    const colonIndex = trimmedPair.indexOf(":");
    if (colonIndex === -1) {
      throw new Error(`Invalid mapping format: "${trimmedPair}". Expected "SchemaName:TypeName".`);
    }

    const from = trimmedPair.substring(0, colonIndex).trim();
    const to = trimmedPair.substring(colonIndex + 1).trim();

    if (!from || !to) {
      throw new Error(
        `Invalid mapping: "${trimmedPair}". Both schema name and type name are required.`,
      );
    }

    if (!identifierPattern.test(from)) {
      throw new Error(
        `Invalid schema name in mapping: "${from}". Must be a valid TypeScript identifier.`,
      );
    }

    if (!identifierPattern.test(to)) {
      throw new Error(
        `Invalid type name in mapping: "${to}". Must be a valid TypeScript identifier.`,
      );
    }

    if (result[from] !== undefined) {
      console.warn(
        `Warning: Duplicate mapping for "${from}". Using "${to}" (overwriting "${result[from]}").`,
      );
    }

    result[from] = to;
  }
  return result;
}

/**
 * Finds tsconfig.json starting from the given directory.
 */
function findTsConfig(startDir: string): string | undefined {
  let currentDir = startDir;
  // Get the root directory in a cross-platform way (e.g., "/" on Unix, "C:\" on Windows)
  const root = parsePath(resolve(startDir)).root;

  while (currentDir !== root) {
    const tsconfigPath = resolve(currentDir, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      return tsconfigPath;
    }
    const parentDir = resolve(currentDir, "..");
    // Prevent infinite loop at root
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  // Check root directory as well
  const rootTsconfig = resolve(root, "tsconfig.json");
  if (existsSync(rootTsconfig)) {
    return rootTsconfig;
  }

  return undefined;
}

/**
 * Ensures a directory exists.
 * @throws Error if the directory cannot be created
 */
function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    try {
      mkdirSync(dirPath, { recursive: true });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      throw new Error(`Failed to create directory "${dirPath}": ${err.message}`);
    }
  }
}

/**
 * Writes content to a file with proper error handling.
 * @throws Error if the file cannot be written
 */
function writeFile(filePath: string, content: string): void {
  try {
    writeFileSync(filePath, content, "utf-8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    throw new Error(`Failed to write file "${filePath}": ${err.message}`);
  }
}

/**
 * Creates test schema info from extraction results.
 */
function createTestSchemas(results: ExtractResult[], nameMapper: NameMapper): TestSchemaInfo[] {
  return results
    .filter((r) => r.isExported)
    .map((result) => ({
      schemaName: result.schemaName,
      inputTypeName: nameMapper.map(result.schemaName).inputName,
      outputTypeName: nameMapper.map(result.schemaName).outputName,
    }));
}

/**
 * Generates test file content for single output mode (--outFile).
 */
function generateTestFileForSingleOutput(
  fileResultsMap: Map<string, ExtractResult[]>,
  typesPath: string,
  testPath: string,
  nameMapper: NameMapper,
): string {
  const testFiles: TestFileInfo[] = [];
  const testDir = dirname(testPath);

  for (const [schemaFile, results] of fileResultsMap) {
    const schemas = createTestSchemas(results, nameMapper);
    if (schemas.length === 0) continue;

    testFiles.push({
      schemaFilePath: getRelativePath(testDir, schemaFile),
      typesFilePath: getRelativePath(testDir, typesPath),
      importPrefix: generateImportPrefix(basename(schemaFile, ".ts")),
      schemas,
    });
  }

  return generateTypeTests(testFiles);
}

/**
 * Generates test file content for per-file output mode (--outDir).
 */
function generateTestFileForPerFile(
  schemaFile: string,
  typesPath: string,
  testPath: string,
  results: ExtractResult[],
  nameMapper: NameMapper,
): string {
  const schemas = createTestSchemas(results, nameMapper);
  if (schemas.length === 0) {
    return "";
  }

  const testDir = dirname(testPath);

  return generateTypeTests([
    {
      schemaFilePath: getRelativePath(testDir, schemaFile),
      typesFilePath: getRelativePath(testDir, typesPath),
      importPrefix: generateImportPrefix(basename(schemaFile, ".ts")),
      schemas,
    },
  ]);
}

/**
 * Gets relative path from one file to another, ensuring it starts with ./
 */
function getRelativePath(from: string, to: string): string {
  const rel = relative(from, to);
  return rel.startsWith(".") ? rel : "./" + rel;
}
