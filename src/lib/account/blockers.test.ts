// @vitest-environment node
import { describe, expect, it } from "vitest";
import { blockerLinks, toBlockers, type BlockerRow } from "./blockers";

const ORG = "11111111-1111-4111-8111-111111111111";
const WS = "22222222-2222-4222-8222-222222222222";

function row(values: Partial<BlockerRow> & { kind: string }): BlockerRow {
  return {
    organization_id: null,
    organization_name: null,
    workspace_id: null,
    workspace_name: null,
    other_members: null,
    successors: null,
    ...values,
  };
}

describe("toBlockers", () => {
  it("reads the three kinds the database returns", () => {
    expect(
      toBlockers([
        row({
          kind: "organization_owner",
          organization_id: ORG,
          organization_name: "Cabinet A",
          successors: 2,
        }),
        row({
          kind: "only_owner",
          organization_id: ORG,
          workspace_id: WS,
          workspace_name: "Etude A",
          other_members: 3,
        }),
        row({
          kind: "only_member",
          organization_id: ORG,
          workspace_id: WS,
          workspace_name: "Etude B",
          other_members: 0,
        }),
      ]),
    ).toEqual([
      { kind: "organization_owner", organizationId: ORG, organizationName: "Cabinet A", successors: 2 },
      { kind: "only_owner", workspaceId: WS, workspaceName: "Etude A", otherMembers: 3 },
      { kind: "only_member", workspaceId: WS, workspaceName: "Etude B" },
    ]);
  });

  it("drops rows of an unknown kind or without their id", () => {
    expect(
      toBlockers([
        row({ kind: "something_else", organization_id: ORG }),
        row({ kind: "organization_owner" }),
        row({ kind: "only_owner", organization_id: ORG }),
      ]),
    ).toEqual([]);
  });
});

describe("blockerLinks", () => {
  it("offers the transfer only when someone can take the organization over", () => {
    expect(
      blockerLinks({
        kind: "organization_owner",
        organizationId: ORG,
        organizationName: "Cabinet A",
        successors: 1,
      }),
    ).toEqual([
      { key: "transfer", href: "/compte#transfert" },
      { key: "deleteOrganization", href: `/organisations/${ORG}` },
    ]);
    expect(
      blockerLinks({
        kind: "organization_owner",
        organizationId: ORG,
        organizationName: "Cabinet A",
        successors: 0,
      }),
    ).toEqual([{ key: "deleteOrganization", href: `/organisations/${ORG}` }]);
  });

  it("sends the only owner to the members page or the workspace settings", () => {
    expect(
      blockerLinks({ kind: "only_owner", workspaceId: WS, workspaceName: "Etude A", otherMembers: 2 }),
    ).toEqual([
      { key: "members", href: `/espaces/${WS}/membres` },
      { key: "deleteWorkspace", href: `/espaces/${WS}/parametres` },
    ]);
  });

  it("sends the only member to the workspace settings", () => {
    expect(blockerLinks({ kind: "only_member", workspaceId: WS, workspaceName: "Etude A" })).toEqual([
      { key: "deleteWorkspace", href: `/espaces/${WS}/parametres` },
    ]);
  });
});
