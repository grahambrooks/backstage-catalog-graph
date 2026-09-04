import { CatalogGraph, CatalogEdge, CatalogNode } from './catalogGraph';
import { kindOf } from './entityKind';
import { formatRef } from './entityRef';

/**
 * The graph as it crosses from the extension host to the webview.
 *
 * `postMessage` structured-clones its payload, which would drop the `Map` keys' meaning and the
 * `EntityKind` identity. Flattening to arrays of plain records keeps the boundary explicit, and
 * keeps the webview from depending on how the core happens to represent things internally.
 */
export interface WireNode {
  readonly key: string;
  readonly ref: string;
  readonly kind: string;
  readonly rank: number;
  readonly title: string;
  readonly description: string | null;
  readonly type: string | null;
  readonly lifecycle: string | null;
  readonly tags: readonly string[];
  readonly external: boolean;
  readonly sourceOffset: number | null;
}

export interface WireGraph {
  readonly nodes: readonly WireNode[];
  readonly edges: readonly CatalogEdge[];
  readonly problems: readonly string[];
}

export function toWire(graph: CatalogGraph): WireGraph {
  return {
    nodes: [...graph.nodes.entries()].map(([key, node]) => toWireNode(key, node)),
    edges: graph.edges.map((edge) => ({ ...edge })),
    problems: graph.problems.map((problem) => problem.message),
  };
}

function toWireNode(key: string, node: CatalogNode): WireNode {
  return {
    key,
    ref: formatRef(node.ref),
    kind: node.kind.displayName,
    rank: node.kind.rank,
    title: node.title,
    description: node.description ?? null,
    type: node.type ?? null,
    lifecycle: node.lifecycle ?? null,
    tags: [...node.tags],
    external: node.external,
    sourceOffset: node.sourceOffset ?? null,
  };
}

/** Rebuilds a `CatalogGraph` inside the webview so the shared layout code can run on it. */
export function fromWire(wire: WireGraph): CatalogGraph {
  const nodes = new Map<string, CatalogNode>();
  for (const node of wire.nodes) {
    const [kind, rest] = splitRef(node.ref);
    const [namespace, name] = rest;
    nodes.set(node.key, {
      ref: { kind, namespace, name },
      kind: kindOf(node.kind),
      title: node.title,
      description: node.description ?? undefined,
      type: node.type ?? undefined,
      lifecycle: node.lifecycle ?? undefined,
      tags: node.tags,
      external: node.external,
      sourceOffset: node.sourceOffset ?? undefined,
    });
  }
  return { nodes, edges: wire.edges, problems: wire.problems.map((message) => ({ message })) };
}

/** Splits the canonical `kind:namespace/name` produced by `formatRef`. */
function splitRef(ref: string): [string, [string, string]] {
  const colon = ref.indexOf(':');
  const slash = ref.indexOf('/', colon + 1);
  return [
    ref.slice(0, colon),
    [ref.slice(colon + 1, slash), ref.slice(slash + 1)],
  ];
}
