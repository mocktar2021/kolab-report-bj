"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Info, LoaderCircle, Sparkles, Square } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Link } from "@/i18n/navigation";
import { partialDraftMarkdown } from "@/lib/ai/preview";
import { nameInlineRefs } from "@/lib/ai/refs";
import type { DraftPanelData, DraftProposal, DraftTemplateOption } from "@/lib/ai/server";
import { draftRequestError, readDraftStream } from "@/lib/ai/stream-client";
import type { DeliverableUse, DraftErrorKey, DraftErrorValues, DraftRequest } from "@/lib/ai/types";
import type { OutputSchema } from "@/lib/prompts/catalog";
import { DraftProposalView, type DecisionOutcome } from "./draft-proposal";
import { TruncationNotice } from "./draft-usage";

/**
 * Why the last request gave no draft. "network": the request never reached
 * the server. `values` fill in the quota messages ({max}, {volume}, {date}).
 */
type Failure = { error: DraftErrorKey | "network"; retryAfter?: number; values?: DraftErrorValues };

/** What the status line says once nothing runs. */
type Notice = "done" | "stopped" | DecisionOutcome;

type Started = { truncated: boolean; deliverables: DeliverableUse[]; names: ReadonlyMap<string, string> };

/** A generation in progress. */
type Run = {
  schema: OutputSchema;
  started: Started | null;
  /** The object so far, unchecked. */
  partial: unknown;
  repairing: boolean;
};

type FocusTarget = "generate" | "panel" | "content";

const NO_NAMES: ReadonlyMap<string, string> = new Map();

/** Workspace templates first: a customized copy wins over the global one it came from. */
function orderTemplates(templates: DraftTemplateOption[]): DraftTemplateOption[] {
  return [
    ...templates.filter((template) => template.scope === "workspace"),
    ...templates.filter((template) => template.scope === "global"),
  ];
}

type DraftPanelProps = {
  workspaceId: string;
  sectionId: string;
  data: DraftPanelData;
  /** Owners and admins, who publish templates. */
  manager: boolean;
  /** AI drafts left in the plan, written by the page (Billing.meter), or null when unlimited. */
  usageHint?: string | null;
};

