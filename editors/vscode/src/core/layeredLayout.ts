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
  /**
   * The logical layers, top first, each in its contract order. A layer can be drawn as more
   * than one row (see `layoutGraph`), so this -- not grouping `nodes` by y -- is what the
   * conformance goldens record.
   */
  readonly layers: readonly (readonly string[])[];
  /** One box per System drawn as a container, around its header node and its members. */
  readonly clusters: readonly ClusterBox[];
}

/** A System drawn as a container, in graph coordinates. */
export interface ClusterBox {
  readonly system: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const EMPTY_LAYOUT: GraphLayout = {
  nodes: new Map(),
  width: 0,
  height: 0,
  layers: [],
  clusters: [],
};

/** How wide and tall a node should be drawn. Supplied by the caller so measurement stays there. */
export type NodeSizer = (node: CatalogNode) => { width: number; height: number };

export interface LayoutOptions {
  readonly horizontalGap?: number;
  readonly verticalGap?: number;
  readonly margin?: number;
  readonly orderingSweeps?: number;
  readonly hierarchyGap?: number;
  /** Rows wider than this wrap onto several; undefined never wraps. See `wrap`. */
  readonly maxRowWidth?: number;
  /**
   * Entity key to the key of the System drawn as its container; absent or empty draws none.
   * Presentation only, like the row splits -- the logical layers are unchanged.
   */
  readonly clusters?: ReadonlyMap<string, string>;
  readonly clusterPadding?: number;
  readonly clusterGap?: number;
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
 *
 * A layer that contains its own hierarchy -- Groups with a `parent`, Components with a
 * `subcomponentOf`, an AiResource plugin and its `skills` -- is then drawn as several rows, parents above children, so those edges run
 * vertically instead of along a single row through their siblings. That split is presentation
 * only: the layer and its order, which the conformance contract pins, are unchanged.
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
  const hierarchyGap = options.hierarchyGap ?? 56;
  const clusterPadding = options.clusterPadding ?? 14;
  const clusterGap = options.clusterGap ?? 40;
  const clusters = options.clusters ?? new Map<string, string>();

  const layers = orderLayers(layerNodes(graph), adjacencyOf(graph), orderingSweeps);

  const sizes = new Map<string, { width: number; height: number }>();
  for (const [key, node] of graph.nodes) {
    sizes.set(key, sizer(node));
  }
  const size = (node: CatalogNode) => sizes.get(keyOf(node.ref))!;
  const packedWidth = (nodes: readonly CatalogNode[]): number =>
    nodes.length === 0
      ? 0
      : nodes.reduce((sum, node) => sum + size(node).width, 0) + horizontalGap * (nodes.length - 1);
  const pack = (nodes: readonly CatalogNode[], startX: number, y: number): NodeBounds[] => {
    let x = startX;
    return nodes.map((node) => {
      const { width, height } = size(node);
      const bounds = { node, x, y, width, height };
      x += width + horizontalGap;
      return bounds;
    });
  };

  const systems = new Set([...clusters.values()].filter((system) => graph.nodes.has(system)));
  const clusterOf = (node: CatalogNode): string | undefined => {
    const key = keyOf(node.ref);
    const system = clusters.get(key);
    if (system !== undefined && systems.has(system)) {
      return system;
    }
    return systems.has(key) ? key : undefined;
  };
  const columns = layers.flat().map((node) => keyOf(node.ref)).filter((key) => systems.has(key));

  /**
   * Splits a row wider than `maxRowWidth` into balanced rows, keeping its order. Off when
   * Systems are drawn as containers: their columns already narrow each System, and wrapping
   * inside a column would break the box.
   */
  const wrap = (row: CatalogNode[]): CatalogNode[][] => {
    const limit = options.maxRowWidth;
    if (limit === undefined || columns.length > 0 || row.length < 2) {
      return [row];
    }
    const width = packedWidth(row);
    if (width <= limit) {
      return [row];
    }
    // Width alone underestimates: balanced chunks round up, so add rows until each one fits.
    for (let count = Math.ceil(width / limit); ; count++) {
      const parts = chunked(row, count);
      if (count >= row.length || parts.every((part) => packedWidth(part) <= limit)) {
        return parts;
      }
    }
  };

