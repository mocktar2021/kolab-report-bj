import { describe, expect, it } from "vitest";
import { outline, renumber, type OutlineRow } from "./section-outline";

function row(
  id: string,
  position: number,
  parentId: string | null = null,
  createdAt = "2026-10-17T10:00:00Z",
) {
  return { id, parentId, position, createdAt } satisfies OutlineRow;
}

const places = (rows: OutlineRow[]) => outline(rows).map((r) => `${r.label} ${r.id} ${r.level}`);

describe("outline", () => {
  it("numbers sections and their subsections in document order", () => {
    expect(
      places([row("b", 1), row("a", 0), row("a2", 1, "a"), row("b1", 0, "b"), row("a1", 0, "a")]),
    ).toEqual(["1. a 1", "1.1 a1 2", "1.2 a2 2", "2. b 1", "2.1 b1 2"]);
  });

  it("orders by position, then creation, then id", () => {
    expect(
      places([
        row("c", 0, null, "2026-10-17T10:00:02Z"),
        row("b", 0, null, "2026-10-17T10:00:01Z"),
        row("a", 0, null, "2026-10-17T10:00:01Z"),
      ]),
    ).toEqual(["1. a 1", "2. b 1", "3. c 1"]);
  });

  it("numbers subsections within their section, whatever the positions of the sections", () => {
    const result = outline([
      row("a", 0),
      row("b", 1),
      row("b1", 0, "b"),
      row("b2", 0, "b", "2026-10-17T11:00:00Z"),
    ]);
    expect(result.map((r) => [r.id, r.number, r.parentId])).toEqual([
      ["a", "1", null],
      ["b", "2", null],
      ["b1", "2.1", "b"],
      ["b2", "2.2", "b"],
    ]);
  });

  it("shows a row whose parent is missing as a section", () => {
    expect(places([row("a", 0), row("lost", 1, "gone")])).toEqual(["1. a 1", "2. lost 1"]);
  });

  it("never goes past two levels", () => {
    expect(places([row("a", 0), row("a1", 0, "a"), row("a1x", 1, "a1")])).toEqual([
      "1. a 1",
      "1.1 a1 2",
      "2. a1x 1",
    ]);
  });

  it("keeps the other fields of each row", () => {
    const [first] = outline([{ ...row("a", 0), title: "Contexte" }]);
    expect(first).toMatchObject({ id: "a", title: "Contexte", number: "1", label: "1.", level: 1 });
  });

  it("returns nothing for no rows", () => {
    expect(outline([])).toEqual([]);
  });
});

describe("renumber", () => {
  it("numbers rows in the order given", () => {
    const rows = [
      { id: "b", level: 1 as const },
      { id: "b1", level: 2 as const },
      { id: "a", level: 1 as const },
      { id: "a2", level: 2 as const },
      { id: "a1", level: 2 as const },
    ];
    expect(renumber(rows).map((row) => `${row.label} ${row.id}`)).toEqual([
      "1. b",
      "1.1 b1",
      "2. a",
      "2.1 a2",
      "2.2 a1",
    ]);
  });

  it("matches outline on rows in document order", () => {
    const placed = outline([
      { id: "a", parentId: null, position: 0, createdAt: "t" },
      { id: "a1", parentId: "a", position: 0, createdAt: "t" },
      { id: "b", parentId: null, position: 1, createdAt: "t" },
    ]);
    expect(renumber(placed).map((row) => row.label)).toEqual(placed.map((row) => row.label));
  });
});
