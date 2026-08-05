import { describe, it, expect } from "vitest";
import {
  VinferError,
  NoSchemasFoundError,
  NoFilesMatchedError,
  InvalidOptionError,
  formatError,
} from "../src/core/errors.js";

describe("VinferError", () => {
  it("carries a code and formats a hint when present", () => {
    const error = new VinferError("Something broke", "SOMETHING_BROKE", "Try turning it off");
    expect(error.code).toBe("SOMETHING_BROKE");
    expect(error.format()).toBe("Error: Something broke\nHint: Try turning it off");
  });

  it("omits the hint line when there is no hint", () => {
    expect(new VinferError("Something broke", "SOMETHING_BROKE").format()).toBe(
      "Error: Something broke",
    );
  });
});

describe("NoSchemasFoundError", () => {
  it("names the single file it searched", () => {
    const error = new NoSchemasFoundError(["/src/user.ts"]);
    expect(error.message).toBe("No Valibot schemas found in /src/user.ts");
    expect(error.hint).toContain("v.object");
  });

  it("summarizes multiple files by count", () => {
    expect(new NoSchemasFoundError(["/a.ts", "/b.ts"]).message).toBe(
      "No Valibot schemas found in 2 files",
    );
  });

  it("lists the schemas that were requested but not found", () => {
    const error = new NoSchemasFoundError(["/a.ts"], ["UserSchema", "PostSchema"]);
    expect(error.message).toBe("Requested schemas not found: UserSchema, PostSchema");
    expect(error.hint).toContain("/a.ts");
  });
});

describe("NoFilesMatchedError", () => {
  it("lists the patterns that matched nothing", () => {
    const error = new NoFilesMatchedError(["src/**/*.schema.ts", "lib/*.ts"]);
    expect(error.message).toBe("No files matched the pattern(s): src/**/*.schema.ts, lib/*.ts");
    expect(error.code).toBe("NO_FILES_MATCHED");
  });
});

describe("InvalidOptionError", () => {
  it("names the option and the reason", () => {
    const error = new InvalidOptionError("--suffix", "Empty suffix is not allowed", "Pass a value");
    expect(error.message).toBe('Invalid option "--suffix": Empty suffix is not allowed');
    expect(error.format()).toContain("Hint: Pass a value");
  });
});

describe("formatError", () => {
  it("formats vinfer errors through their own formatter", () => {
    expect(formatError(new NoFilesMatchedError(["*.ts"]))).toContain("Hint: Check that");
  });

  it("prefixes plain errors", () => {
    expect(formatError(new Error("boom"))).toBe("Error: boom");
  });

  it("stringifies non-errors", () => {
    expect(formatError("boom")).toBe("Error: boom");
    expect(formatError(undefined)).toBe("Error: undefined");
  });

  it("summarizes ts-morph manipulation errors", () => {
    const output = formatError(new Error("Manipulation error: syntax error\nTS1005: expected"));
    expect(output).toContain("Error: Syntax error in source file");
    expect(output).toContain("Please fix any syntax errors before running vinfer.");
  });

  it("summarizes ts-morph errors without a syntax marker", () => {
    expect(formatError(new Error("Manipulation error: something else"))).toBe(
      "Error: Failed to process TypeScript file",
    );
  });
});
