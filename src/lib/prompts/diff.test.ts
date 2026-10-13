import { describe, expect, it } from "vitest";
import { diffTemplates } from "./diff";

describe("diffTemplates", () => {
  it("marks added, removed and unchanged lines", () => {
    expect(diffTemplates("Titre\nAncienne consigne\nFin", "Titre\nNouvelle consigne\nFin")).toEqual([
      { kind: "same", text: "Titre" },
      { kind: "removed", text: "Ancienne consigne" },
      { kind: "added", text: "Nouvelle consigne" },
      { kind: "same", text: "Fin" },
    ]);
  });

  it("returns one unchanged line per line for identical templates", () => {
    expect(diffTemplates("a\nb", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  it("doesn't count a missing final newline as a change", () => {
    expect(diffTemplates("a\nfin", "a\nfin\nnouvelle")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "fin" },
      { kind: "added", text: "nouvelle" },
    ]);
  });

  it("keeps empty lines", () => {
    expect(diffTemplates("a\n\nb", "a\n\nb\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "" },
      { kind: "same", text: "b" },
      { kind: "added", text: "c" },
    ]);
  });

  it("gives up on templates rewritten from scratch, quickly", () => {
    const before = Array.from({ length: 10_000 }, (_, index) => `a${index}`).join("\n");
    const after = Array.from({ length: 10_000 }, (_, index) => `b${index}`).join("\n");
    const start = performance.now();
    expect(diffTemplates(before, after)).toBeNull();
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
