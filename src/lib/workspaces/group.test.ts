import { describe, expect, it } from "vitest";
import { groupByOrganization } from "./group";
import type { MyWorkspace } from "./types";

function workspace(
  id: string,
  name: string,
  organizationId: string,
  organizationName: string | null,
): MyWorkspace {
  return { id, name, organizationId, organizationName, ownsOrganization: false, role: "expert" };
}

const names = (groups: ReturnType<typeof groupByOrganization>) =>
  groups.map((group) => [group.organizationName, group.workspaces.map((w) => w.name)]);

describe("groupByOrganization", () => {
  it("groups by organization, organizations and workspaces sorted by name", () => {
    const groups = groupByOrganization(
      [
        workspace("w1", "Mission Parakou", "o2", "Cabinet Zinsou"),
        workspace("w2", "Audit Cotonou", "o1", "Agence Bénin"),
        workspace("w3", "Audit Abomey", "o2", "Cabinet Zinsou"),
        workspace("w4", "Étude Porto-Novo", "o1", "Agence Bénin"),
      ],
      "Organisation sans nom",
    );
    expect(names(groups)).toEqual([
      ["Agence Bénin", ["Audit Cotonou", "Étude Porto-Novo"]],
      ["Cabinet Zinsou", ["Audit Abomey", "Mission Parakou"]],
    ]);
  });

  it("sorts with French rules: accents and case do not push a name to the end", () => {
    const groups = groupByOrganization(
      [
        workspace("w1", "zone nord", "o1", "Cabinet"),
        workspace("w2", "Étude", "o1", "Cabinet"),
        workspace("w3", "Evaluation", "o1", "Cabinet"),
        workspace("w4", "Mission 10", "o1", "Cabinet"),
        workspace("w5", "Mission 9", "o1", "Cabinet"),
      ],
      "Organisation sans nom",
    );
    expect(groups[0]?.workspaces.map((w) => w.name)).toEqual([
      "Étude",
      "Evaluation",
      "Mission 9",
      "Mission 10",
      "zone nord",
    ]);
  });

  it("keeps two organizations with the same name apart", () => {
    const groups = groupByOrganization(
      [
        workspace("w1", "Audit A", "o1", "Cabinet Conseil"),
        workspace("w2", "Audit B", "o2", "Cabinet Conseil"),
      ],
      "Organisation sans nom",
    );
    expect(groups.map((group) => group.organizationId)).toEqual(["o1", "o2"]);
    expect(groups.map((group) => group.workspaces.map((w) => w.id))).toEqual([["w1"], ["w2"]]);
  });

  it("sorts an organization without a name by the label it gets", () => {
    const groups = groupByOrganization(
      [workspace("w1", "Audit", "o1", "Zinsou Conseil"), workspace("w2", "Mission", "o2", null)],
      "Organisation sans nom",
    );
    expect(names(groups)).toEqual([
      [null, ["Mission"]],
      ["Zinsou Conseil", ["Audit"]],
    ]);
  });

  it("takes the name from any workspace of the organization", () => {
    const groups = groupByOrganization(
      [workspace("w1", "Audit", "o1", null), workspace("w2", "Mission", "o1", "Cabinet Ahouandjinou")],
      "Organisation sans nom",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.organizationName).toBe("Cabinet Ahouandjinou");
  });

  it("returns nothing for no workspace", () => {
    expect(groupByOrganization([], "Organisation sans nom")).toEqual([]);
  });
});
