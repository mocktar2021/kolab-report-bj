/**
 * French legal texts are typed modules, not Markdown files or messages
 * (KRB-159, see docs/legal.md). Every string is rich text: [label](href) makes
 * a link, **text** bold and `text` code. An href is a page path without the
 * locale ("/cgu#contenus"), an anchor on the same page ("#cookies"), an
 * https:// URL or a mailto: address.
 */
export type RichText = string;

export type LegalBlock =
  /** A paragraph. */
  | RichText
  /** A bulleted list. */
  | { list: RichText[] }
  /** Label and value pairs, such as the publisher's details. */
  | { facts: Array<[label: string, value: RichText]> }
  /** A table. The caption names it for screen readers. */
  | { table: { caption: string; head: string[]; rows: RichText[][] } };

export type LegalSection = {
  /**
   * Anchor of the section (/fr/cgu#contenus). Other pages, e-mails and
   * contracts link to it: never rename one once published.
   */
  id: string;
  title: string;
  body: LegalBlock[];
};

export type LegalDocument = {
  /** Date of the last change of the text (YYYY-MM-DD), shown as "Dernière mise à jour". */
  updatedAt: string;
  intro: LegalBlock[];
  sections: LegalSection[];
};
