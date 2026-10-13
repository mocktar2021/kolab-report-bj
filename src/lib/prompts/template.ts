import { PROMPT_LIMITS, PROMPT_VARIABLES, type PromptVariable } from "./catalog";

// Placeholders are {{name}}, with spaces allowed inside the braces. Both
// functions scan the template once with indexOf, so a long or odd template
// costs linear time.

const KNOWN = new Set<string>(PROMPT_VARIABLES);

function isKnown(name: string): name is PromptVariable {
  return KNOWN.has(name);
}

export type TemplateCheck = {
  /** Known variables, in the order they first appear. */
  variables: PromptVariable[];
  /** What sits between braces and is not a variable, cut to 40 characters. */
  unknown: string[];
  /** A "{{" with no "}}" after it. */
  unclosed: boolean;
};

export function checkTemplate(template: string): TemplateCheck {
  const variables = new Set<PromptVariable>();
  const unknown = new Set<string>();
  let unclosed = false;
  let from = 0;
  for (;;) {
    const open = template.indexOf("{{", from);
    if (open === -1) break;
    const close = template.indexOf("}}", open + 2);
    if (close === -1) {
      unclosed = true;
      break;
    }
    const name = template.slice(open + 2, close).trim();
    if (isKnown(name)) variables.add(name);
    else unknown.add(name.slice(0, 40));
    from = close + 2;
  }
  return { variables: [...variables], unknown: [...unknown], unclosed };
}

/**
 * The template with each variable replaced by its value. Values are inserted
 * as they are and never scanned again, so braces in a deliverable can't add a
 * placeholder. Anything else between braces stays as written.
 */
export function renderTemplate(template: string, values: Partial<Record<PromptVariable, string>>): string {
  let rendered = "";
  let from = 0;
  for (;;) {
    const open = template.indexOf("{{", from);
    if (open === -1) break;
    const close = template.indexOf("}}", open + 2);
    if (close === -1) break;
    const name = template.slice(open + 2, close).trim();
    rendered +=
      template.slice(from, open) + (isKnown(name) ? (values[name] ?? "") : template.slice(open, close + 2));
    from = close + 2;
  }
  return rendered + template.slice(from);
}

const LIGATURES: Record<string, string> = { œ: "oe", Œ: "oe", æ: "ae", Æ: "ae" };

/** A template key from a title: "Résumé exécutif" gives "resume-executif". */
export function templateKeyFromTitle(title: string): string {
  const words = title
    .replace(/[œŒæÆ]/g, (letter) => LIGATURES[letter] ?? letter)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let key = "";
  for (const word of words) {
    const next = key ? `${key}-${word}` : word;
    if (next.length > PROMPT_LIMITS.keyMax) break;
    key = next;
  }
  return key || "modele";
}
