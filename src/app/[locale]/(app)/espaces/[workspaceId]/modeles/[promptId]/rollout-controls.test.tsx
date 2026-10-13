import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../../messages/fr.json";
import { endRollout, rollbackPublish, setRolloutPercent, startRollout } from "../rollout-actions";
import {
  RollbackPublish,
  RolloutBanner,
  StartRollout,
  type RolloutInfo,
  type RolloutReach,
  type VersionRef,
} from "./rollout-controls";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={`/fr${href}`} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => router,
}));
vi.mock("../rollout-actions", () => ({
  startRollout: vi.fn(),
  setRolloutPercent: vi.fn(),
  endRollout: vi.fn(),
  rollbackPublish: vi.fn(),
}));

const WORKSPACE_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const LIBRARY = `/espaces/${WORKSPACE_ID}/modeles`;
const ROLLOUT_ID = "7a7a7a7a-1111-4222-8333-444455556666";
const V3: VersionRef = { id: "33333333-3333-4333-8333-333333333333", version: 3 };
const V4: VersionRef = { id: "44444444-4444-4444-8444-444444444444", version: 4 };
const V5: VersionRef = { id: "55555555-5555-4555-8555-555555555555", version: 5 };

const ROLLOUT: RolloutInfo = {
  id: ROLLOUT_ID,
  candidate: V4,
  percent: 20,
  createdAt: "2026-10-12T14:05:00.000000+00:00",
};

function withIntl(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Porto-Novo">
      {children}
    </NextIntlClientProvider>
  );
}

function renderStart(published: VersionRef | null = V3, otherRollout: VersionRef | null = null) {
  return render(
    withIntl(
      <StartRollout
        workspaceId={WORKSPACE_ID}
        versionId={V4.id}
        libraryHref={LIBRARY}
        published={published}
        otherRollout={otherRollout}
      />,
    ),
  );
}

function renderBanner({
  reach = "workspace",
  currentVersionId = V4.id,
  canManage = true,
}: { reach?: RolloutReach; currentVersionId?: string; canManage?: boolean } = {}) {
  return render(
    withIntl(
      <RolloutBanner
        workspaceId={WORKSPACE_ID}
        libraryHref={LIBRARY}
        rollout={ROLLOUT}
        reach={reach}
        currentVersionId={currentVersionId}
        base={V3}
        canManage={canManage}
      />,
    ),
  );
}

const percentInput = () => screen.getByRole("spinbutton", { name: "Part des nouveaux brouillons" });

/** The banner's sentence, whose version can be a link and whose date is a <time>. */
const bannerText = () =>
  screen.getByRole("heading", { name: "Déploiement progressif en cours" }).nextElementSibling;

beforeEach(() => {
  router.refresh.mockReset();
  router.push.mockReset();
  vi.mocked(startRollout).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(setRolloutPercent).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(endRollout).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(rollbackPublish).mockReset().mockResolvedValue({ ok: true, versionId: V3.id });
});

