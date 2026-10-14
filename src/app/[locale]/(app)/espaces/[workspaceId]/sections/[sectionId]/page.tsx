import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Link } from "@/i18n/navigation";
import { getDraftPanel } from "@/lib/ai/server";
import { STALE_PARSE_MS } from "@/lib/deliverables/parse/types";
import { canEditSection, sectionStatusSchema } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/workspaces/members";
import { isManager } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";
import { DeliverableList, type DeliverableRow } from "./deliverable-list";
import { DeliverableUploader } from "./deliverable-uploader";
import { DraftPanel } from "./draft-panel";
import type { ParseState } from "./parse-badge";
import { ParseWatcher } from "./parse-watcher";
import { SectionContent } from "./section-content";
import { SectionEditor } from "./section-editor";
import { SectionStatusControl } from "./section-status";

export const dynamic = "force-dynamic";

// "Relancer l'analyse" reads the file after the action answers, within this budget (Vercel).
export const maxDuration = 60;

type Params = Promise<{ locale: "fr"; workspaceId: string; sectionId: string }>;

async function loadSection(workspaceId: string, sectionId: string) {
  if (!uuidSchema.safeParse(workspaceId).success || !uuidSchema.safeParse(sectionId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("report_sections")
    .select(
      "id, title, instructions, status, assigned_to, content, content_updated_at, report:reports(id, title)",
    )
    .eq("id", sectionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspaceId, sectionId } = await params;
  const section = await loadSection(workspaceId, sectionId);
  const t = await getTranslations("Deliverables");
  return { title: section?.title ?? t("metaTitle") };
}

export default async function SectionPage({ params }: { params: Params }) {
  const { locale, workspaceId, sectionId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Deliverables");

  // RLS hides sections of other workspaces, so they look like missing ones.
  const section = await loadSection(workspaceId, sectionId);
  if (!section?.report) notFound();
  const access = await requireWorkspaceRole(workspaceId);
  if (!access) notFound();

  const canEdit = canEditSection(access, section.assigned_to);
  const supabase = await createClient();
  const [{ data: files }, members, draft] = await Promise.all([
    supabase
      .from("deliverables")
      .select(
        "id, file_name, mime_type, size_bytes, uploaded_by, uploaded_at, parse_status, parse_error, updated_at",
      )
      .eq("section_id", section.id)
      .not("uploaded_at", "is", null)
      .order("uploaded_at", { ascending: false }),
    getWorkspaceMembers(workspaceId),
    // Templates and the draft waiting for a decision, for the people who can act on them.
    canEdit ? getDraftPanel(workspaceId, section.id, access.userId) : null,
  ]);

  const names = new Map((members ?? []).map((member) => [member.userId, member.name]));
  const mine = section.assigned_to === access.userId;
  const status = sectionStatusSchema.catch("not_started").parse(section.status);
  const staleBefore = Date.now() - STALE_PARSE_MS;
  const rows: DeliverableRow[] = (files ?? []).map((file) => {
    const old = new Date(file.updated_at).getTime() < staleBefore;
    // A claimed read this old has died. A pending file this old was never
    // claimed, for example one uploaded before files were read.
    const parseState: ParseState = file.parse_status === "processing" && old ? "stale" : file.parse_status;
    const notStarted = file.parse_status === "pending" && old;
    return {
      id: file.id,
      name: file.file_name,
      mimeType: file.mime_type,
      size: file.size_bytes,
      uploadedAt: file.uploaded_at ?? "",
      uploaderName: names.get(file.uploaded_by) ?? null,
      parseState,
      parseError: file.parse_error,
      notStarted,
      // Same rule as the delete policy: managers, or the uploader while the section is theirs.
      canDelete: canEdit && (isManager(access.role) || file.uploaded_by === access.userId),
      canRetry: canEdit && (parseState === "failed" || parseState === "stale" || notStarted),
    };
  });
  // With their state, so the watcher starts over when a pending file is claimed.
  const reading = rows
    .filter((row) => row.parseState === "processing" || (row.parseState === "pending" && !row.notStarted))
    .map((row) => `${row.id}:${row.parseState}`)
    .join(" ");

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
      <Link
        href={`/rapports/${section.report.id}`}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{section.report.title}</span>
      </Link>

      <header className="mt-4">
        <h1 className="break-words text-h2 text-foreground">{section.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          {canEdit ? null : <StatusBadge status={status} />}
          <span>
            {section.assigned_to
              ? t("assignedTo", { name: names.get(section.assigned_to) ?? t("unknownMember") })
              : t("unassigned")}
          </span>
          {mine ? (
            <span className="rounded-full bg-highlight/10 px-2 py-0.5 text-[11px] font-medium text-highlight">
              {t("yourSection")}
            </span>
          ) : null}
        </div>
        {canEdit ? (
          <div className="mt-4">
            <SectionStatusControl sectionId={section.id} status={status} />
          </div>
        ) : null}
        {section.instructions ? (
          <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{section.instructions}</p>
        ) : null}
      </header>

      {canEdit ? (
        <SectionEditor
          key={section.id}
          sectionId={section.id}
          // The text and its version come from the same read as the draft panel's.
          content={draft ? draft.content : section.content}
          version={draft ? draft.sectionUpdatedAt : section.content_updated_at}
          draftHint={draft?.availability === "enabled"}
        />
      ) : (
        <SectionContent content={section.content} draftHint={false} />
      )}
      {draft ? (
        <DraftPanel
          workspaceId={workspaceId}
          sectionId={section.id}
          data={draft}
          manager={isManager(access.role)}
        />
      ) : null}

      {canEdit ? (
        <DeliverableUploader sectionId={section.id} />
      ) : (
        <p className="mt-6 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {access.role === "viewer" ? t("readOnlyViewer") : t("readOnlyExpert")}
        </p>
      )}

      <DeliverableList files={rows} canEdit={canEdit} />
      <ParseWatcher reading={reading} />
    </div>
  );
}