/** Draft generation and review, for the people who edit the section. */
export function DraftPanel({ workspaceId, sectionId, data, manager, usageHint = null }: DraftPanelProps) {
  const t = useTranslations("AiDraft");
  const tSchemas = useTranslations("Prompts.outputSchemas");
  const router = useRouter();

  const templates = orderTemplates(data.templates);
  const fallback = templates.find((template) => template.outputSchema === "section_draft") ?? templates[0];
  const [templateId, setTemplateId] = useState(fallback?.id ?? "");
  const template = templates.find((option) => option.id === templateId) ?? fallback;

  const [run, setRun] = useState<Run | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [streamed, setStreamed] = useState<DraftProposal | null>(null);
  const [focusStreamed, setFocusStreamed] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const abortRef = useRef<AbortController | null>(null);
  const generateRef = useRef<HTMLButtonElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef<FocusTarget | null>(null);

  // A generation stops with the page: aborting the request stops it on the server.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Focus moves once the screen shows the new state.
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target === "content") document.getElementById("section-content-title")?.focus();
    else if (target === "generate" && generateRef.current && !generateRef.current.disabled)
      generateRef.current.focus();
    else titleRef.current?.focus();
  });

  const running = run !== null;
  const names = run?.started?.names ?? NO_NAMES;
  const liveMarkdown = run ? nameInlineRefs(partialDraftMarkdown(run.schema, run.partial, names), names) : "";
  // Long drafts re-render often while they stream: React may skip a frame of the preview.
  const preview = useDeferredValue(liveMarkdown);

  // The newest proposal still waiting: the one that just streamed in, or the page's.
  const pageProposal = data.proposal && !hidden.has(data.proposal.generationId) ? data.proposal : null;
  const localProposal = streamed && !hidden.has(streamed.generationId) ? streamed : null;
  const proposal =
    localProposal &&
    (!pageProposal ||
      (localProposal.generationId !== pageProposal.generationId &&
        Date.parse(localProposal.createdAt) > Date.parse(pageProposal.createdAt)))
      ? localProposal
      : pageProposal;

  const enabled = data.availability === "enabled";
  const blocked = data.parsedCount === 0 || !template;
  const replaceHint = proposal !== null && !blocked && !running;

  async function generate() {
    if (!template || abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const current = () => abortRef.current === controller;
    const chosen = template;
    setFailure(null);
    setNotice(null);
    setRun({ schema: chosen.outputSchema, started: null, partial: null, repairing: false });

    let started: Started | null = null;
    let responded = false;
    let finished = false;
    const fail = (next: Failure) => {
      finished = true;
      if (!current()) return;
      abortRef.current = null;
      setRun(null);
      setFailure(next);
      // The stop button goes away: keep the focus in the panel.
      if (document.activeElement === stopRef.current || document.activeElement === document.body)
        focusNext.current = "generate";
    };

    try {
      const response = await fetch(`/api/ai/sections/${sectionId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptVersionId: chosen.id } satisfies DraftRequest),
        signal: controller.signal,
      });
      responded = true;
      if (!response.ok) {
        fail(await draftRequestError(response));
        return;
      }
      await readDraftStream(response, (event) => {
        if (finished || !current()) return;
        switch (event.type) {
          case "start": {
            const names = new Map(event.deliverables.map((use) => [use.ref, use.fileName]));
            started = { truncated: event.truncated, deliverables: event.deliverables, names };
            const info = started;
            setRun((value) => value && { ...value, started: info });
            break;
          }
          case "partial":
            setRun((value) => value && { ...value, partial: event.object });
            break;
          case "repair":
            setRun((value) => value && { ...value, partial: null, repairing: true });
            break;
          case "done": {
            finished = true;
            abortRef.current = null;
            const info: Started | null = started;
            setRun(null);
            setStreamed({
              generationId: event.generationId,
              createdAt: new Date().toISOString(),
              templateTitle: chosen.title,
              output: event.output,
              markdown: event.markdown,
              truncated: info?.truncated ?? false,
              deliverables: info?.deliverables ?? [],
              rating: null,
              comment: null,
              mine: true,
            });
            setFocusStreamed(true);
            setNotice("done");
            // The page reads the stored proposal, with its exact date.
            router.refresh();
            break;
          }
          case "error":
            fail({ error: event.error });
            break;
        }
      });
      // The stream ended without done or error: the connection was cut.
      if (!finished) fail({ error: "providerError" });
    } catch {
      // stop() already reset the panel.
      if (controller.signal.aborted) return;
      if (!finished) fail({ error: responded ? "providerError" : "network" });
    }
  }

  function stop() {
    const controller = abortRef.current;
    if (!controller) return;
    abortRef.current = null;
    controller.abort();
    setRun(null);
    setNotice("stopped");
    focusNext.current = "generate";
  }

  function decided(outcome: DecisionOutcome, generationId: string) {
    setHidden((current) => {
      const next = new Set(current).add(generationId);
      // The page may still hold an older proposal until it refreshes.
      if (data.proposal) next.add(data.proposal.generationId);
      return next;
    });
    setFailure(null);
    setNotice(outcome);
    focusNext.current = outcome === "accepted" ? "content" : enabled && !blocked ? "generate" : "panel";
  }

  const status = run
    ? run.repairing
      ? t("status.repairing")
      : run.started
        ? t("status.writing")
        : t("status.connecting")
    : notice
      ? t(`status.${notice}`)
      : null;

  return (
    <section
      aria-labelledby="draft-title"
      className="surface-card mt-4 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <h2
          id="draft-title"
          ref={titleRef}
          tabIndex={-1}
          className="flex items-center gap-2 rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Sparkles className="size-4 text-highlight" aria-hidden="true" />
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      <div className="space-y-3 px-5 py-4">
        {!enabled ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {data.availability === "unconfigured" ? t("unconfigured") : t("disabled")}
          </p>
        ) : (
          <>
            {template ? (
              <div className="space-y-1.5">
                <label htmlFor="draft-template" className="text-sm font-medium">
                  {t("templateLabel")}
                </label>
                <NativeSelect
                  id="draft-template"
                  value={template.id}
                  disabled={running}
                  onChange={(event) => setTemplateId(event.target.value)}
                  className="w-full sm:max-w-md"
                  aria-describedby="draft-template-help"
                >
                  <TemplateGroup
                    label={t("workspaceGroup")}
                    templates={templates.filter((option) => option.scope === "workspace")}
                  />
                  <TemplateGroup
                    label={t("globalGroup")}
                    templates={templates.filter((option) => option.scope === "global")}
                  />
                </NativeSelect>
                <div id="draft-template-help" className="space-y-0.5 text-xs text-muted-foreground">
                  {template.description ? <p className="break-words">{template.description}</p> : null}
                  <p>{t("templateType", { type: tSchemas(`${template.outputSchema}.label`) })}</p>
                </div>
              </div>
            ) : (
              <p id="draft-blocked" className="text-sm text-muted-foreground">
                {manager
                  ? t.rich("noTemplatesManager", {
                      link: (chunks) => (
                        <Link
                          href={`/espaces/${workspaceId}/modeles`}
                          className="rounded-sm font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {chunks}
                        </Link>
                      ),
                    })
                  : t("noTemplates")}
              </p>
            )}

            {template && data.parsedCount === 0 ? (
              <p id="draft-blocked" className="text-sm text-muted-foreground">
                {t("noParsed")}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                ref={generateRef}
                type="button"
                shape="pill"
                disabled={blocked}
                // Stays focusable while a draft streams in, so the focus isn't lost.
                aria-disabled={running || undefined}
                aria-describedby={blocked ? "draft-blocked" : replaceHint ? "draft-replace" : undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onClick={() => {
                  if (!running) void generate();
                }}
              >
                {running ? (
                  <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles aria-hidden="true" />
                )}
                {t("generate")}
              </Button>
              {running ? (
                <Button ref={stopRef} type="button" variant="outline" shape="pill" onClick={stop}>
                  <Square aria-hidden="true" />
                  {t("stop")}
                </Button>
              ) : null}
            </div>
            {replaceHint ? (
              <p id="draft-replace" className="text-xs text-muted-foreground">
                {t("replaceHint")}
              </p>
            ) : null}
            {usageHint ? <p className="text-xs tabular-nums text-muted-foreground">{usageHint}</p> : null}
          </>
        )}

        {/* Always in the page, so screen readers announce each new status. */}
        <p role="status" className={status ? "text-sm text-muted-foreground" : "sr-only"}>
          {status}
        </p>
        {failure ? <FailureMessage failure={failure} /> : null}
      </div>

      {run ? (
        <div className="space-y-3 border-t px-5 py-4">
          {run.started?.truncated ? <TruncationNotice deliverables={run.started.deliverables} list /> : null}
          <h3 id="draft-live-title" className="flex items-center gap-2 text-sm font-medium">
            <span className="size-2 rounded-full bg-highlight motion-safe:animate-pulse" aria-hidden="true" />
            {t("liveTitle")}
          </h3>
          <div
            aria-labelledby="draft-live-title"
            aria-busy="true"
            role="region"
            className="break-words rounded-xl border bg-card px-4 py-3 text-sm leading-relaxed"
          >
            {preview ? (
              <Markdown
                headingLevel={4}
                headings="flatten"
                links="text"
                fallback={<p className="text-destructive">{t("previewError")}</p>}
              >
                {preview}
              </Markdown>
            ) : (
              <p className="text-muted-foreground">{t("liveWaiting")}</p>
            )}
          </div>
        </div>
      ) : proposal ? (
        <DraftProposalView
          key={proposal.generationId}
          proposal={proposal}
          current={data.content}
          sectionUpdatedAt={data.sectionUpdatedAt}
          focusOnMount={focusStreamed && proposal.generationId === streamed?.generationId}
          onDecided={(outcome) => decided(outcome, proposal.generationId)}
        />
      ) : null}
    </section>
  );
}

function TemplateGroup({ label, templates }: { label: string; templates: DraftTemplateOption[] }) {
  if (templates.length === 0) return null;
  return (
    <optgroup label={label}>
      {templates.map((template) => (
        <option key={template.id} value={template.id}>
          {template.title}
        </option>
      ))}
    </optgroup>
  );
}

/** Why no draft came, when to try again, and that the section kept its content. */
function FailureMessage({ failure }: { failure: Failure }) {
  const t = useTranslations("AiDraft");
  const message = failure.error === "network" ? t("network") : t(`errors.${failure.error}`, failure.values);

  let retry: string | null = null;
  if (failure.error === "rateLimited" || failure.error === "budgetExceeded") {
    const seconds = failure.retryAfter;
    const minutes = seconds === undefined ? undefined : Math.max(1, Math.ceil(seconds / 60));
    // A budget opens again on the first of the month, unless that is a few hours away.
    if (failure.error === "budgetExceeded" && (minutes === undefined || minutes > 24 * 60))
      retry = t("retryNextMonth");
    else if (minutes === undefined) retry = t("retryLater");
    else if (minutes <= 60) retry = t("retryMinutes", { count: minutes });
    else retry = t("retryHours", { count: Math.ceil(minutes / 60) });
  }

  return (
    <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
      <p className="text-destructive">
        {message}
        {retry ? ` ${retry}` : null}
      </p>
      <p className="mt-1 text-muted-foreground">{t("unchanged")}</p>
    </div>
  );
}
