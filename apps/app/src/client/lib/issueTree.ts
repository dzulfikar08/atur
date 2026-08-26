// Nest sub-issues under their parent row. Orphans (parent filtered out or
// missing) stay at the top level but keep the ↳ marker so the relationship
// is still visible. Shared by MyIssuesPage and MobileIssueList; the project
// board/module table views adopt it in later DEV-24/25 phases.

export interface TreeIssue {
  id: string;
  parent_id: string | null;
}

export interface TreeRow<T extends TreeIssue> {
  issue: T;
  depth: number;
  childCount: number;
  isSubIssue: boolean;
}

export interface BuildTreeOptions<T extends TreeIssue> {
  /**
   * Whether `child` may nest under `parent`. Multi-project views (My Issues)
   * pass a same-project check; single-project views use the default (always
   * true).
   */
  sameTree?: (parent: T, child: T) => boolean;
}

export function buildHierarchicalRows<T extends TreeIssue>(
  issues: T[],
  collapsedParents: Set<string>,
  opts: BuildTreeOptions<T> = {},
): TreeRow<T>[] {
  const sameTree = opts.sameTree ?? (() => true);
  const byId = new Map(issues.map((i) => [i.id, i]));
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const issue of issues) {
    const parent = issue.parent_id ? byId.get(issue.parent_id) : undefined;
    if (parent && parent.id !== issue.id && sameTree(parent, issue)) {
      const list = childrenOf.get(parent.id);
      if (list) list.push(issue);
      else childrenOf.set(parent.id, [issue]);
    } else {
      roots.push(issue);
    }
  }
  const rows: TreeRow<T>[] = [];
  const walk = (issue: T, depth: number, stack: Set<string>) => {
    if (stack.has(issue.id)) return; // cycle guard
    const children = childrenOf.get(issue.id) ?? [];
    rows.push({
      issue,
      depth,
      childCount: children.length,
      isSubIssue: depth > 0 || (!!issue.parent_id && !byId.get(issue.parent_id)),
    });
    if (collapsedParents.has(issue.id)) return;
    const next = new Set(stack);
    next.add(issue.id);
    for (const child of children) walk(child, depth + 1, next);
  };
  for (const root of roots) walk(root, 0, new Set());
  return rows;
}
