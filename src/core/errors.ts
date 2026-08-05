/**
 * Base error class for vinfer errors.
 */
export class VinferError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "VinferError";
  }

  /**
   * Formats the error for display.
   */
  format(): string {
    const lines = [`Error: ${this.message}`];
    if (this.hint) {
      lines.push(`Hint: ${this.hint}`);
    }
    return lines.join("\n");
  }
}

/**
 * Error when no schemas are found in files.
 */
export class NoSchemasFoundError extends VinferError {
  constructor(filePaths: string[], requestedSchemas?: string[]) {
    const files = filePaths.length === 1 ? filePaths[0] : `${filePaths.length} files`;

    if (requestedSchemas?.length) {
      super(
        `Requested schemas not found: ${requestedSchemas.join(", ")}`,
        "NO_SCHEMAS_FOUND",
        `These schemas were not found in ${files}. Check schema names are correct.`,
      );
    } else {
      super(
        `No Valibot schemas found in ${files}`,
        "NO_SCHEMAS_FOUND",
        "Ensure schemas are exported and use Valibot syntax (v.object, v.string, etc.)",
      );
    }
    this.name = "NoSchemasFoundError";
  }
}

/**
 * Error when files don't match the pattern.
 */
export class NoFilesMatchedError extends VinferError {
  constructor(patterns: string[]) {
    super(
      `No files matched the pattern(s): ${patterns.join(", ")}`,
      "NO_FILES_MATCHED",
      "Check that the file paths or glob patterns are correct",
    );
    this.name = "NoFilesMatchedError";
  }
}

/**
 * Error when CLI options are invalid.
 */
export class InvalidOptionError extends VinferError {
  constructor(optionName: string, reason: string, hint?: string) {
    super(`Invalid option "${optionName}": ${reason}`, "INVALID_OPTION", hint);
    this.name = "InvalidOptionError";
  }
}

/**
 * Formats any error for CLI output.
 */
export function formatError(error: unknown): string {
  if (error instanceof VinferError) {
    return error.format();
  }

  if (error instanceof Error) {
    // Clean up common ts-morph errors
    const message = error.message;

    if (message.includes("Manipulation error")) {
      return formatTsMorphError(message);
    }

    return `Error: ${message}`;
  }

  return `Error: ${String(error)}`;
}

/**
 * Formats ts-morph manipulation errors.
 */
function formatTsMorphError(message: string): string {
  const lines: string[] = [];

  // Extract the first line (main error)
  const firstLine = message.split("\n")[0];
  if (firstLine.includes("syntax error")) {
    lines.push("Error: Syntax error in source file");
  } else {
    lines.push("Error: Failed to process TypeScript file");
  }

  // Extract TypeScript error codes (TS1005, etc.)
  const tsErrors = message.match(/TS\d+/g);
  if (tsErrors?.length) {
    lines.push("");
    lines.push("TypeScript reported errors in the file.");
    lines.push("Please fix any syntax errors before running vinfer.");
  }

  return lines.join("\n");
}
