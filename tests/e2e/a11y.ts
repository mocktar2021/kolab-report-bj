import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import type { TestUser } from "./supabase";

// KRB-155: shared helpers of the accessibility specs.

/** WCAG 2.1 A and AA, the level the acceptance criterion asks for. */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Stores the theme the way the theme menu does (src/components/theme), before
 * any script of the page runs, so the first paint already uses it.
 */
export async function useTheme(page: Page, theme: Theme) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("kolabreport:theme", value);
  }, theme);
}

export async function signIn(page: Page, user: TestUser) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/connexion"));
}

/**
 * Waits for the entrance fades to end: axe measures contrast on the colors
 * it sees, and a half-faded text would fail for the wrong reason.
 */
export async function settle(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      // Spinners and pulses never end.
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
      .every((animation) => animation.playState !== "running"),
  );
}

/** One line per failing node, readable in the test output. */
function describe(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `${violation.id} (${violation.impact ?? "n/a"}): ${violation.help}\n  at ${node.target.join(" ")}\n  ${node.failureSummary?.replace(/\n/g, "\n  ") ?? ""}`,
    ),
  );
}

/**
 * Runs axe with the WCAG 2.1 A and AA rules on the page as it is now and
 * fails on any violation. Soft by default, so one run lists every page that
 * fails instead of stopping at the first.
 */
export async function expectNoAxeViolations(page: Page, label: string, { soft = true } = {}) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    // Faded illustration cards of the landing page: aria-hidden decoration,
    // whose text has no contrast requirement (WCAG 1.4.3, incidental text).
    .exclude("[data-decorative]")
    .analyze();
  const check = soft ? expect.soft : expect;
  check(describe(results.violations), `axe violations on ${label}`).toEqual([]);
}