describe("StartRollout", () => {
  it("is disabled with a hint when the template has no published version", () => {
    renderStart(null);
    const button = screen.getByRole("button", { name: "Déployer progressivement" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/Publiez d'abord une version de ce modèle/);
    expect(percentInput()).toBeDisabled();
  });

  it("is disabled with a link to the version already being rolled out", () => {
    renderStart(V3, V5);
    const button = screen.getByRole("button", { name: "Déployer progressivement" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/La version 5 de ce modèle est déjà en cours de déploiement/);
    expect(screen.getByRole("link", { name: "version 5" })).toHaveAttribute("href", `/fr${LIBRARY}/${V5.id}`);
  });

  it("explains the rollout and starts it with a preset share", async () => {
    const user = userEvent.setup();
    renderStart();
    expect(screen.getByText(/les autres gardent la version 3 publiée/)).toBeVisible();
    expect(percentInput()).toHaveValue(10);

    const preset = screen.getByRole("button", { name: /^25\s%$/ });
    await user.click(preset);
    expect(percentInput()).toHaveValue(25);
    expect(preset).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Déployer progressivement" }));
    expect(startRollout).toHaveBeenCalledWith(WORKSPACE_ID, V4.id, 25);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("refuses a share outside 1 to 99", async () => {
    const user = userEvent.setup();
    renderStart();
    await user.clear(percentInput());
    await user.type(percentInput(), "150");
    expect(percentInput()).toHaveAccessibleDescription("Saisissez un nombre entier entre 1 et 99.");
    expect(screen.getByRole("button", { name: "Déployer progressivement" })).toBeDisabled();
  });

  it("shows the error the action returns", async () => {
    const user = userEvent.setup();
    vi.mocked(startRollout).mockResolvedValue({ ok: false, error: "conflict" });
    renderStart();
    await user.click(screen.getByRole("button", { name: "Déployer progressivement" }));
    expect(
      await screen.findByText(
        "Un autre déploiement de ce modèle est déjà en cours. Rechargez la page pour le voir.",
      ),
    ).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("RolloutBanner on the candidate's page", () => {
  it("says the share, since when and which version the other sections keep", () => {
    renderBanner();
    expect(screen.getByRole("heading", { name: "Déploiement progressif en cours" })).toBeVisible();
    expect(bannerText()).toHaveTextContent(
      "La version 4 sert 20 % des nouveaux brouillons de ce modèle depuis le 12 octobre 2026 à 15:05.",
    );
    expect(screen.getByText("Les autres sections gardent la version 3, publiée.")).toBeVisible();
    // The page is the candidate's: no link to itself.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("changes the share", async () => {
    const user = userEvent.setup();
    renderBanner();
    const save = screen.getByRole("button", { name: "Modifier la part" });
    expect(percentInput()).toHaveValue(20);
    expect(save).toBeDisabled();

    await user.clear(percentInput());
    await user.type(percentInput(), "35");
    await user.click(save);
    expect(setRolloutPercent).toHaveBeenCalledWith(WORKSPACE_ID, ROLLOUT_ID, 35);
    expect(await screen.findByText(/Part enregistrée : 35\s% des nouveaux brouillons\./)).toBeVisible();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("asks before publishing the candidate for everyone", async () => {
    const user = userEvent.setup();
    renderBanner();
    await user.click(screen.getByRole("button", { name: "Publier pour tous" }));

    const dialog = await screen.findByRole("dialog", { name: "Publier la version 4 pour tous ?" });
    expect(dialog).toHaveAccessibleDescription(
      "Toutes les sections utiliseront la version 4 pour leurs prochains brouillons. La version 3, publiée jusqu'ici, sera archivée et restera dans l'historique.",
    );
    expect(endRollout).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Publier pour tous" }));
    expect(endRollout).toHaveBeenCalledWith(WORKSPACE_ID, ROLLOUT_ID, true);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("asks before stopping the rollout, and nothing happens on cancel", async () => {
    const user = userEvent.setup();
    renderBanner();
    await user.click(screen.getByRole("button", { name: "Arrêter le déploiement" }));

    let dialog = await screen.findByRole("dialog", { name: "Arrêter le déploiement ?" });
    expect(dialog).toHaveAccessibleDescription(
      "Toutes les sections reviennent à la version 3 pour leurs prochains brouillons. La version 4 reste un brouillon : vous pourrez la déployer de nouveau ou la publier.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(endRollout).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Arrêter le déploiement" }));
    dialog = await screen.findByRole("dialog", { name: "Arrêter le déploiement ?" });
    await user.click(within(dialog).getByRole("button", { name: "Arrêter le déploiement" }));
    expect(endRollout).toHaveBeenCalledWith(WORKSPACE_ID, ROLLOUT_ID, false);
  });

  it("says when the rollout already ended", async () => {
    const user = userEvent.setup();
    vi.mocked(endRollout).mockResolvedValue({ ok: false, error: "ended" });
    renderBanner();
    await user.click(screen.getByRole("button", { name: "Publier pour tous" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Publier pour tous" }));
    expect(
      await screen.findByText(
        "Ce déploiement est déjà terminé. Rechargez la page pour voir la version publiée.",
      ),
    ).toBeVisible();
  });
});

describe("RolloutBanner, read only", () => {
  it("links to the candidate from another version's page, without controls", () => {
    renderBanner({ currentVersionId: V3.id });
    expect(screen.getByRole("link", { name: "version 4" })).toHaveAttribute("href", `/fr${LIBRARY}/${V4.id}`);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("has no controls for members who don't manage the workspace", () => {
    renderBanner({ canManage: false });
    expect(bannerText()).toHaveTextContent("La version 4 sert 20 % des nouveaux brouillons");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("describes a global rollout", () => {
    renderBanner({ reach: "global", canManage: false, currentVersionId: V3.id });
    expect(bannerText()).toHaveTextContent(
      "La version 4 de ce modèle global est déployée à 20 % des générations depuis le 12 octobre 2026 à 15:05.",
    );
    expect(screen.queryByText(/Les autres sections gardent/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("describes a global version previewed in this workspace", () => {
    renderBanner({ reach: "preview", canManage: false });
    expect(bannerText()).toHaveTextContent(
      "La version 4 de ce modèle global est déployée pour cet espace en avant-première, sur 20 % des générations, depuis le 12 octobre 2026 à 15:05.",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("RollbackPublish", () => {
  function renderRollback() {
    return render(
      withIntl(
        <RollbackPublish workspaceId={WORKSPACE_ID} libraryHref={LIBRARY} current={V5} previous={V3} />,
      ),
    );
  }

  it("names the version that comes back and opens it once published again", async () => {
    const user = userEvent.setup();
    renderRollback();
    const button = screen.getByRole("button", { name: "Revenir à la version précédente" });
    expect(button).toHaveAccessibleDescription("Remet en service la version 3, publiée avant celle-ci.");
    await user.click(button);

    const dialog = await screen.findByRole("dialog", { name: "Revenir à la version 3 ?" });
    expect(dialog).toHaveAccessibleDescription(
      "La version 3 redevient la version publiée et sert tous les nouveaux brouillons. La version 5 est archivée et reste dans l'historique.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Revenir à la version 3" }));
    expect(rollbackPublish).toHaveBeenCalledWith(WORKSPACE_ID, V5.id);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`${LIBRARY}/${V3.id}`));
  });

  it("stays on the page with the error when nothing was published before", async () => {
    const user = userEvent.setup();
    vi.mocked(rollbackPublish).mockResolvedValue({ ok: false, error: "noPrevious" });
    renderRollback();
    await user.click(screen.getByRole("button", { name: "Revenir à la version précédente" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Revenir à la version 3" }));
    expect(await screen.findByText(/Aucune version n'a été publiée avant celle-ci/)).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
  });
});
