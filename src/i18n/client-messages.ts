/**
 * Messages sent to Client Components, per part of the app (KRB-154).
 *
 * Without a `messages` prop, NextIntlClientProvider puts all of
 * messages/fr.json (about 70 kB) in the RSC payload of every page. Each
 * scope lists only the namespaces its Client Components read with
 * useTranslations, and <ClientMessages scope="..."> in a layout sends just
 * those. A nested provider replaces the parent's messages, it does not add
 * to them, so a scope lists everything its subtree needs.
 *
 * src/i18n/client-messages.test.ts walks the imports of every route and fails
 * when a Client Component reads a namespace its scope does not send.
 */
export const CLIENT_MESSAGE_SCOPES = {
  /**
   * app/[locale]/layout.tsx: error.tsx, the update banner, the landing page
   * header, and pages whose segment adds no scope of its own.
   */
  root: ["Common", "Errors", "Landing.nav", "Pwa", "Theme"],
  /** Sign-in, sign-up and password forms. */
  auth: ["Auth"],
  invitation: ["Invitation", "Workspaces"],
  /**
   * app/[locale]/(app)/layout.tsx: sidebar, mobile menu (with the legal links),
   * command palette, and the "Nouveau rapport" dialog of the dashboard.
   */
  appShell: [
    "AppShell",
    "CommandPalette",
    "Common",
    "Dashboard.filters",
    "Dashboard.reports.create",
    "Legal.nav",
    "Notifications",
    "SectionStatus",
    "Theme",
    "Workspaces",
  ],
  workspaceWizard: ["WorkspaceWizard", "Workspaces"],
  members: ["Members", "Workspaces"],
  /** /fr/compte: name, transfer and deletion forms. Auth for the password field and the captcha. */
  account: ["Account", "Auth"],
  prompts: ["Prompts"],
  section: ["AiDraft", "Deliverables", "Prompts.outputSchemas", "SectionEditor", "SectionStatus"],
  report: ["Report", "ReportExport", "ReportStatus", "SectionStatus", "Workspaces"],
  /** The organization's billing page and the payment return page. */
  billing: ["Billing.checkout", "Billing.offers", "Billing.return"],
} as const satisfies Record<string, readonly string[]>;

export type ClientMessageScope = keyof typeof CLIENT_MESSAGE_SCOPES;

type MessageTree = { [key: string]: MessageTree | string };

/**
 * Copies the given namespaces out of the full messages. "Dashboard.filters"
 * copies only that key and keeps its nesting. A missing path throws, so a
 * typo in a scope fails the build instead of showing raw keys.
 */
export function pickMessages(messages: MessageTree, paths: readonly string[]): MessageTree {
  const picked: MessageTree = {};
  for (const path of paths) {
    const keys = path.split(".");
    let source: MessageTree | string = messages;
    let target = picked;
    keys.forEach((key, index) => {
      const value = typeof source === "string" ? undefined : source[key];
      if (value === undefined) {
        throw new Error(`Unknown message namespace "${path}"`);
      }
      source = value;
      if (index === keys.length - 1) {
        target[key] = source;
        return;
      }
      const next = target[key];
      target = typeof next === "object" ? next : (target[key] = {});
    });
  }
  return picked;
}
