import Image from "next/image";
import { LegalBlockView, Rich } from "@/components/legal/legal-blocks";
import { figureSrc, GUIDE_FIGURES, type GuideFigureKey } from "@/content/guide/figures";
import type { GuideBlock } from "@/content/guide/types";

// Renders the blocks of the user guide (src/content/guide) on the server:
// the legal blocks, plus numbered steps and screenshots.

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 marker:font-medium marker:text-muted-foreground">
      {steps.map((step) => (
        <li key={step} className="pl-1">
          <Rich text={step} />
        </li>
      ))}
    </ol>
  );
}

function Figure({ name, caption }: { name: GuideFigureKey; caption: string }) {
  const { alt, width, height } = GUIDE_FIGURES[name];
  return (
    <figure className="overflow-hidden rounded-xl border bg-card shadow-sm print:break-inside-avoid print:shadow-none">
      <Image
        src={figureSrc(name)}
        alt={alt}
        width={width}
        height={height}
        // The text column is 48rem wide at most.
        sizes="(min-width: 1024px) 48rem, 100vw"
        className="h-auto w-full"
      />
      <figcaption className="border-t px-4 py-2.5 text-sm text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

function Block({ block }: { block: GuideBlock }) {
  if (typeof block === "object" && "steps" in block) return <Steps steps={block.steps} />;
  if (typeof block === "object" && "figure" in block) {
    return <Figure name={block.figure} caption={block.caption} />;
  }
  return <LegalBlockView block={block} />;
}

/** Paragraphs, lists, steps, tables and screenshots, spaced for reading. */
export function GuideBlocks({ blocks }: { blocks: GuideBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
