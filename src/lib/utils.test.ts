import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a custom font size next to a text color", () => {
    expect(cn("text-h1", "text-foreground")).toBe("text-h1 text-foreground");
  });

  it("still lets a later class win within the same group", () => {
    expect(cn("text-h1", "text-h2")).toBe("text-h2");
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
