import { Link } from "@/i18n/navigation";
import { linkTarget, parseRichText } from "@/content/legal/rich-text";
import type { LegalBlock, RichText } from "@/content/legal/types";

// Renders the typed legal texts of src/content/legal as HTML, on the server.

const linkClass =
  "rounded-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function RichLink({ href, children }: { href: string; children: string }) {
  const target = linkTarget(href);
  if (!target) {
    // documents.test.ts keeps such links out of the texts.
    throw new Error(`Link not allowed in a legal text: ${href}`);
  }
  if (target.kind === "page") {
    // No prefetch: a footer or a page full of links would load every page.
    return (
      <Link href={href} prefetch={false} className={linkClass}>
        {children}
      </Link>
    );
  }
  return (
    <a href={target.kind === "anchor" ? `#${target.hash}` : target.href} className={linkClass}>
      {children}
    </a>
  );
}

/** Rich text: plain text with links, bold and code. */
export function Rich({ text }: { text: RichText }) {
  return parseRichText(text).map((token, index) => {
    switch (token.kind) {
      case "link":
        return (
          <RichLink key={index} href={token.href}>
            {token.text}
          </RichLink>
        );
      case "strong":
        return (
          <strong key={index} className="font-semibold text-foreground">
            {token.text}
          </strong>
        );
      case "code":
        return (
          <code
            key={index}
            className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]"
          >
            {token.text}
          </code>
        );
      default:
        return token.text;
    }
  });
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") {
    return (
      <p>
        <Rich text={block} />
      </p>
    );
  }
  if ("list" in block) {
    return (
      <ul className="list-disc space-y-2 pl-5 marker:text-muted-foreground">
        {block.list.map((item) => (
          <li key={item} className="pl-1">
            <Rich text={item} />
          </li>
        ))}
      </ul>
    );
  }
  if ("facts" in block) {
    return (
      <dl className="divide-y rounded-xl border">
        {block.facts.map(([label, value]) => (
          <div
            key={label}
            className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-baseline sm:gap-4"
          >
            <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
            <dd className="break-words">
              <Rich text={value} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  const { caption, head, rows } = block.table;
  return (
    // Narrow screens scroll the table sideways. The region takes the focus so
    // a keyboard can scroll it too (WCAG 2.1.1).
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="overflow-x-auto rounded-xl border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-muted/60">
            {head.map((cell) => (
              <th key={cell} scope="col" className="border-b px-3 py-2.5 font-medium text-foreground">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b last:border-b-0">
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th
                    key={cellIndex}
                    scope="row"
                    className="px-3 py-2.5 align-top font-medium text-foreground"
                  >
                    <Rich text={cell} />
                  </th>
                ) : (
                  <td key={cellIndex} className="px-3 py-2.5 align-top">
                    <Rich text={cell} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Paragraphs, lists, label and value pairs, and tables, spaced for reading. */
export function LegalBlocks({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
