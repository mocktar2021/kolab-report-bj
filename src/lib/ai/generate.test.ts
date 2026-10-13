import type { LanguageModelV1 } from "ai";
import { describe, expect, it, vi } from "vitest";
import { describeValidationError, generateDraft, type DraftCall } from "./generate";
import { mockModel, sampleOutput } from "./mock";

const REFS = ["L1", "L2"] as const;
const VALID = JSON.stringify(sampleOutput("section_draft", REFS));
// Cites a file that wasn't sent: the schema only accepts L1 and L2.
const INVALID = JSON.stringify({
  ...sampleOutput("section_draft", REFS),
  sources: [{ deliverable: "L9", detail: "x" }],
});

function answers(...texts: string[]): LanguageModelV1 {
  let call = 0;
  return mockModel(() => texts[Math.min(call++, texts.length - 1)] ?? "");
}

function draftCall(model: LanguageModelV1, overrides: Partial<DraftCall> = {}): DraftCall {
  return {
    model,
    schema: "section_draft",
    refs: REFS,
    system: "Système",
    prompt: "Rédige la section.",
    temperature: 0.3,
    maxTokens: 1000,
    userSignal: new AbortController().signal,
    deadline: new AbortController().signal,
    onPartial: () => undefined,
    onRepair: () => undefined,
    ...overrides,
  };
}

describe("generateDraft", () => {
  it("returns the checked object and streams partial ones", async () => {
    const onPartial = vi.fn();
    const result = await generateDraft(draftCall(answers(VALID), { onPartial }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.schema).toBe("section_draft");
    expect(result.repaired).toBe(false);
    expect(result.rawText).toBe(VALID);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(onPartial.mock.calls.length).toBeGreaterThan(1);
  });

  it("asks once for a repair when the object fails the schema", async () => {
    const onRepair = vi.fn();
    const model = answers(INVALID, VALID);
    const spy = vi.spyOn(model, "doStream");
    const result = await generateDraft(draftCall(model, { onRepair }));
    expect(result.ok && result.repaired).toBe(true);
    expect(onRepair).toHaveBeenCalledOnce();
    const repairPromptText = JSON.stringify(spy.mock.calls[1]?.[0].prompt);
    expect(repairPromptText).toContain("ne respectait pas le format demandé");
    expect(repairPromptText).toContain("L9");
  });

  it("fails with invalidOutput after a second bad answer, usage of both calls included", async () => {
    const result = await generateDraft(draftCall(answers(INVALID, "pas du JSON")));
    expect(result).toMatchObject({ ok: false, error: "invalidOutput", repaired: true });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it("reports a stop by the user as aborted, without a repair", async () => {
    const controller = new AbortController();
    const onRepair = vi.fn();
    const call = draftCall(answers(VALID), {
      userSignal: controller.signal,
      onPartial: () => controller.abort(),
      onRepair,
    });
    const result = await generateDraft(call);
    expect(result).toMatchObject({ ok: false, error: "aborted" });
    expect(onRepair).not.toHaveBeenCalled();
  });

  it("reports the server deadline as a timeout", async () => {
    const deadline = new AbortController();
    const result = await generateDraft(
      draftCall(answers(VALID), { deadline: deadline.signal, onPartial: () => deadline.abort() }),
    );
    expect(result).toMatchObject({ ok: false, error: "timeout" });
  });

  it("reports a provider failure without a repair", async () => {
    const model = answers(VALID);
    model.doStream = () => Promise.reject(new Error("overloaded"));
    const onRepair = vi.fn();
    const result = await generateDraft(draftCall(model, { onRepair }));
    expect(result).toMatchObject({ ok: false, error: "providerError" });
    expect(onRepair).not.toHaveBeenCalled();
  });
});

describe("describeValidationError", () => {
  it("lists the zod issues found down the cause chain", () => {
    const error = {
      cause: { cause: { issues: [{ path: ["sources", 0, "deliverable"], message: "Invalid enum value" }] } },
    };
    expect(describeValidationError(error)).toBe("- sources.0.deliverable : Invalid enum value");
  });

  it("falls back to a general message", () => {
    expect(describeValidationError(new Error("x"))).toContain("objet JSON valide");
  });
});
