// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import messages from "../../messages/fr.json";
import { CLIENT_MESSAGE_SCOPES, pickMessages, type ClientMessageScope } from "./client-messages";

// Static check of the message scopes (KRB-154): for every route file under
// app/[locale], follow its imports to the Client Components it renders and
// make sure the nearest <ClientMessages scope="..."> sends every namespace
// they read. A module imported by a Client Component runs in the browser too,
// even without "use client", so it counts.

const SRC = path.resolve(__dirname, "..");
const LOCALE_DIR = path.join(SRC, "app", "[locale]");
const ROUTE_FILE = /^(page|layout|template|loading|error|not-found|default)\.tsx$/;
const IMPORT =
  /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

const sources = new Map<string, string>();
function read(file: string): string {
  let source = sources.get(file);
  if (source === undefined) {
    source = fs.readFileSync(file, "utf8");
    sources.set(file, source);
  }
  return source;
}

function isClient(file: string): boolean {
  return /^\s*["']use client["']/.test(read(file));
}

function resolve(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;
  for (const suffix of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = base + suffix;
    if (/\.tsx?$/.test(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function localImports(file: string): string[] {
  const found: string[] = [];
  for (const match of read(file).matchAll(IMPORT)) {
    const specifier = match[2] ?? match[3];
    if (match[1] || !specifier) continue; // import type / export type
    const target = resolve(file, specifier);
    if (target) found.push(target);
  }
  return found;
}

/** Modules of a route file that run in the browser. */
function clientModules(routeFile: string): Set<string> {
  const client = new Set<string>();
  const seenOnServer = new Set<string>();
  const queue: Array<[string, boolean]> = [[routeFile, false]];
  while (queue.length > 0) {
    const [file, parentIsClient] = queue.shift()!;
    const inClient = parentIsClient || isClient(file);
    if (inClient ? client.has(file) : seenOnServer.has(file)) continue;
    (inClient ? client : seenOnServer).add(file);
    for (const target of localImports(file)) queue.push([target, inClient]);
  }
  return client;
}

/** Namespaces a module reads with useTranslations. */
function namespaces(file: string): string[] {
  const source = read(file);
  const literal = [...source.matchAll(/\buseTranslations\(\s*(["'`])([^"'`]+)\1\s*\)/g)].flatMap((m) =>
    m[2] ? [m[2]] : [],
  );
  const calls = source.match(/\buseTranslations\(/g)?.length ?? 0;
  const dynamic = calls > literal.length ? ["<not a string literal>"] : [];
  const all = /\buseMessages\(/.test(source) ? ["<useMessages>"] : [];
  return [...literal, ...dynamic, ...all];
}

function scopeIn(file: string): ClientMessageScope | null {
  const match = read(file).match(/<ClientMessages\b[^>]*\bscope="([^"]+)"/);
  return match ? (match[1] as ClientMessageScope) : null;
}

/** Scope that wraps what a route file renders: its own if it is a layout with one, else the nearest layout's above it. */
function effectiveScope(routeFile: string): ClientMessageScope | null {
  const isLayout = path.basename(routeFile) === "layout.tsx";
  if (isLayout && scopeIn(routeFile)) return scopeIn(routeFile);
  let dir = isLayout ? path.dirname(path.dirname(routeFile)) : path.dirname(routeFile);
  while (dir.startsWith(LOCALE_DIR)) {
    const layout = path.join(dir, "layout.tsx");
    if (fs.existsSync(layout) && scopeIn(layout)) return scopeIn(layout);
    dir = path.dirname(dir);
  }
  return null;
}

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return ROUTE_FILE.test(entry.name) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(SRC, file);

describe("pickMessages", () => {
  const tree = { A: { b: "1", c: { d: "2" } }, E: "3" };

  it("copies whole namespaces and nested keys with their nesting", () => {
    expect(pickMessages(tree, ["E", "A.c"])).toEqual({ E: "3", A: { c: { d: "2" } } });
    expect(pickMessages(tree, ["A.b", "A.c.d"])).toEqual({ A: { b: "1", c: { d: "2" } } });
  });

  it("throws on a path that is not in the messages", () => {
    expect(() => pickMessages(tree, ["A.x"])).toThrow('Unknown message namespace "A.x"');
    expect(() => pickMessages(tree, ["E.f"])).toThrow('Unknown message namespace "E.f"');
  });
});

describe("client message scopes", () => {
  const files = routeFiles(LOCALE_DIR);

  it("finds the route files", () => {
    expect(files.map(relative)).toContain(path.join("app", "[locale]", "connexion", "page.tsx"));
  });

  it.each(Object.entries(CLIENT_MESSAGE_SCOPES))("scope %s only names messages that exist", (_, paths) => {
    expect(() => pickMessages(messages, paths)).not.toThrow();
  });

  it("puts <ClientMessages> in layouts only, so every return path of a page is covered", () => {
    const misplaced = files.filter((file) => path.basename(file) !== "layout.tsx" && scopeIn(file));
    expect(misplaced.map(relative)).toEqual([]);
  });

  it("sends every namespace a Client Component reads", () => {
    const missing: string[] = [];
    for (const file of files) {
      const scope = effectiveScope(file);
      const provided: readonly string[] = scope ? CLIENT_MESSAGE_SCOPES[scope] : [];
      for (const clientModule of clientModules(file)) {
        for (const needed of namespaces(clientModule)) {
          const covered = provided.some((p) => needed === p || needed.startsWith(`${p}.`));
          if (!covered) {
            missing.push(
              `${relative(file)} (scope ${scope ?? "none"}): ${relative(clientModule)} reads ${needed}`,
            );
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
