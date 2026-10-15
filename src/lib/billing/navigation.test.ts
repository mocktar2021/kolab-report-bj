import { describe, expect, it } from "vitest";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { billingOrganizationOf } from "./navigation";

const WORKSPACES: MyWorkspace[] = [
  {
    id: "w1",
    name: "Etude A",
    organizationId: "org-a",
    organizationName: "Cabinet A",
    role: "expert",
    ownsOrganization: true,
  },
  {
    id: "w2",
    name: "Etude B",
    organizationId: "org-b",
    organizationName: "Cabinet B",
    role: "owner",
    ownsOrganization: false,
  },
];

describe("billingOrganizationOf", () => {
  it("links the billing page of the current workspace's organization when the user reads it", () => {
    // An organization owner with an expert role only: the database says they read it.
    expect(billingOrganizationOf(WORKSPACES, "w1", ["org-a"])).toBe("org-a");
    expect(billingOrganizationOf(WORKSPACES, "w2", ["org-a", "org-b"])).toBe("org-b");
  });

  it("shows no link for another organization, before the launch, or without a current workspace", () => {
    expect(billingOrganizationOf(WORKSPACES, "w1", ["org-b"])).toBeNull();
    expect(billingOrganizationOf(WORKSPACES, "w2", [])).toBeNull();
    expect(billingOrganizationOf(WORKSPACES, null, ["org-a"])).toBeNull();
    expect(billingOrganizationOf(WORKSPACES, "unknown", ["org-a"])).toBeNull();
  });
});
