import { CatalogGraph, CatalogNode, keyOf } from './catalogGraph';
import { EntityKind } from './entityKind';
import { RelationType } from './relationType';

/** One relation as the outline lists it under an entity: which way it points, and to what. */
export interface OutlineRelation {
  readonly type: RelationType;
  readonly outgoing: boolean;
  readonly other: CatalogNode;
}

export interface OutlineEntity {
  readonly node: CatalogNode;
  readonly relations: readonly OutlineRelation[];
}

export interface OutlineSection {
  readonly kind: EntityKind;
  readonly entities: readonly OutlineEntity[];
}

/** Relations in the order of the Kotlin `RelationType` enum, so both editors list them alike. */
const RELATION_ORDER: readonly RelationType[] = [
  'ownedBy',
  'partOf',
  'parentOf',
  'childOf',
  'memberOf',
  'hasMember',
  'providesApi',
  'consumesApi',
  'dependsOn',
  'dependencyOf',
];

/**
 * The outline view: the graph as a tree of kind, entity, then each relation in or out. It reads
 * at any size, which the picture of a large catalog does not.
 *
 * Kinds come in layer order. Entities are declared first, then placeholders, each by title.
 * Under an entity, relations it declares come before those pointing at it, each by relation then
 * by the other end's title. Titles compare by UTF-16 code unit, so the editors agree on order.
 */
export function outlineOf(graph: CatalogGraph): OutlineSection[] {
  const byKind = new Map<string, CatalogNode[]>();
  for (const node of graph.nodes.values()) {
    byKind.set(node.kind.displayName, [...(byKind.get(node.kind.displayName) ?? []), node]);
  }
  return [...byKind.values()]
    .sort(
      (a, b) =>
        a[0].kind.rank - b[0].kind.rank || compare(a[0].kind.displayName, b[0].kind.displayName),
    )
    .map((nodes) => ({
      kind: nodes[0].kind,
      entities: [...nodes].sort(byTitle).map((node) => ({ node, relations: relationsOf(graph, node) })),
    }));
}

function relationsOf(graph: CatalogGraph, node: CatalogNode): OutlineRelation[] {
  const key = keyOf(node.ref);
  const relations: OutlineRelation[] = [];
  for (const edge of graph.edges) {
    const outgoing = edge.from === key;
    if (!outgoing && edge.to !== key) {
      continue;
    }
    const other = graph.nodes.get(outgoing ? edge.to : edge.from);
    if (other) {
      relations.push({ type: edge.type, outgoing, other });
    }
  }
  return relations.sort(
    (a, b) =>
      Number(!a.outgoing) - Number(!b.outgoing) ||
      RELATION_ORDER.indexOf(a.type) - RELATION_ORDER.indexOf(b.type) ||
      compare(a.other.title.toLowerCase(), b.other.title.toLowerCase()) ||
      compare(keyOf(a.other.ref), keyOf(b.other.ref)),
  );
}

function byTitle(a: CatalogNode, b: CatalogNode): number {
  return (
    Number(a.external) - Number(b.external) ||
    compare(a.title.toLowerCase(), b.title.toLowerCase()) ||
    compare(keyOf(a.ref), keyOf(b.ref))
  );
}

/** By UTF-16 code unit; `localeCompare` is machine-dependent. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
