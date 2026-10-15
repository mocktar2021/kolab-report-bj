import { getTranslations } from "next-intl/server";
import { formatBillingDate } from "@/lib/billing/format";
import type { BillingOverview } from "@/lib/billing/state";
import { meterPercent } from "@/lib/billing/usage";
import { cn } from "@/lib/utils";

/** One figure of the meter: what is used, against the limit when there is one. */
function MeterTile({
  id,
  label,
  value,
  help,
  used,
  max,
}: {
  id: string;
  label: string;
  value: string;
  help: string;
  used: number;
  max: number | null;
}) {
  const percent = meterPercent(used, max);
  const full = max !== null && used >= max;
  return (
    <li className="surface-card flex h-full flex-col rounded-2xl border p-4 shadow-sm sm:p-5">
      <h3 id={id} className="text-sm font-medium text-muted-foreground">
        {label}
      </h3>
      <p aria-describedby={`${id}-help`} className="mt-2 text-base font-medium tabular-nums text-foreground">
        {value}
      </p>
      {max !== null ? (
        // The sentence above says the same, so the bar is hidden from screen readers.
        <div aria-hidden="true" className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", full ? "bg-amber-500" : "bg-highlight")}
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
      <p id={`${id}-help`} className="mt-auto pt-3 text-xs text-muted-foreground">
        {help}
      </p>
    </li>
  );
}

/**
 * The usage meter of the organization's subscription (ADR 001, 3.4):
 * members with open invitations, active reports, AI drafts and what the
 * packs have left. Passes have their own line, below.
 */
export async function UsageMeter({ overview }: { overview: BillingOverview }) {
  const t = await getTranslations("Billing");
  const { subscription, packs } = overview;
  const { usage, limits, drafts } = subscription;
  const packsLeft = packs.reduce((sum, pack) => sum + Math.max(pack.drafts - pack.used, 0), 0);
  const nextPack = packs[0];
  const draftsPeriod = drafts?.period ?? "month";
  const peopleValues = { members: usage.members, invitations: usage.invitations };

  return (
    <section aria-labelledby="usage-title" className="mt-8">
      <h2 id="usage-title" className="text-h3 text-foreground">
        {t("page.usageTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("page.usageDescription")}</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <MeterTile
          id="meter-members"
          label={t("meter.members")}
          value={
            limits.maxMembers === null
              ? t("meter.membersUnlimited", peopleValues)
              : t("meter.membersUsage", { ...peopleValues, max: limits.maxMembers })
          }
          help={t("meter.membersHelp")}
          used={usage.members + usage.invitations}
          max={limits.maxMembers}
        />
        <MeterTile
          id="meter-reports"
          label={t("meter.reports")}
          value={
            limits.maxReports === null
              ? t("meter.reportsUnlimited", { count: usage.activeReports })
              : t("meter.reportsUsage", { count: usage.activeReports, max: limits.maxReports })
          }
          help={t("meter.reportsHelp")}
          used={usage.activeReports}
          max={limits.maxReports}
        />
        {drafts ? (
          <MeterTile
            id="meter-drafts"
            label={draftsPeriod === "month" ? t("meter.draftsMonth") : t("meter.draftsTotal")}
            value={
              drafts.allowance === null
                ? t("meter.draftsUnlimited", { count: drafts.used })
                : t("meter.draftsUsage", { count: drafts.used, max: drafts.allowance })
            }
            help={draftsPeriod === "month" ? t("meter.draftsHelpMonth") : t("meter.draftsHelpTotal")}
            used={drafts.used}
            max={drafts.allowance}
          />
        ) : null}
        <MeterTile
          id="meter-packs"
          label={t("meter.packs")}
          value={t("meter.packsLeft", { count: packsLeft })}
          help={
            nextPack
              ? t("meter.packsHelp", { date: formatBillingDate(nextPack.expiresAt) })
              : t("meter.packsNone")
          }
          used={0}
          max={null}
        />
      </ul>
    </section>
  );
}

/** One line per mission workspace: the state of its pass and what it uses. */
export async function PassList({ overview }: { overview: BillingOverview }) {
  if (overview.passes.length === 0) return null;
  const t = await getTranslations("Billing");

  return (
    <section aria-labelledby="passes-title" className="surface-card mt-8 rounded-2xl border shadow-sm">
      <div className="border-b px-5 py-4">
        <h2 id="passes-title" className="font-medium text-foreground">
          {t("page.passesTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("page.passesDescription")}</p>
      </div>
      <ul className="divide-y">
        {overview.passes.map((pass) => {
          const state =
            !pass.plan || !pass.endsAt || !pass.graceEndsAt
              ? t("page.passState.none")
              : pass.state === "grace"
                ? t("page.passState.grace", {
                    date: formatBillingDate(pass.endsAt),
                    graceEnd: formatBillingDate(pass.graceEndsAt),
                  })
                : pass.state === "read_only"
                  ? t("page.passState.read_only", { date: formatBillingDate(pass.graceEndsAt) })
                  : t("page.passState.active", { date: formatBillingDate(pass.endsAt) });
          const members = { members: pass.usage.members, invitations: pass.usage.invitations };
          const usage = t("page.passUsage", {
            members:
              pass.limits.maxMembers === null
                ? t("meter.membersUnlimited", members)
                : t("meter.membersUsage", { ...members, max: pass.limits.maxMembers }),
            reports:
              pass.limits.maxReports === null
                ? t("meter.reportsUnlimited", { count: pass.usage.reports })
                : t("meter.missionReports", { count: pass.usage.reports, max: pass.limits.maxReports }),
            drafts:
              pass.drafts && pass.drafts.allowance !== null
                ? t("meter.draftsUsage", { count: pass.drafts.used, max: pass.drafts.allowance })
                : t("meter.draftsUnlimited", { count: pass.drafts?.used ?? 0 }),
          });
          return (
            <li key={pass.workspaceId} className="px-5 py-4 text-sm">
              {/* Named for the organization owner and the workspace's members only. */}
              <p className="font-medium text-foreground">{pass.workspaceName ?? t("page.hiddenWorkspace")}</p>
              <p className="mt-0.5 text-muted-foreground">{state}</p>
              {pass.plan ? <p className="mt-0.5 tabular-nums text-muted-foreground">{usage}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
