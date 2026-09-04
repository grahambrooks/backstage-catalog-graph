import { CatalogGraph, CatalogNode, isEmpty, keyOf } from './catalogGraph';

/** Where one node ended up, in graph coordinates (pixels before zoom and pan). */
export interface NodeBounds {
  readonly node: CatalogNode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The positioned graph, plus the extent needed to show all of it. */
export interface GraphLayout {
  readonly nodes: ReadonlyMap<string, NodeBounds>;
  readonly width: number;
  readonly height: number;
}

export const EMPTY_LAYOUT: GraphLayout = { nodes: new Map(), width: 0, height: 0 };

/** How wide and tall a node should be drawn. Supplied by the caller so measurement stays there. */
export type NodeSizer = (node: CatalogNode) => { width: number; height: number };

export interface LayoutOptions {
  readonly horizontalGap?: number;
  readonly verticalGap?: number;
  readonly margin?: number;
  readonly orderingSweeps?: number;
}

export function centerX(bounds: NodeBounds): number {
  return bounds.x + bounds.width / 2;
}

export function centerY(bounds: NodeBounds): number {
  return bounds.y + bounds.height / 2;
}

export function right(bounds: NodeBounds): number {
  return bounds.x + bounds.width;
}

export function bottom(bounds: NodeBounds): number {
  return bounds.y + bounds.height;
}

export function nodeAt(layout: GraphLayout, x: number, y: number): NodeBounds | undefined {
  for (const bounds of layout.nodes.values()) {
    if (x >= bounds.x && x <= right(bounds) && y >= bounds.y && y <= bottom(bounds)) {
      return bounds;
    }
  }
  return undefined;
}

/**
 * A Sugiyama-style layered layout, specialised for catalogs.
 *
 * Layers come from the entity kind's rank rather than from the longest path through the graph.
 * A catalog has a conventional reading order -- Domain, System, Component, API/Resource, then
 * the Group and User that own them -- and holding to it means the picture keeps its shape as
 * entities are added, instead of reshuffling every time a new edge changes the longest path.
 *
 * Within a layer, nodes are ordered by the barycentre heuristic to cut edge crossings. The
 * exact procedure is part of the cross-editor contract; see "Layout" in `conformance/spec.md`.
 */
export function layoutGraph(
  graph: CatalogGraph,
  sizer: NodeSizer,
  options: LayoutOptions = {},
): GraphLayout {
  if (isEmpty(graph)) {
    return EMPTY_LAYOUT;
  }

  const horizontalGap = options.horizontalGap ?? 32;
  const verticalGap = options.verticalGap ?? 84;
  const margin = options.margin ?? 32;
  const orderingSweeps = options.orderingSweeps ?? 4;

  const layers = orderLayers(layerNodes(graph), adjacencyOf(graph), orderingSweeps);

  // Pack each layer left to right, then centre the layers on a common axis.
  const rows: NodeBounds[][] = [];
  let y = margin;
  let widest = 0;

  for (const layer of layers) {
    let x = 0;
    let tallest = 0;
    const row: NodeBounds[] = [];
    for (const node of layer) {
      const { width, height } = sizer(node);
      row.push({ node, x, y, width, height });
      x += width + horizontalGap;
      tallest = Math.max(tallest, height);
    }
    widest = Math.max(widest, Math.max(0, x - horizontalGap));
    rows.push(row);
    y += tallest + verticalGap;
  }

  const positioned = new Map<string, NodeBounds>();
  for (const row of rows) {
    const rowWidth = row.length > 0 ? right(row[row.length - 1]) : 0;
    const offset = margin + (widest - rowWidth) / 2;
    for (const bounds of row) {
      positioned.set(keyOf(bounds.node.ref), { ...bounds, x: bounds.x + offset });
    }
  }

  return {
    nodes: positioned,
    width: widest + margin * 2,
    height: Math.max(0, y - verticalGap + margin),
  };
}

/** Buckets nodes by kind rank, dropping the ranks nothing lands in so there are no gaps. */
function layerNodes(graph: CatalogGraph): CatalogNode[][] {
  const byRank = new Map<number, CatalogNode[]>();
  for (const node of graph.nodes.values()) {
    const bucket = byRank.get(node.kind.rank);
    if (bucket) {
      bucket.push(node);
    } else {
      byRank.set(node.kind.rank, [node]);
    }
  }

  return [...byRank.keys()]
    .sort((a, b) => a - b)
    .map((rank) =>
      // Stable sort on (external, lowercased title), matching the spec.
      [...byRank.get(rank)!].sort((a, b) => {
        if (a.external !== b.external) {
          return a.external ? 1 : -1;
        }
        return compareStrings(a.title.toLowerCase(), b.title.toLowerCase());
      }),
    );
}

function adjacencyOf(graph: CatalogGraph): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  const add = (from: string, to: string): void => {
    const existing = adjacency.get(from);
    if (existing) {
      existing.push(to);
    } else {
      adjacency.set(from, [to]);
    }
  };
  for (const edge of graph.edges) {
    add(edge.from, edge.to);
    add(edge.to, edge.from);
  }
  return adjacency;
}

/**
 * Alternating down and up barycentre sweeps. Each pass moves a node towards the average
 * position of its neighbours in the adjacent layer; nodes with no neighbour there keep the
 * position they had, which stops isolated entities from drifting to one edge.
 */
function orderLayers(
  layers: CatalogNode[][],
  adjacency: Map<string, string[]>,
  sweeps: number,
): CatalogNode[][] {
  let current = layers.map((layer) => [...layer]);

  for (let sweep = 0; sweep < sweeps; sweep++) {
    const downwards = sweep % 2 === 0;
    const indices = current.map((_, index) => index);
    for (const index of downwards ? indices : [...indices].reverse()) {
      const fixedIndex = downwards ? index - 1 : index + 1;
      const fixed = current[fixedIndex];
      if (!fixed) {
        continue;
      }

      const positions = new Map<string, number>();
      fixed.forEach((node, position) => positions.set(keyOf(node.ref), position));

      const layer = current[index];
      const barycentres = new Map<string, number>();
      layer.forEach((node, position) => {
        const neighbours = (adjacency.get(keyOf(node.ref)) ?? [])
          .map((neighbour) => positions.get(neighbour))
          .filter((value): value is number => value !== undefined);
        barycentres.set(
          keyOf(node.ref),
          neighbours.length === 0
            ? position
            : neighbours.reduce((sum, value) => sum + value, 0) / neighbours.length,
        );
      });

      // Array.prototype.sort is stable in ES2019 and later, which the spec requires.
      layer.sort((a, b) => barycentres.get(keyOf(a.ref))! - barycentres.get(keyOf(b.ref))!);
    }
    current = current.map((layer) => [...layer]);
  }

  return current;
}

/**
 * Compares by UTF-16 code unit, matching Kotlin's `String.compareTo`. `localeCompare` would
 * order some strings differently depending on the machine's locale, which would put the
 * conformance corpus at the mercy of where it runs.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
