import { EntityKind } from './entityKind';
import { EntityRef, formatRef } from './entityRef';
import { RelationType } from './relationType';

/**
 * A node in the rendered graph.
 *
 * Nodes come from two places. Entities *declared* in the file being viewed carry their metadata
 * and the offset of their YAML document, so clicking one can move the caret. Entities merely
 * *referenced* by those declarations -- an owner defined in another repository, a system owned
 * by a different team -- have no declaration to point at, and are marked `external`. Rendering
 * those as placeholders rather than dropping them is the point of the graph.
 */
export interface CatalogNode {
  readonly ref: EntityRef;
  readonly kind: EntityKind;
  /** `metadata.title` where present, otherwise `metadata.name`. */
  readonly title: string;
  readonly description?: string;
  readonly type?: string;
  readonly lifecycle?: string;
  readonly tags: readonly string[];
  readonly external: boolean;
  /** Character offset of the entity's YAML document, or undefined for external nodes. */
  readonly sourceOffset?: number;
}

/** A directed relation between two nodes, as written in the source entity's `spec`. */
export interface CatalogEdge {
  readonly from: string;
  readonly to: string;
  readonly type: RelationType;
}

/**
 * A problem found while reading the descriptor. Collected rather than thrown, so a half-valid
 * file still renders the entities it does get right.
 */
export interface CatalogProblem {
  readonly message: string;
  readonly sourceOffset?: number;
}

/** The whole picture: every entity to draw, every relation between them, and what went wrong. */
export interface CatalogGraph {
  /** Keyed by the canonical `kind:namespace/name`, in declaration-then-discovery order. */
  readonly nodes: ReadonlyMap<string, CatalogNode>;
  readonly edges: readonly CatalogEdge[];
  readonly problems: readonly CatalogProblem[];
}

export const EMPTY_GRAPH: CatalogGraph = {
  nodes: new Map(),
  edges: [],
  problems: [],
};

export function declaredNodes(graph: CatalogGraph): CatalogNode[] {
  return [...graph.nodes.values()].filter((node) => !node.external);
}

export function externalNodes(graph: CatalogGraph): CatalogNode[] {
  return [...graph.nodes.values()].filter((node) => node.external);
}

export function isEmpty(graph: CatalogGraph): boolean {
  return graph.nodes.size === 0;
}

/** True when either end of the edge is a placeholder -- drawn as a dashed edge. */
export function isDangling(graph: CatalogGraph, edge: CatalogEdge): boolean {
  return (
    graph.nodes.get(edge.from)?.external === true || graph.nodes.get(edge.to)?.external === true
  );
}

/** Every node directly joined to `ref` in either direction, plus `ref` itself. */
export function neighbourhoodOf(graph: CatalogGraph, ref: string): Set<string> {
  const neighbourhood = new Set<string>([ref]);
  for (const edge of graph.edges) {
    if (edge.from === ref) {
      neighbourhood.add(edge.to);
    }
    if (edge.to === ref) {
      neighbourhood.add(edge.from);
    }
  }
  return neighbourhood;
}

export function keyOf(ref: EntityRef): string {
  return formatRef(ref);
}
