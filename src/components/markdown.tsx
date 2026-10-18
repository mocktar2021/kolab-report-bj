"use client";

import { Component, createElement, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { sectionImageId, sectionImageSrc } from "@/lib/deliverables/section-images";
import { isRiskyMarkdown } from "@/lib/markdown-risk";
import { cn } from "@/lib/utils";

// Markdown from files, from the model or from people becomes React elements:
// raw HTML is shown as text and never inserted into the page, react-markdown
// drops javascript: links, and images are left out. Text the model wrote may
// carry a link a deliverable slipped in, so there links can be shown as text
// with their address instead of being clickable. Text that would take the
// parser seconds (see isRiskyMarkdown) is shown as plain text, unparsed.
//
// A section's text can show the images of its deliverables (KRB-216): with
// images="deliverables", an image whose address is a deliverable's file route
// is drawn, and any other image shows its caption and is never fetched.

/**
 * Props for the DOM element: our classes plus the element's own, without the
 * `node` prop react-markdown adds, which would show up as an attribute.
 */
function domProps<P extends { node?: unknown; className?: string }>(props: P, classes: string) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { node, className, ...rest } = props;
  return { ...rest, className: cn(classes, className) };
}

/** Heading looks, from the top rank down. */
const HEADING_CLASSES = [
  "mt-4 text-base font-semibold first:mt-0",
  "mt-4 text-sm font-semibold first:mt-0",
  "mt-3 text-sm font-semibold first:mt-0",
  "mt-3 text-sm font-medium first:mt-0",
] as const;

/**
 * How Markdown headings fit under the page's own: "shift" moves every level
 * down (with a top level of 3, # becomes h3 and ## h4), "flatten" gives #, ##
 * and ### the top level and the deeper ones the levels below it.
 */
export type MarkdownHeadings = "shift" | "flatten";

type HeadingLevel = 3 | 4 | 5;

const BASE_COMPONENTS: Components = {
  p: (props) => <p {...domProps(props, "mt-2 first:mt-0")} />,
  ul: (props) => <ul {...domProps(props, "mt-2 list-disc space-y-1 pl-5")} />,
  ol: (props) => <ol {...domProps(props, "mt-2 list-decimal space-y-1 pl-5")} />,
  blockquote: (props) => (
    <blockquote {...domProps(props, "mt-2 border-l-2 pl-3 text-muted-foreground first:mt-0")} />
  ),
  pre: (props) => (
    <pre {...domProps(props, "mt-2 overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs first:mt-0")} />
  ),
  hr: (props) => <hr {...domProps(props, "my-4")} />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="underline underline-offset-2"
    >
      {children}
    </a>
  ),
  table: (props) => (
    <div className="mt-3 overflow-x-auto rounded-lg border">
      <table {...domProps(props, "w-full border-collapse text-left text-xs")} />
    </div>
  ),
  th: (props) => <th {...domProps(props, "border-b bg-muted/60 px-2.5 py-1.5 font-medium")} />,
  td: (props) => <td {...domProps(props, "border-b px-2.5 py-1.5 align-top")} />,
};

/** A link shown as its text and address, not clickable. */
const textLink: NonNullable<Components["a"]> = ({ href, children }) => (
  <span className="break-words">
    {children}
    {href && children !== href ? <span className="break-all text-muted-foreground"> ({href})</span> : null}
  </span>
);

/** "open": clickable, in a new tab. "text": the text and the address, not clickable. */
export type MarkdownLinks = "open" | "text";

/** "none": no image at all. "deliverables": the images of deliverables, the caption of any other. */
export type MarkdownImages = "none" | "deliverables";

/**
 * The image of a deliverable, from its file route, which checks the reader's
 * rights. When the route refuses or the file is gone, the caption stays with
 * a note. The caption under the image repeats its alt text, so screen readers
 * skip it.
 */
