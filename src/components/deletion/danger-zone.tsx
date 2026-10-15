/** Bordered block at the end of a page for a deletion (KRB-180). */
export function DangerZone({
  id,
  title,
  description,
  children,
  className,
}: {
  /** Id of the heading, which names the region. */
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={className ?? "mt-10"}>
      <div className="rounded-2xl border border-destructive/40 p-5">
        <h2 id={id} className="font-medium text-destructive">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        <div className="mt-4 flex flex-col items-start gap-3">{children}</div>
      </div>
    </section>
  );
}

/** A list of what goes, in a deletion dialog. Empty items are left out. */
export function DeletionList({ title, items }: { title: string; items: (string | null | false)[] }) {
  const shown = items.filter((item): item is string => Boolean(item));
  if (shown.length === 0) return null;
  return (
    <div>
      <p className="font-medium">{title}</p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
        {shown.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
