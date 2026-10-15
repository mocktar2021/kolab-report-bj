"use client";

import { useId, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Send, Split, Square, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  endRollout,
  rollbackPublish,
  setRolloutPercent,
  startRollout,
  type RolloutActionError,
} from "../rollout-actions";

// Progressive rollout of a draft version and rollback of a publish, on the
// version page (Story KRB-17). The database checks the rules again: managers
// only, a draft candidate, a published version to compare with, and one
// active rollout per template.

/** A version of the template, by id and number. */
export type VersionRef = { id: string; version: number };

export type RolloutInfo = {
  id: string;
  candidate: VersionRef;
  percent: number;
  createdAt: string;
};

/**
 * Who the rollout reaches: "workspace" for a template of this workspace,
 * "global" for a global template rolled out everywhere, "preview" for a
 * global template tried in this workspace only.
 */
export type RolloutReach = "workspace" | "global" | "preview";

const PRESETS = [10, 25, 50] as const;

const DATE_FORMAT = {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
} as const;

/** The whole number typed in the field, or null when it isn't one from 1 to 99. */
function parsePercent(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const percent = Number(trimmed);
  return percent >= 1 && percent <= 99 ? percent : null;
}

function usePercent() {
  const format = useFormatter();
  return (percent: number) => format.number(percent / 100, { style: "percent", maximumFractionDigits: 0 });
}

/** Runs a rollout action and keeps its error, like VersionActions does for statuses. */
function useRolloutAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<RolloutActionError | null>(null);

  function run<T extends { ok: true }>(
    action: () => Promise<T | { ok: false; error: RolloutActionError }>,
    done: (result: T) => void,
  ) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        done(result);
      } catch {
        setError("generic");
      }
    });
  }

  return { pending, error, run };
}

function ActionError({ error }: { error: RolloutActionError | null }) {
  const t = useTranslations("Prompts.rollout");
  return (
    <div role="status" aria-live="polite" className="text-sm">
      {error ? <p className="mt-2 text-destructive">{t(`errors.${error}`)}</p> : null}
    </div>
  );
}

type PercentFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid: boolean;
  /** A button on the same line as the field. */
  action?: React.ReactNode;
};

/** Number field from 1 to 99 with a few common shares one click away. */
function PercentField({ id, value, onChange, disabled, invalid, action }: PercentFieldProps) {
  const t = useTranslations("Prompts.rollout");
  const percentLabel = usePercent();
  const helpId = `${id}-help`;

  return (
    <div>
      <Label htmlFor={id}>{t("percentLabel")}</Label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <div className="relative w-24">
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            step={1}
            value={value}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={helpId}
            onChange={(event) => onChange(event.target.value)}
            className="pr-8 tabular-nums"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
          >
            %
          </span>
        </div>
        <div role="group" aria-label={t("presetsLabel")} className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <Button
              key={preset}
              type="button"
              variant="outline"
              size="sm"
              shape="pill"
              disabled={disabled}
              aria-pressed={parsePercent(value) === preset}
              onClick={() => onChange(String(preset))}
              className="tabular-nums aria-pressed:border-highlight/50 aria-pressed:text-highlight"
            >
              {percentLabel(preset)}
            </Button>
          ))}
        </div>
        {action}
      </div>
      <p id={helpId} className={cn("mt-1.5 text-xs", invalid ? "text-destructive" : "text-muted-foreground")}>
        {invalid ? t("percentInvalid") : t("percentHelp")}
      </p>
    </div>
  );
}

type StartRolloutProps = {
  workspaceId: string;
  versionId: string;
  libraryHref: string;
  /** The published version of the template, which keeps serving the other sections. */
  published: VersionRef | null;
  /** Another version of the template already being rolled out. */
  otherRollout: VersionRef | null;
};

