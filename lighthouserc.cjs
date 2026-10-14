// Lighthouse CI (KRB-153). How to run it and what the numbers mean:
// docs/performance.md.
//
// Lighthouse mobile, its default: Moto G Power screen, slow 4G and a 4x CPU
// slowdown, all simulated. Three runs per page on the production build, the
// sign-in page signed out and the dashboard as the seeded demo user. The job
// fails when the median score of a category drops below the KRB-25 targets.

// LHCI only reads CommonJS config files.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright");

// With LHCI_BASE_URL set, Lighthouse runs against that server and starts none.
const baseUrl = process.env.LHCI_BASE_URL || "http://localhost:3000";

const KIB = 1024;

/** Error below the KRB-25 targets, on the median of the runs. */
function categories({ performance = 0.85 } = {}) {
  return {
    "categories:performance": ["error", { minScore: performance, aggregationMethod: "median" }],
    "categories:accessibility": ["error", { minScore: 0.95, aggregationMethod: "median" }],
    "categories:best-practices": ["error", { minScore: 0.95, aggregationMethod: "median" }],
  };
}

/** Warning only: transfer sizes in KiB, measured on the KRB-154 build plus about 15 %. */
function budgets({ script, total }) {
  return {
    "resource-summary:script:size": ["warn", { maxNumericValue: script * KIB, aggregationMethod: "median" }],
    "total-byte-weight": ["warn", { maxNumericValue: total * KIB, aggregationMethod: "median" }],
  };
}

module.exports = {
  ci: {
    collect: {
      url: [`${baseUrl}/fr/connexion`, `${baseUrl}/fr/tableau-de-bord`],
      numberOfRuns: 3,
      startServerCommand: process.env.LHCI_BASE_URL ? undefined : "npm run start",
      startServerReadyPattern: "Ready in",
      startServerReadyTimeout: 60000,
      // Signs out before the sign-in page and in before the dashboard.
      puppeteerScript: "./scripts/lighthouse-login.cjs",
      // The Chromium that Playwright installs, pinned by package-lock.json.
      chromePath: process.env.CHROME_PATH || chromium.executablePath(),
      // No Chrome sandbox, as Playwright does by default: Ubuntu 24.04 runners
      // restrict the user namespaces it needs.
      puppeteerLaunchOptions: { args: ["--no-sandbox"] },
      settings: {
        onlyCategories: ["performance", "accessibility", "best-practices"],
      },
    },
    assert: {
      assertMatrix: [
        {
          matchingUrlPattern: "/fr/connexion",
          assertions: { ...categories(), ...budgets({ script: 190, total: 375 }) },
        },
        {
          matchingUrlPattern: "/fr/tableau-de-bord",
          // The dashboard scores 67 to 71 for now. This floor catches a
          // regression until KRB-172 brings it to 85, then the default applies.
          assertions: { ...categories({ performance: 0.65 }), ...budgets({ script: 335, total: 575 }) },
        },
      ],
    },
    upload: {
      // Reports stay on disk and CI keeps them as a workflow artifact. Never
      // temporary-public-storage: the dashboard report shows workspace data.
      target: "filesystem",
      outputDir: ".lighthouseci/reports",
    },
  },
};
