import { GraphLayout, NodeBounds, bottom, centerX, right } from './layeredLayout';

/** A point in graph coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The path one edge takes: `points` from the source anchor to the target anchor, with waypoints
 * where the edge must thread between nodes to cross a row. `sameRow` edges are drawn as an arc
 * over their row instead, so they never run through the nodes between their ends.
 */
export interface Route {
  readonly points: readonly Point[];
  readonly sameRow: boolean;
}

interface Band {
  readonly top: number;
  readonly bottom: number;
  readonly nodes: readonly NodeBounds[];
}

/**
 * Routes edges around nodes, the same way as the JetBrains `EdgeRouter`. Plain geometry over a
 * finished layout, so it is tested without a UI.
 *
 * Rows are bands of nodes sharing a top edge. An edge between different rows leaves the bottom
 * or top centre of its source and enters the facing side of its target. For each row strictly
 * between them, where the straight line would cross a node, the edge is sent straight down (or
 * up) through the nearest gap in that row instead: one waypoint just outside each side of the
 * row, so its diagonal legs stay in the empty space between rows.
 */
export class EdgeRouter {
  private readonly bands: Band[];

  constructor(
    layout: GraphLayout,
    private readonly clearance = 8,
  ) {
    const byTop = new Map<number, NodeBounds[]>();
    for (const bounds of layout.nodes.values()) {
      byTop.set(bounds.y, [...(byTop.get(bounds.y) ?? []), bounds]);
    }
    this.bands = [...byTop.keys()]
      .sort((a, b) => a - b)
      .map((top) => {
        const nodes = [...byTop.get(top)!].sort((a, b) => a.x - b.x);
        return { top, bottom: Math.max(...nodes.map(bottom)), nodes };
      });
  }

  route(from: NodeBounds, to: NodeBounds): Route {
    if (Math.abs(from.y - to.y) < 1) {
      return {
        points: [
          { x: centerX(from), y: from.y },
          { x: centerX(to), y: to.y },
        ],
        sameRow: true,
      };
    }
    const down = to.y > from.y;
    const start = { x: centerX(from), y: down ? bottom(from) : from.y };
    const end = { x: centerX(to), y: down ? to.y : bottom(to) };

    const low = Math.min(start.y, end.y);
    const high = Math.max(start.y, end.y);
    const between = this.bands.filter((band) => band.top > low && band.bottom < high);
    if (!down) {
      between.reverse();
    }

    const points: Point[] = [start];
    for (const band of between) {
      const previous = points[points.length - 1];
      const near = down ? band.top : band.bottom;
      const far = down ? band.bottom : band.top;
      // Where the straight line to the end would enter and leave this row.
      const xNear = xAt(previous, end, near);
      const xFar = xAt(previous, end, far);
      const left = Math.min(xNear, xFar) - this.clearance;
      const rightEdge = Math.max(xNear, xFar) + this.clearance;
      if (band.nodes.some((node) => right(node) > left && node.x < rightEdge)) {
        const gap = this.nearestGap(band, (xNear + xFar) / 2);
        const step = down ? this.clearance : -this.clearance;
        points.push({ x: gap, y: near - step }, { x: gap, y: far + step });
      }
    }
    points.push(end);
    return { points, sameRow: false };
  }

  /** The x of the gap in `band` nearest `x`: between two nodes, or beside the row's ends. */
  private nearestGap(band: Band, x: number): number {
    const nodes = band.nodes;
    const candidates = [nodes[0].x - this.clearance * 2];
    for (let index = 0; index + 1 < nodes.length; index++) {
      const gapStart = right(nodes[index]);
      const gapEnd = nodes[index + 1].x;
      if (gapEnd - gapStart >= this.clearance * 2) {
        candidates.push((gapStart + gapEnd) / 2);
      }
    }
    candidates.push(right(nodes[nodes.length - 1]) + this.clearance * 2);
    return candidates.reduce((best, candidate) =>
      Math.abs(candidate - x) < Math.abs(best - x) ? candidate : best,
    );
  }
}

function xAt(a: Point, b: Point, y: number): number {
  return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
}
