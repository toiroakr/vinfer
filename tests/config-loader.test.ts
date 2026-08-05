import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "pathe";
import { ConfigLoader, defineConfig } from "../src/core/config-loader.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vinfer-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ConfigLoader.load", () => {
  const loader = new ConfigLoader();

  it("returns an empty config when nothing is found", async () => {
    expect(await loader.load(dir)).toEqual({ config: {} });
  });

  it("loads vinfer.config.js", async () => {
    writeFileSync(
      join(dir, "vinfer.config.js"),
      'export default { outDir: "./types", suffix: "Schema" };',
    );

    const { config, configPath } = await loader.load(dir);
    expect(config).toEqual({ outDir: "./types", suffix: "Schema" });
    expect(configPath).toBe(join(dir, "vinfer.config.js"));
  });

  it("loads vinfer.config.mjs", async () => {
    writeFileSync(join(dir, "vinfer.config.mjs"), "export default { mergeSame: true };");

    const { config } = await loader.load(dir);
    expect(config).toEqual({ mergeSame: true });
  });

  it("prefers a config file over package.json", async () => {
    writeFileSync(join(dir, "vinfer.config.mjs"), 'export default { suffix: "FromFile" };');
    writeFileSync(join(dir, "package.json"), JSON.stringify({ vinfer: { suffix: "FromPackage" } }));

    const { config } = await loader.load(dir);
    expect(config.suffix).toBe("FromFile");
  });

  it("loads the vinfer field from package.json", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "app", vinfer: { include: ["src/**/*.ts"] } }),
    );

    const { config, configPath } = await loader.load(dir);
    expect(config).toEqual({ include: ["src/**/*.ts"] });
    expect(configPath).toBe(join(dir, "package.json"));
  });

  it("ignores a package.json without a vinfer field", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app" }));
    expect(await loader.load(dir)).toEqual({ config: {} });
  });

  it("ignores an unparsable package.json", async () => {
    writeFileSync(join(dir, "package.json"), "{ not json");
    expect(await loader.load(dir)).toEqual({ config: {} });
  });

  it("falls back to an empty config when a config file throws", async () => {
    writeFileSync(join(dir, "vinfer.config.mjs"), "throw new Error('boom');");
    const { config } = await loader.load(dir);
    expect(config).toEqual({});
  });
});

describe("ConfigLoader.loadFrom", () => {
  const loader = new ConfigLoader();

  it("loads an explicitly requested config file", async () => {
    const configPath = join(dir, "custom.config.mjs");
    writeFileSync(configPath, 'export default { outFile: "./types.ts" };');

    const result = await loader.loadFrom(configPath);
    expect(result.config).toEqual({ outFile: "./types.ts" });
    expect(result.configPath).toBe(configPath);
  });

  it("reads the vinfer field when pointed at a package.json", async () => {
    const configPath = join(dir, "package.json");
    writeFileSync(configPath, JSON.stringify({ vinfer: { declaration: true } }));

    const result = await loader.loadFrom(configPath);
    expect(result.config).toEqual({ declaration: true });
  });

  it("throws when the file does not exist", async () => {
    await expect(loader.loadFrom(join(dir, "missing.config.ts"))).rejects.toThrow(
      /Config file not found/,
    );
  });
});

describe("defineConfig", () => {
  it("returns the config unchanged", () => {
    const config = { include: ["src/**/*.ts"], mergeSame: true };
    expect(defineConfig(config)).toEqual(config);
  });
});