  const rows: { nodes: CatalogNode[]; gapAfter: number }[] = [];
  for (const layer of layers) {
    const split = hierarchyRows(layer, graph).flatMap(wrap);
    split.forEach((nodes, index) =>
      rows.push({ nodes, gapAfter: index < split.length - 1 ? hierarchyGap : verticalGap }),
    );
  }

  // Place every row. Without containers each is packed and centred on a common axis. With
  // containers, each System that has members gets a column, in the order the Systems sit in
  // their layer, and every row from the first containing a member to the last puts that
  // System's nodes in its column -- the header in the System row, members below -- so the boxes
  // never overlap. Nodes outside any System share a column on the right. Rows above and below
  // that span are centred as usual.
  const clusteredRows = rows
    .map((row, index) => (row.nodes.some((node) => clusterOf(node) !== undefined) ? index : -1))
    .filter((index) => index >= 0);
  const spanStart = clusteredRows.length > 0 ? clusteredRows[0] : 0;
  const spanEnd = clusteredRows.length > 0 ? clusteredRows[clusteredRows.length - 1] : -1;
  const inSpan = (index: number) => index >= spanStart && index <= spanEnd;
  const spanRows = rows.filter((_, index) => inSpan(index));

  const columnWidth = new Map(
    columns.map((system) => [
      system,
      Math.max(...spanRows.map((row) => packedWidth(row.nodes.filter((n) => clusterOf(n) === system)))),
    ]),
  );
  const freeWidth = Math.max(
    0,
    ...spanRows.map((row) => packedWidth(row.nodes.filter((n) => clusterOf(n) === undefined))),
  );

  const columnStart = new Map<string, number>();
  let cursor = 0;
  for (const system of columns) {
    columnStart.set(system, cursor);
    cursor += columnWidth.get(system)! + clusterPadding * 2 + clusterGap;
  }
  const freeStart = cursor;
  const spanWidth =
    columns.length === 0 ? 0 : freeWidth > 0 ? freeStart + freeWidth : cursor - clusterGap;

  const placed: NodeBounds[][] = [];
  let y = margin;
  let widest = spanWidth;
  rows.forEach((row, index) => {
    if (inSpan(index)) {
      const bounds: NodeBounds[] = [];
      for (const system of columns) {
        const group = row.nodes.filter((node) => clusterOf(node) === system);
        const inner = columnWidth.get(system)!;
        bounds.push(
          ...pack(group, columnStart.get(system)! + clusterPadding + (inner - packedWidth(group)) / 2, y),
        );
      }
      const free = row.nodes.filter((node) => clusterOf(node) === undefined);
      bounds.push(...pack(free, freeStart + (freeWidth - packedWidth(free)) / 2, y));
      placed.push(bounds);
    } else {
      placed.push(pack(row.nodes, 0, y));
      widest = Math.max(widest, packedWidth(row.nodes));
    }
    y += Math.max(0, ...row.nodes.map((node) => size(node).height)) + row.gapAfter;
  });

  // Rows outside the container span are centred; rows inside it already use its columns.
  const spanOffset = margin + (widest - spanWidth) / 2;
  const positioned = new Map<string, NodeBounds>();
  placed.forEach((row, index) => {
    const offset = inSpan(index) ? spanOffset : margin + (widest - packedWidth(rows[index].nodes)) / 2;
    for (const bounds of row) {
      positioned.set(keyOf(bounds.node.ref), { ...bounds, x: bounds.x + offset });
    }
  });

