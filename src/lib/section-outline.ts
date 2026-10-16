// The outline of a report (KRB-195): sections and their subsections, in
// document order, with their numbers. One level of subsections only, as the
// check_parent trigger enforces. Every page and export that lists sections
// orders and numbers them here.

export type OutlineRow = {
  id: string;
  parentId: string | null;
  position: number;
  createdAt: string;
};

export type OutlinePlace = {
  /** "1" for a section, "1.2" for its second subsection. */
  number: string;
  /** "1." for a section, "1.2" for a subsection, as shown before the title. */
  label: string;
  /** 1 for a section, 2 for a subsection. */
  level: 1 | 2;
  /** The section a subsection belongs to; null for a section. */
  parentId: string | null;
};

function byPosition(a: OutlineRow, b: OutlineRow): number {
  return (
    a.position - b.position ||
    (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * The rows in document order (a section, then its subsections), each with
 * its place. A row whose parent is missing from `rows`, or is itself a
 * subsection, shows as a section, so no text is ever hidden.
 */
export function outline<T extends OutlineRow>(rows: readonly T[]): (T & OutlinePlace)[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const isTop = (row: T) => row.parentId === null || !byId.has(row.parentId);
  const parentOf = (row: T) => {
    const parent = row.parentId === null ? undefined : byId.get(row.parentId);
    return parent && isTop(parent) ? parent.id : null;
  };

  const tops: T[] = [];
  const children = new Map<string, T[]>();
  for (const row of rows) {
    const parentId = parentOf(row);
    if (parentId === null) tops.push(row);
    else children.set(parentId, [...(children.get(parentId) ?? []), row]);
  }

  return [...tops].sort(byPosition).flatMap((top, index) => {
    const number = String(index + 1);
    const subsections = [...(children.get(top.id) ?? [])].sort(byPosition).map((row, childIndex) => {
      const childNumber = `${number}.${childIndex + 1}`;
      return { ...row, number: childNumber, label: childNumber, level: 2 as const, parentId: top.id };
    });
    return [{ ...top, number, label: `${number}.`, level: 1 as const, parentId: null }, ...subsections];
  });
}

/**
 * New numbers for rows already in document order, such as right after a drag
 * and drop, before the server answers. A subsection before any section counts
 * under section 1.
 */
export function renumber<T extends Pick<OutlinePlace, "level">>(
  rows: readonly T[],
): (T & Pick<OutlinePlace, "number" | "label">)[] {
  let section = 0;
  let subsection = 0;
  return rows.map((row) => {
    if (row.level === 1) {
      section += 1;
      subsection = 0;
      const number = String(section);
      return { ...row, number, label: `${number}.` };
    }
    subsection += 1;
    const number = `${Math.max(section, 1)}.${subsection}`;
    return { ...row, number, label: number };
  });
}
