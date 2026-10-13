"use client";

import { Component, createElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Markdown from files, from the model or from people becomes React elements:
// raw HTML is shown as text and never inserted into the page, react-markdown
// drops javascript: links, and images are left out.

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

type HeadingLevel = 3 | 4;

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

function componentsFor(level: HeadingLevel, headings: MarkdownHeadings): Components {
  const key = `${level}-${headings}`;
  let components = COMPONENTS.get(key);
  if (!components) {
    components = { ...BASE_COMPONENTS, ...headingComponents(level, headings) };
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
};

/** Renders Markdown with GitHub tables, without raw HTML or images. Links open in a new tab. */
export function Markdown({ children, fallback, headingLevel = 3, headings = "shift" }: MarkdownProps) {
  return (
    <MarkdownBoundary text={children} fallback={fallback}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={componentsFor(headingLevel, headings)}
        disallowedElements={["img"]}
      >
        {children}
      </ReactMarkdown>
    </MarkdownBoundary>
  );
}
