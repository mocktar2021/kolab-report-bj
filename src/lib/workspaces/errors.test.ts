import { describe, expect, it } from "vitest";
import { workspaceErrorKey } from "./errors";

describe("workspaceErrorKey", () => {
  it("maps the RBAC trigger codes", () => {
    expect(workspaceErrorKey({ code: "KR001" })).toBe("lastOwner");
    expect(workspaceErrorKey({ code: "KR002" })).toBe("assigneeNotMember");
  });

  it("maps permission and validation errors", () => {
    expect(workspaceErrorKey({ code: "42501" })).toBe("forbidden");
    expect(workspaceErrorKey({ code: "22023" })).toBe("invalidInput");
    expect(workspaceErrorKey({ code: "23514" })).toBe("invalidInput");
  });

  it("falls back to a generic message", () => {
    expect(workspaceErrorKey({ code: "XX000" })).toBe("generic");
    expect(workspaceErrorKey(null)).toBe("generic");
  });
});