/** Managers start serving a draft to a share of the new drafts. */
export function StartRollout({
  workspaceId,
  versionId,
  libraryHref,
  published,
  otherRollout,
}: StartRolloutProps) {
  const t = useTranslations("Prompts.rollout");
  const router = useRouter();
  const fieldId = useId();
  const hintId = useId();
  const [value, setValue] = useState("10");
  const { pending, error, run } = useRolloutAction();
  const percent = parsePercent(value);
  const blocked = published === null || otherRollout !== null;

  function start() {
    if (percent === null || blocked) return;
    run(
      () => startRollout(workspaceId, versionId, percent),
      () => router.refresh(),
    );
  }

  return (
    <section
      aria-labelledby={`${fieldId}-title`}
      className="surface-card mt-6 max-w-3xl rounded-2xl border p-5 shadow-sm"
    >
      <h2 id={`${fieldId}-title`} className="flex items-center gap-2 font-medium">
        <Split className="size-4 text-highlight" aria-hidden="true" />
        {t("startTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {published ? t("startIntro", { version: published.version }) : t("startIntroNoBase")}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{t("startEnd")}</p>

      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
        <PercentField
          id={fieldId}
          value={value}
          onChange={setValue}
          disabled={pending || blocked}
          invalid={!blocked && percent === null}
        />
        <div className="space-y-2">
          <Button
            type="submit"
            shape="pill"
            disabled={pending || blocked || percent === null}
            aria-describedby={blocked ? hintId : undefined}
          >
            <Split aria-hidden="true" />
            {t("start")}
          </Button>
          {blocked ? (
            <p id={hintId} className="text-sm text-muted-foreground">
              {otherRollout
                ? t.rich("otherActive", {
                    version: otherRollout.version,
                    link: (chunks) => (
                      <Link
                        href={`${libraryHref}/${otherRollout.id}`}
                        className="rounded-sm font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {chunks}
                      </Link>
                    ),
                  })
                : t("noPublished")}
            </p>
          ) : null}
        </div>
      </form>
      <ActionError error={error} />
    </section>
  );
}

type RolloutBannerProps = {
  workspaceId: string;
  libraryHref: string;
  rollout: RolloutInfo;
  reach: RolloutReach;
  /** The version the page shows. */
  currentVersionId: string;
  /** The published version, which serves the sections outside the rollout. */
  base: VersionRef | null;
  /** Managers, on the candidate's page of a workspace template. */
  canManage: boolean;
  /**
   * Set when the workspace is read-only (KRB-178): the share and the publish
   * stay visible, disabled, with this reason. Ending the rollout still works.
   */
  readOnlyReason?: string;
};

/** Says which version is being rolled out, to what share and since when. */
export function RolloutBanner({
  workspaceId,
  libraryHref,
  rollout,
  reach,
  currentVersionId,
  base,
  canManage,
  readOnlyReason,
}: RolloutBannerProps) {
  const t = useTranslations("Prompts.rollout");
  const format = useFormatter();
  const percentLabel = usePercent();
  const onCandidate = rollout.candidate.id === currentVersionId;
  const message =
    reach === "preview" ? "bannerPreview" : reach === "global" ? "bannerGlobal" : "bannerWorkspace";

  return (
    <div className="mt-5 max-w-3xl rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm text-sky-950 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100">
      <h2 className="flex items-center gap-2 font-medium">
        <Split className="size-4 shrink-0" aria-hidden="true" />
        {t("bannerTitle")}
      </h2>
      <p className="mt-1">
        {t.rich(message, {
          version: rollout.candidate.version,
          percent: percentLabel(rollout.percent),
          date: format.dateTime(new Date(rollout.createdAt), DATE_FORMAT),
          link: (chunks) =>
            onCandidate ? (
              <span className="font-medium">{chunks}</span>
            ) : (
              <Link
                href={`${libraryHref}/${rollout.candidate.id}`}
                className="rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {chunks}
              </Link>
            ),
          time: (chunks) => <time dateTime={rollout.createdAt}>{chunks}</time>,
        })}
      </p>
      {reach === "workspace" && base ? (
        <p className="mt-1">{t("bannerBase", { version: base.version })}</p>
      ) : null}
      {reach === "workspace" ? (
        <p className="mt-1 text-sky-900/80 dark:text-sky-100/80">{t("bannerStable")}</p>
      ) : null}
      {canManage && onCandidate ? (
        <CandidateControls
          workspaceId={workspaceId}
          rollout={rollout}
          base={base}
          readOnlyReason={readOnlyReason}
        />
      ) : null}
    </div>
  );
}

type CandidateControlsProps = {
  workspaceId: string;
  rollout: RolloutInfo;
  base: VersionRef | null;
  readOnlyReason?: string;
};

/**
 * Change the share, publish the candidate for everyone, or stop the rollout.
 * In read-only, only stopping is left: it tidies up and publishes nothing.
 */
function CandidateControls({ workspaceId, rollout, base, readOnlyReason }: CandidateControlsProps) {
  const t = useTranslations("Prompts.rollout");
  const tPrompts = useTranslations("Prompts");
  const router = useRouter();
  const percentLabel = usePercent();
  const fieldId = useId();
  const readOnlyId = useId();
  const readOnly = Boolean(readOnlyReason);
  const [value, setValue] = useState(String(rollout.percent));
  // The kind stays set while the dialog closes, so its text doesn't change during the animation.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState<"promote" | "cancel">("promote");
  const [saved, setSaved] = useState<number | null>(null);
  const { pending, error, run } = useRolloutAction();
  const percent = parsePercent(value);
  const version = rollout.candidate.version;
  const baseVersion = base ? String(base.version) : "none";

  function savePercent() {
    if (readOnly || percent === null || percent === rollout.percent) return;
    setSaved(null);
    run(
      () => setRolloutPercent(workspaceId, rollout.id, percent),
      () => {
        setSaved(percent);
        router.refresh();
      },
    );
  }

  function ask(kind: "promote" | "cancel") {
    setConfirmKind(kind);
    setConfirmOpen(true);
  }

  function end(promote: boolean) {
    setConfirmOpen(false);
    setSaved(null);
    run(
      () => endRollout(workspaceId, rollout.id, promote),
      () => router.refresh(),
    );
  }

  return (
    <div className="mt-4 space-y-4 border-t border-sky-200 pt-4 text-foreground dark:border-sky-500/20">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          savePercent();
        }}
      >
        <PercentField
          id={fieldId}
          value={value}
          onChange={setValue}
          disabled={pending || readOnly}
          invalid={!readOnly && percent === null}
          action={
            <Button
              type="submit"
              variant="outline"
              shape="pill"
              disabled={pending || readOnly || percent === null || percent === rollout.percent}
              aria-describedby={readOnly ? readOnlyId : undefined}
            >
              {t("savePercent")}
            </Button>
          }
        />
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          shape="pill"
          disabled={pending || readOnly}
          aria-describedby={readOnly ? readOnlyId : undefined}
          onClick={() => ask("promote")}
        >
          <Send aria-hidden="true" />
          {t("promote")}
        </Button>
        <Button type="button" variant="ghost" shape="pill" disabled={pending} onClick={() => ask("cancel")}>
          <Square aria-hidden="true" />
          {t("cancelRollout")}
        </Button>
      </div>
      {readOnly ? (
        <p id={readOnlyId} className="text-xs text-muted-foreground">
          {readOnlyReason}
        </p>
      ) : null}
      <div role="status" aria-live="polite" className="text-sm">
        {error ? (
          <p className="text-destructive">{t(`errors.${error}`)}</p>
        ) : saved !== null ? (
          <p className="text-muted-foreground">{t("percentSaved", { percent: percentLabel(saved) })}</p>
        ) : null}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="p-6">
          <DialogTitle>
            {confirmKind === "cancel" ? t("cancelTitle") : t("promoteTitle", { version })}
          </DialogTitle>
          <DialogDescription className="mt-2">
            {confirmKind === "cancel"
              ? t("cancelDescription", { version, base: baseVersion })
              : t("promoteDescription", { version, base: baseVersion })}
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tPrompts("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant={confirmKind === "cancel" ? "destructive" : "default"}
              disabled={pending}
              onClick={() => end(confirmKind === "promote")}
            >
              {confirmKind === "cancel" ? t("cancelConfirm") : t("promoteConfirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type RollbackPublishProps = {
  workspaceId: string;
  libraryHref: string;
  /** The published version the page shows. */
  current: VersionRef;
  /** The version published before it, which comes back. */
  previous: VersionRef;
};

/** Puts back the version published before this one, in one step. */
export function RollbackPublish({ workspaceId, libraryHref, current, previous }: RollbackPublishProps) {
  const t = useTranslations("Prompts.rollout");
  const tPrompts = useTranslations("Prompts");
  const router = useRouter();
  const helpId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { pending, error, run } = useRolloutAction();

  function rollback() {
    setConfirmOpen(false);
    run(
      () => rollbackPublish(workspaceId, current.id),
      (result) => router.push(`${libraryHref}/${result.versionId}`),
    );
  }

  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="outline"
        shape="pill"
        disabled={pending}
        aria-describedby={helpId}
        onClick={() => setConfirmOpen(true)}
      >
        <Undo2 aria-hidden="true" />
        {t("rollback")}
      </Button>
      <p id={helpId} className="mt-1.5 text-xs text-muted-foreground">
        {t("rollbackHelp", { version: previous.version })}
      </p>
      <ActionError error={error} />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="p-6">
          <DialogTitle>{t("rollbackTitle", { version: previous.version })}</DialogTitle>
          <DialogDescription className="mt-2">
            {t("rollbackDescription", { version: previous.version, current: current.version })}
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tPrompts("cancel")}
              </Button>
            </DialogClose>
            <Button type="button" disabled={pending} onClick={rollback}>
              {t("rollbackConfirm", { version: previous.version })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