  const boxes: ClusterBox[] = columns.map((system) => {
    const members = [...positioned.values()].filter((bounds) => clusterOf(bounds.node) === system);
    const top = Math.min(...members.map((bounds) => bounds.y)) - clusterPadding;
    const bottomEdge = Math.max(...members.map((bounds) => bottom(bounds))) + clusterPadding;
    return {
      system,
      x: columnStart.get(system)! + spanOffset,
      y: top,
      width: columnWidth.get(system)! + clusterPadding * 2,
      height: bottomEdge - top,
    };
  });

  return {
    nodes: positioned,
    width: widest + margin * 2,
    height: Math.max(0, y - verticalGap + margin),
    layers: layers.map((layer) => layer.map((node) => keyOf(node.ref))),
    clusters: boxes,
  };
}

/** `row` in `count` consecutive chunks whose sizes differ by at most one, larger first. */
function chunked<T>(row: readonly T[], count: number): T[][] {
  const base = Math.floor(row.length / count);
  const extra = row.length % count;
  const parts: T[][] = [];
  let start = 0;
  for (let index = 0; index < count; index++) {
    const size = base + (index < extra ? 1 : 0);
    parts.push(row.slice(start, start + size));
    start += size;
  }
  return parts;
}

/**
 * Splits one ordered layer into rows by hierarchy depth within the layer. Each row keeps the
 * layer's order, then a single barycentre pass against the row above puts children under their
 * parents; a node with no parent in that row keeps its index.
 */
function hierarchyRows(layer: CatalogNode[], graph: CatalogGraph): CatalogNode[][] {
  const inLayer = new Set(layer.map((node) => keyOf(node.ref)));
  const parents = new Map<string, string[]>();
  for (const edge of graph.edges) {
    let child: string;
    let parent: string;
    if (edge.type === 'parentOf' || edge.type === 'hasPart') {
      [child, parent] = [edge.to, edge.from];
    } else if (edge.type === 'childOf' || edge.type === 'partOf') {
      [child, parent] = [edge.from, edge.to];
    } else {
      continue;
    }
    if (child !== parent && inLayer.has(child) && inLayer.has(parent)) {
      parents.set(child, [...(parents.get(child) ?? []), parent]);
    }
  }
  if (parents.size === 0) {
    return [layer];
  }

  const depths = new Map<string, number>();
  const depthOf = (key: string, visiting: ReadonlySet<string>): number => {
    const known = depths.get(key);
    if (known !== undefined) {
      return known;
    }
    // A cycle has no top; the node that closes it is treated as a root.
    if (visiting.has(key)) {
      return 0;
    }
    const above = parents.get(key) ?? [];
    const next = new Set(visiting).add(key);
    const depth = above.length === 0 ? 0 : 1 + Math.max(...above.map((p) => depthOf(p, next)));
    depths.set(key, depth);
    return depth;
  };
  layer.forEach((node) => depthOf(keyOf(node.ref), new Set()));

  const byDepth = new Map<number, CatalogNode[]>();
  for (const node of layer) {
    const depth = depths.get(keyOf(node.ref))!;
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), node]);
  }
  const rows = [...byDepth.keys()].sort((a, b) => a - b).map((depth) => byDepth.get(depth)!);

  for (let index = 1; index < rows.length; index++) {
    const positions = new Map<string, number>();
    rows[index - 1].forEach((node, position) => positions.set(keyOf(node.ref), position));
    const barycentres = new Map<string, number>();
    rows[index].forEach((node, position) => {
      const above = (parents.get(keyOf(node.ref)) ?? [])
        .map((parent) => positions.get(parent))
        .filter((value): value is number => value !== undefined);
      barycentres.set(
        keyOf(node.ref),
        above.length === 0 ? position : above.reduce((sum, value) => sum + value, 0) / above.length,
      );
    });
    rows[index].sort((a, b) => barycentres.get(keyOf(a.ref))! - barycentres.get(keyOf(b.ref))!);
  }
  return rows;
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