function DeliverableImage({ id, caption }: { id: string; caption: string }) {
  const t = useTranslations("SectionImages");
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="my-2 block text-muted-foreground">
        {caption ? `${caption} ` : null}
        {t("unavailable")}
      </span>
    );
  }
  return (
    <span className="my-3 block">
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL behind a route, not a static asset */}
      <img
        src={sectionImageSrc(id)}
        alt={caption || t("noCaption")}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-auto max-h-[36rem] max-w-full rounded-lg border bg-muted/30 object-contain"
      />
      {caption ? (
        <span aria-hidden="true" className="mt-1.5 block text-xs italic text-muted-foreground">
          {caption}
        </span>
      ) : null}
    </span>
  );
}

const sectionImage: NonNullable<Components["img"]> = ({ src, alt }) => {
  const id = sectionImageId(typeof src === "string" ? src : null);
  const caption = alt?.trim() ?? "";
  if (id) return <DeliverableImage id={id} caption={caption} />;
  return caption ? <span>{caption}</span> : null;
};

const REMARK_PLUGINS = [remarkGfm];

const DEPTHS = [1, 2, 3, 4, 5, 6] as const;

function headingComponents(level: HeadingLevel, headings: MarkdownHeadings): Components {
  return Object.fromEntries(
    DEPTHS.map((depth) => {
      const rank = headings === "shift" ? depth - 1 : Math.max(depth - 3, 0);
      const tag = `h${Math.min(level + rank, 6)}`;
      const classes = HEADING_CLASSES[Math.min(rank, HEADING_CLASSES.length - 1)] ?? "";
      const Heading: NonNullable<Components["h1"]> = (props) => createElement(tag, domProps(props, classes));
      return [`h${depth}`, Heading];
    }),
  );
}

const COMPONENTS = new Map<string, Components>();

function componentsFor(
  level: HeadingLevel,
  headings: MarkdownHeadings,
  links: MarkdownLinks,
  images: MarkdownImages,
): Components {
  const key = `${level}-${headings}-${links}-${images}`;
  let components = COMPONENTS.get(key);
  if (!components) {
    components = {
      ...BASE_COMPONENTS,
      ...headingComponents(level, headings),
      ...(links === "text" ? { a: textLink } : {}),
      ...(images === "deliverables" ? { img: sectionImage } : {}),
    };
    COMPONENTS.set(key, components);
  }
  return components;
}

type BoundaryProps = { text: string; fallback: ReactNode; children: ReactNode };

/**
 * Shows `fallback` if react-markdown throws, instead of taking the page down.
 * A new text gets a new try, so a draft that streams in can recover.
 */
class MarkdownBoundary extends Component<BoundaryProps, { failed: boolean; text: string }> {
  state = { failed: false, text: this.props.text };

  static getDerivedStateFromProps(props: BoundaryProps, state: { failed: boolean; text: string }) {
    return props.text === state.text ? null : { failed: false, text: props.text };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type MarkdownProps = {
  children: string;
  /** What shows when the text can't be rendered. */
  fallback: ReactNode;
  /** The HTML level of the text's top headings. */
  headingLevel?: HeadingLevel;
  headings?: MarkdownHeadings;
  links?: MarkdownLinks;
  images?: MarkdownImages;
};

const NO_IMAGES = ["img"];

/** Renders Markdown with GitHub tables, without raw HTML, and without images unless asked. */
export function Markdown({
  children,
  fallback,
  headingLevel = 3,
  headings = "shift",
  links = "open",
  images = "none",
}: MarkdownProps) {
  if (isRiskyMarkdown(children)) return <div className="whitespace-pre-wrap break-words">{children}</div>;
  return (
    <MarkdownBoundary text={children} fallback={fallback}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={componentsFor(headingLevel, headings, links, images)}
        disallowedElements={images === "none" ? NO_IMAGES : undefined}
      >
        {children}
      </ReactMarkdown>
    </MarkdownBoundary>
  );
}
