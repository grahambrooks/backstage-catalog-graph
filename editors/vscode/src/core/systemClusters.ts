import { CatalogGraph } from './catalogGraph';

/**
 * Which System each entity is drawn inside when Systems are containers, keyed by entity.
 *
 * An entity belongs to the System it is `partOf` directly -- a Component, API or Resource with
 * `spec.system` -- or, for a subcomponent, to whatever System its parent Component belongs to.
 * Presentation only, like `foldOwners`.
 */
export function systemClusters(graph: CatalogGraph): Map<string, string> {
  const parents = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.type === 'partOf' && edge.from !== edge.to) {
      parents.set(edge.from, [...(parents.get(edge.from) ?? []), edge.to]);
    }
  }

  const systemOf = (key: string, visiting: ReadonlySet<string>): string | undefined => {
    if (visiting.has(key)) {
      return undefined;
    }
    for (const parent of parents.get(key) ?? []) {
      const kind = graph.nodes.get(parent)?.kind.displayName;
      if (kind === 'System') {
        return parent;
      }
      if (kind === 'Component') {
        const found = systemOf(parent, new Set(visiting).add(key));
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  };

  const clusters = new Map<string, string>();
  for (const [key, node] of graph.nodes) {
    if (node.kind.displayName === 'System') {
      continue;
    }
    const system = systemOf(key, new Set());
    if (system) {
      clusters.set(key, system);
    }
  }
  return clusters;
}
