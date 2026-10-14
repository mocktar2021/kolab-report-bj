// Blocks CI on high and critical advisories in the production dependencies
// (KRB-164). It runs `npm audit --omit=dev --json` and fails on any such
// advisory unless .github/accepted-advisories.json accepts it. An accepted
// entry names the GHSA id, the direct dependencies the advisory may come
// through, why it does not apply and until when the review holds. The run
// fails when the review has expired, or when the advisory shows up through
// another direct dependency, since the reason may not hold there.
//
//   node scripts/audit-production.mjs
//
// Exit codes: 0 pass, 1 an advisory blocks, 2 the audit or the list could not be read.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ACCEPTED_FILE = ".github/accepted-advisories.json";

const BLOCKING = new Set(["high", "critical"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The direct dependencies a vulnerable package is reached through, following `effects` up. */
function directDependents(vulnerabilities, name, seen = new Set()) {
  const found = new Set();
  const entry = vulnerabilities[name];
  if (!entry || seen.has(name)) return found;
  seen.add(name);
  if (entry.isDirect) found.add(name);
  for (const parent of entry.effects ?? []) {
    for (const direct of directDependents(vulnerabilities, parent, seen)) found.add(direct);
  }
  return found;
}

/**
 * The advisories of an `npm audit --json` report, one per GHSA id, with the
 * packages they affect and the direct dependencies they come through.
 */
export function listAdvisories(report) {
  const vulnerabilities = report.vulnerabilities ?? {};
  const byId = new Map();
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const id = String(via.url ?? via.source)
        .split("/")
        .pop();
      const advisory = byId.get(id) ?? {
        id,
        severity: via.severity,
        title: String(via.title ?? "").trim(),
        packages: new Set(),
        via: new Set(),
      };
      advisory.packages.add(via.name ?? name);
      for (const direct of directDependents(vulnerabilities, name)) advisory.via.add(direct);
      byId.set(id, advisory);
    }
  }
  return [...byId.values()]
    .map((advisory) => ({
      ...advisory,
      packages: [...advisory.packages].sort(),
      via: [...advisory.via].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Problems in the accepted list itself: each entry needs all its fields. */
export function invalidEntries(accepted) {
  if (!Array.isArray(accepted)) return [`${ACCEPTED_FILE} must be a JSON array`];
  return accepted.flatMap((entry, index) => {
    const where = `${ACCEPTED_FILE} entry ${index + 1}`;
    const problems = [];
    if (!/^GHSA-[\w-]+$/.test(entry?.id ?? "")) problems.push(`${where}: "id" must be a GHSA id`);
    if (!Array.isArray(entry?.via) || entry.via.length === 0)
      problems.push(`${where}: "via" must list the direct dependencies it comes through`);
    if (typeof entry?.reason !== "string" || entry.reason.trim().length < 20)
      problems.push(`${where}: "reason" must say why the advisory does not apply`);
    if (!DATE.test(entry?.reviewed ?? "")) problems.push(`${where}: "reviewed" must be a YYYY-MM-DD date`);
    if (!DATE.test(entry?.expires ?? "")) problems.push(`${where}: "expires" must be a YYYY-MM-DD date`);
    return problems;
  });
}

/**
 * Compares the report with the accepted list. `blocking` makes the run fail,
 * `notes` are printed only. `today` is a YYYY-MM-DD date.
 */
export function checkReport(report, accepted, today) {
  const blocking = [];
  const notes = [];
  const found = listAdvisories(report).filter((advisory) => BLOCKING.has(advisory.severity));
  for (const advisory of found) {
    const label = `${advisory.id} (${advisory.severity}, ${advisory.packages.join(", ")} via ${advisory.via.join(", ")}): ${advisory.title}`;
    const entry = accepted.find((candidate) => candidate.id === advisory.id);
    if (!entry) {
      blocking.push(
        `${label}. Upgrade or override the package, or review it and add it to ${ACCEPTED_FILE}.`,
      );
      continue;
    }
    if (entry.expires < today) {
      blocking.push(
        `${label}. Its review expired on ${entry.expires}: check it again and update ${ACCEPTED_FILE}.`,
      );
      continue;
    }
    const unreviewed = advisory.via.filter((direct) => !entry.via.includes(direct));
    if (unreviewed.length > 0) {
      blocking.push(
        `${label}. It now also comes through ${unreviewed.join(", ")}, which its review does not cover.`,
      );
      continue;
    }
    notes.push(`${label}. Accepted until ${entry.expires}: ${entry.reason}`);
  }
  for (const entry of accepted) {
    if (!found.some((advisory) => advisory.id === entry.id)) {
      notes.push(`${entry.id} is no longer reported: remove it from ${ACCEPTED_FILE}.`);
    }
  }
  return { blocking, notes };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  // npm audit exits 1 when it finds anything, so only the JSON tells.
  const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    console.error(`npm audit did not return a JSON report.\n${audit.stderr ?? ""}`);
    return 2;
  }
  if (report.error) {
    console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
    return 2;
  }

  let accepted;
  try {
    accepted = JSON.parse(readFileSync(path.join(root, ACCEPTED_FILE), "utf8"));
  } catch (error) {
    console.error(`Could not read ${ACCEPTED_FILE}: ${error.message}`);
    return 2;
  }
  const invalid = invalidEntries(accepted);
  if (invalid.length > 0) {
    for (const problem of invalid) console.error(problem);
    return 2;
  }

  const counts = report.metadata?.vulnerabilities ?? {};
  console.log(
    `npm audit --omit=dev: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low (packages).`,
  );
  const { blocking, notes } = checkReport(report, accepted, new Date().toISOString().slice(0, 10));
  for (const note of notes) console.log(`- ${note}`);
  for (const problem of blocking) console.error(`BLOCKING ${problem}`);
  if (blocking.length > 0) return 1;
  console.log("No unreviewed high or critical advisory in the production dependencies.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
