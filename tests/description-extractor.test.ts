import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "pathe";
import { DescriptionExtractor } from "../src/core/description-extractor.js";
import type { SchemaDescription } from "../src/core/description-extractor.js";

const shapesPath = resolve(import.meta.dirname, "fixtures/descriptions/shapes.ts");

describe("DescriptionExtractor", () => {
  const extractor = new DescriptionExtractor();
  let shapes: SchemaDescription;
  let descriptions: Map<string, SchemaDescription>;

  beforeAll(async () => {
    descriptions = await extractor.extractDescriptions(shapesPath, [
      "ShapesSchema",
      "TreeSchema",
      "UndescribedSchema",
    ]);
    shapes = descriptions.get("ShapesSchema")!;
  });

  /**
   * Looks up the description recorded for a field path.
   */
  function describedAt(path: string): string | undefined {
    return shapes.fields.find((field) => field.path === path)?.description;
  }

  it("extracts the schema-level description", () => {
    expect(shapes.description).toBe("Every description shape");
  });

  it("extracts a description from a piped primitive", () => {
    expect(describedAt("plain")).toBe("A plain string");
  });

  it("looks through wrappers in both directions", () => {
    expect(describedAt("optionalInner")).toBe("Optional, described inside");
    expect(describedAt("optionalOuter")).toBe("Optional, described outside");
    expect(describedAt("nullable")).toBe("Nullable");
  });

  it("extends the path through nested object entries", () => {
    expect(describedAt("nested.inner")).toBe("A nested number");
    expect(describedAt("inner")).toBeUndefined();
  });

  it("keeps inline members at the holding field's path", () => {
    expect(describedAt("items.itemField")).toBe("An item field");
    expect(describedAt("choice.a")).toBe("Choice A");
    expect(describedAt("choice.b")).toBe("Choice B");
    expect(describedAt("tagged.one")).toBe("Variant one");
    expect(describedAt("lookup.value")).toBe("A record value");
    expect(describedAt("pair.first")).toBe("Tuple member");
  });

  it("accepts v.metadata({ description }) as a description", () => {
    expect(describedAt("viaMetadata")).toBe("Described via metadata");
  });

  it("does not treat v.title() as a description", () => {
    expect(describedAt("titled")).toBeUndefined();
  });

  it("takes the last description in a pipe, then falls back to nested pipes", () => {
    expect(describedAt("overridden")).toBe("Last wins");
    expect(describedAt("fromNestedPipe")).toBe("From the nested pipe");
  });

  it("describes a shared schema at every path it is used from", () => {
    expect(describedAt("firstUse.label")).toBe("A shared label");
    expect(describedAt("secondUse.label")).toBe("A shared label");
  });

  it("records nothing for undescribed fields", () => {
    expect(describedAt("bare")).toBeUndefined();
  });

  it("terminates on recursive schemas", () => {
    const tree = descriptions.get("TreeSchema")!;
    expect(tree.fields).toEqual([{ path: "name", description: "The node name" }]);
  });

  it("returns an empty result for a schema without descriptions", () => {
    const undescribed = descriptions.get("UndescribedSchema")!;
    expect(undescribed.description).toBeUndefined();
    expect(undescribed.fields).toEqual([]);
  });

  it("skips schema names that the module does not export", () => {
    expect(descriptions.has("MissingSchema")).toBe(false);
  });

  it("returns an empty map when the module cannot be imported", async () => {
    const result = await extractor.extractDescriptions(
      resolve(import.meta.dirname, "fixtures/descriptions/does-not-exist.ts"),
      ["AnySchema"],
    );
    expect(result.size).toBe(0);
  });
});
