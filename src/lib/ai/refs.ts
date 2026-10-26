import { escapeInline } from "@/lib/deliverables/parse/markdown";

// The model cites deliverables by the short refs of the context (L1, L2...).
// The structured sources become file names in draftToMarkdown, but a ref the
// model writes in the text stays as is, and a reader of the report can't tell
// what "(L1)" means (KRB-254). Only a group made of known refs alone, in
// parentheses or brackets, is replaced: "(L1, tableau 3)" or "(L9)" for a
// draft with two deliverables stays as written, and so does a link text
// like "[L1](...)".

const GROUP = /([([])\s*(L\d+(?:\s*(?:,|;|\bet\b)\s*L\d+)*)\s*([)\]])(?!\()/g;
const REF = /L\d+/g;

/** The Markdown of a draft with each group of refs, like "(L1, L2)", turned into file names. */
export function nameInlineRefs(markdown: string, names: ReadonlyMap<string, string>): string {
  return markdown.replace(GROUP, (group, open: string, inner: string, close: string) => {
    if ((open === "(") !== (close === ")")) return group;
    const refs = inner.match(REF) ?? [];
    if (refs.some((ref) => !names.has(ref))) return group;
    const files = [...new Set(refs.map((ref) => escapeInline(names.get(ref) ?? ref)))];
    return `(${files.join(", ")})`;
  });
}
