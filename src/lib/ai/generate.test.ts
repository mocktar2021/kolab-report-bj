import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import { PROMPT_LIMITS } from "@/lib/prompts/catalog";
import { CHARS_PER_TOKEN } from "./context/tokens";
import {
  describeValidationError,
  generateDraft,
  repairPrompt,
  repairReserve,
  type DraftCall,
} from "./generate";
import { mockModel, sampleOutput } from "./mock";

const REFS = ["L1", "L2"] as const;
const VALID = JSON.stringify(sampleOutput("section_draft", REFS));
// Cites a file that wasn't sent: the schema only accepts L1 and L2.
const INVALID = JSON.stringify({
  ...sampleOutput("section_draft", REFS),
  sources: [{ deliverable: "L9", detail: "x" }],
});

function answers(...texts: string[]): LanguageModelV4 {
  let call = 0;
  return mockModel(() => texts[Math.min(call++, texts.length - 1)] ?? "");
}

function draftCall(model: LanguageModelV4, overrides: Partial<DraftCall> = {}): DraftCall {
  return {
    model,
    schema: "section_draft",
    refs: REFS,
    system: "Système",
    prompt: "Rédige la section.",
    temperature: 0.3,
    maxTokens: 1000,
    effort: "high",
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
    // What the mock reports as the provider: a third of the characters, rounded up.
    expect(result.usage.outputTokens).toBe(Math.ceil(VALID.length / 3));
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usageEstimated).toBe(false);
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
    expect(result).toMatchObject({ ok: false, error: "aborted", usageEstimated: true });
    expect(onRepair).not.toHaveBeenCalled();
    // The provider never reported usage: the prompt and the text received are counted anyway.
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
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
    expect(result).toMatchObject({
      ok: false,
      error: "providerError",
      usage: { inputTokens: 0, outputTokens: 0 },
      usageEstimated: false,
    });
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

describe("repairReserve", () => {
  it("holds the prompt again, the quoted answer and the output", () => {
    expect(repairReserve(10_000, 4096)).toBe(10_000 + Math.ceil(40_000 / 3) + 4096);
  });

  it("quotes back and reserves a whole answer cut at the largest output cap", () => {
    // French runs about 4 characters per token (context/tokens.ts).
    const max = PROMPT_LIMITS.maxOutputTokensMax;
    const cut = `{"summary": "${"é".repeat(max * 4 - 13)}`;
    expect(repairPrompt("Consigne", cut, "- (racine) : JSON coupé")).toContain(`${cut}\n`);
    const quoteReserve = repairReserve(0, max) - max;
    expect(quoteReserve).toBeGreaterThanOrEqual(Math.ceil(cut.length / CHARS_PER_TOKEN));
  });
});

describe("provider fallback", () => {
  it("gives the call to the fallback model when the first one fails before answering", async () => {
    const primary = answers(VALID);
    primary.doStream = () => Promise.reject(new Error("overloaded"));
    const fallback = answers(VALID);
    const result = await generateDraft(draftCall(primary, { fallback }));
    expect(result).toMatchObject({ ok: true, usedFallback: true, repaired: false });
  });

  it("keeps a model that started answering, even when it breaks", async () => {
    const controller = new AbortController();
    const fallback = answers(VALID);
    const spy = vi.spyOn(fallback, "doStream");
    const result = await generateDraft(
      draftCall(answers(VALID), {
        fallback,
        userSignal: controller.signal,
        onPartial: () => controller.abort(),
      }),
    );
    expect(result).toMatchObject({ ok: false, error: "aborted", usedFallback: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it("repairs with the fallback model once it took over", async () => {
    const primary = answers(VALID);
    primary.doStream = () => Promise.reject(new Error("rate limited"));
    const fallback = answers(INVALID, VALID);
    const spy = vi.spyOn(fallback, "doStream");
    const result = await generateDraft(draftCall(primary, { fallback }));
    expect(result).toMatchObject({ ok: true, usedFallback: true, repaired: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("fails as before without a fallback model", async () => {
    const primary = answers(VALID);
    primary.doStream = () => Promise.reject(new Error("unreachable"));
    expect(await generateDraft(draftCall(primary))).toMatchObject({
      ok: false,
      error: "providerError",
      usedFallback: false,
    });
  });
});

describe("the request a Claude 5.5 model receives", () => {
  // The real Anthropic provider, with a fetch that keeps the body and refuses
  // the call. These models answer 400 to forced tool use and to a
  // temperature. A draft thinks before it answers (KRB-224), at the effort of
  // the call, inside max_tokens.
  async function requestBody(modelId: string): Promise<Record<string, unknown>> {
    const bodies: string[] = [];
    const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(
        JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "test" } }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const model = createAnthropic({ apiKey: "test", fetch })(modelId);
    const result = await generateDraft(draftCall(model));
    expect(result.ok).toBe(false);
    expect(bodies).toHaveLength(1);
    return JSON.parse(bodies[0] ?? "{}") as Record<string, unknown>;
  }

  it("sends Sonnet 5.5 adaptive thinking at the call's effort, no temperature, a JSON schema and no forced tool", async () => {
    const body = await requestBody("claude-sonnet-5-5");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.max_tokens).toBe(1000);
    const config = body.output_config as { effort?: string; format?: { type?: string } };
    expect(config.effort).toBe("high");
    expect(config.format?.type).toBe("json_schema");
  });

  it("lets Haiku 5.5 think the same way when a template runs on the fast tier", async () => {
    const body = await requestBody("claude-haiku-5-5");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect((body.output_config as { effort?: string }).effort).toBe("high");
    expect(body).not.toHaveProperty("temperature");
  });
});
