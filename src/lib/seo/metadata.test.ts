// @vitest-environment node
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { publicPageMetadata, SHARE_IMAGE } from "./metadata";

// The server translator, with the real French messages.
vi.mock("next-intl/server", () => ({
  getTranslations: ({ namespace }: { namespace: "Metadata" }) =>
    Promise.resolve(
      createTranslator({
        locale: "fr",
        messages,
        namespace,
        onError: (error) => {
          throw error;
        },
      }),
    ),
}));

describe("publicPageMetadata", () => {
  it("gives the page its canonical address and its preview", async () => {
    const metadata = await publicPageMetadata({
      locale: "fr",
      path: "/tarifs",
      title: "Tarifs",
      description: "Les offres.",
    });

    expect(metadata.title).toBe("Tarifs");
    expect(metadata.alternates).toEqual({
      canonical: "/fr/tarifs",
      languages: { fr: "/fr/tarifs", "x-default": "/fr/tarifs" },
    });
    expect(metadata.openGraph).toMatchObject({
      url: "/fr/tarifs",
      title: "Tarifs · KolabReport",
      description: "Les offres.",
      locale: "fr_FR",
      siteName: "KolabReport",
      images: [{ ...SHARE_IMAGE, alt: messages.Metadata.shareImageAlt }],
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", title: "Tarifs · KolabReport" });
  });

  it("keeps an absolute title as it is", async () => {
    const metadata = await publicPageMetadata({
      locale: "fr",
      path: "/",
      title: { absolute: "KolabReport : rapports" },
      description: "Accueil.",
    });

    expect(metadata.alternates?.canonical).toBe("/fr");
    expect(metadata.openGraph?.title).toBe("KolabReport : rapports");
  });
});
