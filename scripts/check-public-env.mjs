// NEXT_PUBLIC_ variables are inlined into the browser bundle, so they must
// only hold public values. This fails when one of them is named like a secret
// (KRB-22). Run in CI: node scripts/check-public-env.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SECRET_HINTS = /SECRET|SERVICE|PRIVATE|PASSWORD|TOKEN|API_KEY|DATABASE|DB_/;
const SOURCES = /^(src\/.*\.(ts|tsx)|next\.config\.mjs|\.env\.example|\.github\/workflows\/.*\.yml)$/;

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => SOURCES.test(file));

const offenders = new Set();
for (const file of files) {
  for (const [name] of readFileSync(file, "utf8").matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
    if (SECRET_HINTS.test(name.slice("NEXT_PUBLIC_".length))) offenders.add(`${file}: ${name}`);
  }
}

if (offenders.size > 0) {
  console.error("These NEXT_PUBLIC_ variables look like secrets and would ship to the browser:");
  for (const offender of offenders) console.error(`  ${offender}`);
  process.exit(1);
}
console.log(`No secret-looking NEXT_PUBLIC_ variable in ${files.length} files.`);
