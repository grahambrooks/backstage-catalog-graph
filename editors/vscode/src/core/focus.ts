import { CatalogGraph, neighbourhoodOf } from './catalogGraph';

/**
 * Focus mode: the drawn graph cut down to one entity and what it is drawn joined to, so a large
 * catalog can be read one neighbourhood at a time.
 *
 * Presentation only, like `foldOwners`. It works on the graph as drawn, so an entity joined to
 * the focus only by a folded `ownedBy` edge does not appear as a stray, edgeless box.
 *
 * `owned` is the entities `key` owns when owners are badges, which carry its name. A `key` that
 * is not drawn leaves the graph unchanged.
 */
export function focusAround(
  drawn: CatalogGraph,
  key: string,
  owned: Iterable<string> = [],
): CatalogGraph {
  if (!drawn.nodes.has(key)) {
    return drawn;
  }
  const keep = neighbourhoodOf(drawn, key);
  for (const entity of owned) {
    if (drawn.nodes.has(entity)) {
      keep.add(entity);
    }
  }
  return {
    nodes: new Map([...drawn.nodes].filter(([entity]) => keep.has(entity))),
    edges: drawn.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to)),
    problems: drawn.problems,
  };
}
