#!/bin/sh
# Lighthouse CI on the sign-in page, signed out, and on the dashboard, signed
# in as the seeded demo user (KRB-153, KRB-172). Thresholds, budgets and how
# to read the reports: docs/performance.md.
#
#   sh scripts/lighthouse-ci.sh
#
# Needs a production build (npm run build) and the seeded local stack
# (npx supabase start). It starts next start on port 3000 and stops it at the
# end; with LHCI_BASE_URL set, it measures that server instead. The reports
# go to .lighthouseci/reports/, even when an assertion fails.
set -eu

profile=$(mktemp -d)
server=""
cleanup() {
  [ -n "$server" ] && kill "$server" 2>/dev/null
  rm -rf "$profile"
}
trap cleanup EXIT

if [ -z "${LHCI_BASE_URL:-}" ]; then
  node node_modules/next/dist/bin/next start -p 3000 > /dev/null 2>&1 &
  server=$!
  LHCI_BASE_URL=http://localhost:3000
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "$LHCI_BASE_URL/fr/connexion" && break
    sleep 1
  done
fi
export LHCI_BASE_URL

# lighthouserc.cjs measures the sign-in page, or the dashboard when
# LHCI_PROFILE points to a profile where the demo user is signed in.
npx lhci collect
node scripts/lighthouse-profile.mjs "$profile"
LHCI_PROFILE="$profile" npx lhci collect --additive

status=0
npx lhci assert || status=$?
# A run that ended on another page measured the wrong one: the sign-in page,
# when the profile has no session.
node -e '
  const fs = require("node:fs");
  for (const name of fs.readdirSync(".lighthouseci").filter((file) => /^lhr-.*\.json$/.test(file))) {
    const { requestedUrl, finalDisplayedUrl } = JSON.parse(fs.readFileSync(`.lighthouseci/${name}`, "utf8"));
    if (new URL(requestedUrl).pathname !== new URL(finalDisplayedUrl).pathname) {
      console.error(`Lighthouse measured ${finalDisplayedUrl} instead of ${requestedUrl}.`);
      process.exitCode = 1;
    }
  }
' || status=1
npx lhci upload
exit "$status"
