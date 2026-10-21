// @vitest-environment node
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { checkTemplate } from "@/lib/prompts/template";
import { WRITER_SYSTEM_PROMPT } from "@/lib/prompts/writer";
import { mockModel } from "./mock";
import { sampleWrittenTemplate, writeTemplate } from "./template-writer";

const DESCRIPTION =
  "Une section qui présente les fuites du réseau d'eau, quartier par quartier, avec leur coût estimé.";

/** A model that records the prompt it gets and answers `text`. */
function recording(text: string) {
  const calls: { system: string; user: string }[] = [];
  const base = mockModel(() => text);
  const model: LanguageModelV4 = {
    ...base,
    async doGenerate(options) {
      const system = options.prompt.find((message) => message.role === "system");
      const user = options.prompt.find((message) => message.role === "user");
      calls.push({
        system: typeof system?.content === "string" ? system.content : "",
        user:
          user && Array.isArray(user.content)
            ? user.content.map((part) => ("text" in part ? part.text : "")).join("")
            : "",
      });
      return base.doGenerate(options);
    },
  };
  return { model, calls };
}

describe("writeTemplate", () => {
  it("sends the fixed system prompt and the description in its block", async () => {
    const { model, calls } = recording(JSON.stringify(sampleWrittenTemplate()));
    const result = await writeTemplate({ model, description: DESCRIPTION, outputSchema: "section_draft" });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.system).toBe(WRITER_SYSTEM_PROMPT);
    expect(calls[0]?.user).toContain(`<description>\n${DESCRIPTION}\n</description>`);
  });

  it("returns the checked template and the usage", async () => {
    const result = await writeTemplate({
      model: mockModel(() => JSON.stringify(sampleWrittenTemplate())),
      description: DESCRIPTION,
      outputSchema: null,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.written.title).toBe("Synthèse des constats de terrain");
    expect(result.written.notes).toEqual([]);
    const check = checkTemplate(result.written.template);
    expect(check.unknown).toEqual([]);
    expect(check.variables).toContain("deliverables");
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.usageEstimated).toBe(false);
  });

  it("cleans what the model got wrong and says so", async () => {
    const result = await writeTemplate({
      model: mockModel(() =>
        JSON.stringify({
          title: "Essai",
          description: "Essai.",
          template: "Client : {{client}}. Section {{section_title}}.",
        }),
      ),
      description: DESCRIPTION,
      outputSchema: null,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.written.notes).toEqual(["unknownVariablesRemoved", "deliverablesAdded"]);
    expect(result.written.removed).toEqual(["{{client}}"]);
  });

  it("fails on an answer that is not the expected object, and keeps its usage", async () => {
    const result = await writeTemplate({
      model: mockModel(() => "Voici votre modèle : Tu rédiges..."),
      description: DESCRIPTION,
      outputSchema: null,
    });
    expect(result).toMatchObject({ ok: false, error: "invalidOutput" });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it("fails on an empty template", async () => {
    const result = await writeTemplate({
      model: mockModel(() => JSON.stringify({ title: "Vide", description: "Vide.", template: " " })),
      description: DESCRIPTION,
      outputSchema: null,
    });
    expect(result).toMatchObject({ ok: false, error: "invalidOutput", rejection: "emptyTemplate" });
  });

  it("reports a provider error without usage, and a timeout with an estimate", async () => {
    const broken: LanguageModelV4 = {
      ...mockModel(() => ""),
      async doGenerate() {
        throw new Error("overloaded");
      },
    };
    const failed = await writeTemplate({ model: broken, description: DESCRIPTION, outputSchema: null });
    expect(failed).toMatchObject({
      ok: false,
      error: "providerError",
      usage: { inputTokens: 0, outputTokens: 0 },
    });

    const controller = new AbortController();
    controller.abort();
    const stopped = await writeTemplate({
      model: broken,
      description: DESCRIPTION,
      outputSchema: null,
      signal: controller.signal,
    });
    expect(stopped).toMatchObject({ ok: false, error: "timeout", usageEstimated: true });
    expect(stopped.usage.inputTokens).toBeGreaterThan(0);
  });
});
