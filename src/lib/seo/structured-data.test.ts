// @vitest-environment node
import { createTranslator } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { PUBLISHER } from "@/content/legal/publisher";
import { LANDING_FAQ, PRICING_FAQ } from "@/content/site-faq";
import { CURRENCY, GRACE_DAYS, OFFER_CODES, OFFERS, TRIAL } from "@/lib/billing/catalog";
import { serializeJsonLd } from "./json-ld";
import { landingJsonLd, pricingFaq, pricingJsonLd, type JsonLdGraph } from "./structured-data";

// The server translator, with the real French messages.
vi.mock("next-intl/server", () => ({
  getTranslations: ({ namespace }: { namespace: string }) =>
    Promise.resolve(
      createTranslator({
        locale: "fr",
        messages,
        namespace: namespace as "Metadata",
        onError: (error) => {
          throw error;
        },
      }),
    ),
}));

const BASE = "https://kolabreport.com";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_APP_URL", BASE));
afterEach(() => vi.unstubAllEnvs());

function node(graph: JsonLdGraph, type: string) {
  const found = graph["@graph"].find((item) => item["@type"] === type);
  if (!found) throw new Error(`No ${type} in the graph`);
  return found;
}

type Offer = { name: string; price: number; priceCurrency: string; priceSpecification?: unknown };
type Question = { name: string; acceptedAnswer: { text: string } };

describe("landingJsonLd", () => {
  it("names the seller, the site and the app", async () => {
    const graph = await landingJsonLd("fr");

    expect(graph["@context"]).toBe("https://schema.org");
    expect(node(graph, "Organization")).toMatchObject({
      "@id": `${BASE}/#organization`,
      name: PUBLISHER.name,
      url: PUBLISHER.website,
      email: PUBLISHER.email,
      brand: { name: "KolabReport", url: `${BASE}/`, logo: `${BASE}/icons/icon-512.png` },
    });
    expect(node(graph, "WebSite")).toMatchObject({
      name: "KolabReport",
      url: `${BASE}/`,
      inLanguage: "fr",
      publisher: { "@id": `${BASE}/#organization` },
    });
    expect(node(graph, "WebApplication")).toMatchObject({
      name: "KolabReport",
      url: `${BASE}/fr`,
      applicationCategory: "BusinessApplication",
      inLanguage: "fr",
      description: messages.Metadata.description,
      image: `${BASE}/og/kolabreport.png`,
    });
  });

  it("gives every price of the catalogue, in FCFA", async () => {
    const app = node(await landingJsonLd("fr"), "WebApplication");
    const offers = app.offers as Offer[];

    expect(offers).toHaveLength(OFFER_CODES.length + 1);
    expect(offers[0]).toMatchObject({ name: `Essai gratuit, ${TRIAL.days} jours`, price: 0 });
    for (const code of OFFER_CODES) {
      expect(offers).toContainEqual(
        expect.objectContaining({ name: OFFERS[code].label, price: OFFERS[code].priceHtXof }),
      );
    }
    expect(offers.every((offer) => offer.priceCurrency === CURRENCY)).toBe(true);
    expect(offers.find((offer) => offer.name === OFFERS.cabinet_12m.label)?.priceSpecification).toMatchObject(
      {
        billingDuration: "P12M",
      },
    );
    expect(
      offers.find((offer) => offer.name === OFFERS.mission_pass.label)?.priceSpecification,
    ).toMatchObject({
      billingDuration: "P90D",
    });
    expect(
      offers.find((offer) => offer.name === OFFERS.ai_pack_100.label)?.priceSpecification,
    ).toBeUndefined();
  });

  it("answers the questions the landing page shows", async () => {
    const faq = node(await landingJsonLd("fr"), "FAQPage");
    const questions = faq.mainEntity as Question[];

    expect(faq.url).toBe(`${BASE}/fr`);
    expect(questions).toEqual(
      LANDING_FAQ.map((key) => ({
        "@type": "Question",
        name: messages.Landing.faq.items[key].question,
        acceptedAnswer: { "@type": "Answer", text: messages.Landing.faq.items[key].answer },
      })),
    );
  });
});

describe("pricingJsonLd", () => {
  it("answers the questions the pricing page shows, with the values filled in", async () => {
    const graph = await pricingJsonLd("fr");
    const faq = node(graph, "FAQPage");
    const questions = faq.mainEntity as Question[];

    expect(graph["@graph"].map((item) => item["@type"])).toEqual([
      "Organization",
      "WebApplication",
      "FAQPage",
    ]);
    expect(faq.url).toBe(`${BASE}/fr/tarifs`);
    expect(questions.map((question) => question.name)).toEqual(
      PRICING_FAQ.map((key) => messages.Pricing.faq[key].question),
    );
    const answers = Object.fromEntries(
      PRICING_FAQ.map((key, index) => [key, questions[index]?.acceptedAnswer.text]),
    );
    expect(answers.trialEnd).toContain(`Vous gardez ${GRACE_DAYS} jours d'accès complet`);
    expect(answers.mission).toContain(`pendant ${OFFERS.mission_pass.days} jours`);
    expect(answers.refund).toContain(
      `<a href="${BASE}/fr/cgv#remboursement">conditions générales de vente</a>`,
    );
    for (const text of Object.values(answers)) expect(text).not.toMatch(/[{}]|<link>/);
  });

  it("links the refund answer to the site it runs on", async () => {
    const refund = (await pricingFaq("fr", "http://localhost:3000")).at(-1);
    expect(refund?.answer).toContain('href="http://localhost:3000/fr/cgv#remboursement"');
  });
});

describe("serializeJsonLd", () => {
  it("keeps text from closing the script tag", () => {
    const json = serializeJsonLd({ text: "</script><script>alert(1)</script> & co" });

    expect(json).not.toMatch(/[<>&]/);
    expect(JSON.parse(json)).toEqual({ text: "</script><script>alert(1)</script> & co" });
  });

  it("escapes the link of the refund answer and gives it back unchanged", async () => {
    const graph = await pricingJsonLd("fr");
    expect(JSON.parse(serializeJsonLd(graph))).toEqual(graph);
  });
});
