import { describe, it, expect } from "vitest";
import { NameMapper } from "../src/core/name-mapper.js";

describe("NameMapper", () => {
  it("should use empty string suffix when inputSuffix is empty", () => {
    const mapper = new NameMapper({ inputSuffix: "", outputSuffix: "" });
    const result = mapper.map("User");
    expect(result.inputName).toBe("User");
    expect(result.outputName).toBe("User");
  });

  it("should not fall back to defaults when suffix is empty string", () => {
    const mapper = new NameMapper({ inputSuffix: "", outputSuffix: "Out" });
    const result = mapper.map("User");
    expect(result.inputName).toBe("User");
    expect(result.outputName).toBe("UserOut");
  });
});
