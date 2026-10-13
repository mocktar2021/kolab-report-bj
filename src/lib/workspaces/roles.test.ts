import { describe, expect, it } from "vitest";
import { canManageMember, grantableRoles, isAssignable, isManager } from "./roles";

describe("isManager", () => {
  it("is true for owners and admins only", () => {
    expect(isManager("owner")).toBe(true);
    expect(isManager("admin")).toBe(true);
    expect(isManager("expert")).toBe(false);
    expect(isManager("viewer")).toBe(false);
  });
});

describe("isAssignable", () => {
  it("excludes viewers, like the check_assignee trigger", () => {
    expect(isAssignable("owner")).toBe(true);
    expect(isAssignable("admin")).toBe(true);
    expect(isAssignable("expert")).toBe(true);
    expect(isAssignable("viewer")).toBe(false);
  });
});

describe("canManageMember", () => {
  it("lets owners manage everyone", () => {
    expect(canManageMember("owner", "owner")).toBe(true);
    expect(canManageMember("owner", "viewer")).toBe(true);
  });

  it("keeps admins away from owners", () => {
    expect(canManageMember("admin", "owner")).toBe(false);
    expect(canManageMember("admin", "admin")).toBe(true);
    expect(canManageMember("admin", "expert")).toBe(true);
  });

  it("gives experts and viewers no say", () => {
    expect(canManageMember("expert", "viewer")).toBe(false);
    expect(canManageMember("viewer", "viewer")).toBe(false);
  });
});

describe("grantableRoles", () => {
  it("lets only owners grant the owner role", () => {
    expect(grantableRoles("owner")).toEqual(["owner", "admin", "expert", "viewer"]);
    expect(grantableRoles("admin")).toEqual(["admin", "expert", "viewer"]);
    expect(grantableRoles("expert")).toEqual([]);
  });
});
