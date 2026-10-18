import { CatalogGraph, CatalogNode } from './catalogGraph';

/**
 * The graph as drawn when owners are shown as badges on their entities rather than as edges.
 *
 * `ownedBy` is usually the most common relation in a descriptor, and every one of those edges
 * runs from a Component or API all the way down to the Group layer, crossing everything in
 * between. Folding them into a badge removes the worst of the clutter without losing the fact.
 *
 * This is presentation only: the conformance contract is the unfolded graph.
 */
export interface OwnerBadges {
  /** The graph left to lay out: no `ownedBy` edges, and no placeholder that existed only as an owner. */
  readonly graph: CatalogGraph;
  /** Owners of each entity, keyed like `graph.nodes`, in edge order. Unowned entities are absent. */
  readonly owners: ReadonlyMap<string, readonly CatalogNode[]>;
}

export function foldOwners(graph: CatalogGraph): OwnerBadges {
  const owners = new Map<string, CatalogNode[]>();
  const ownerKeys = new Set<string>();
  for (const edge of graph.edges) {
    const owner = edge.type === 'ownedBy' ? graph.nodes.get(edge.to) : undefined;
    if (owner) {
      owners.set(edge.from, [...(owners.get(edge.from) ?? []), owner]);
      ownerKeys.add(edge.to);
    }
  }

  const remaining = graph.edges.filter((edge) => edge.type !== 'ownedBy');
  const stillJoined = new Set(remaining.flatMap((edge) => [edge.from, edge.to]));
  const ownerOnly = new Set(
    [...ownerKeys].filter((key) => graph.nodes.get(key)?.external && !stillJoined.has(key)),
  );

  return {
    graph: {
      nodes: new Map([...graph.nodes].filter(([key]) => !ownerOnly.has(key))),
      edges: remaining,
      problems: graph.problems,
    },
    owners,
  };
}

