import { GraphLayout, NodeBounds, centerX } from './layeredLayout';
import { keyOf } from './catalogGraph';

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * Arrow-key movement between nodes, by position on screen rather than by relation, so it goes
 * where the user is looking. Left and right stay in the row; up and down go to the nearest row in
 * that direction, then to the node closest horizontally.
 *
 * Returns the key to select after moving `direction` from `from`: with nothing selected, the
 * first node in reading order; with nowhere to go, `from` itself.
 */
export function step(
  layout: GraphLayout,
  from: string | undefined,
  direction: Direction,
): string | undefined {
  const all = [...layout.nodes.values()];
  const current = from === undefined ? undefined : layout.nodes.get(from);
  if (!current) {
    const first = [...all].sort((a, b) => a.y - b.y || a.x - b.x)[0];
    return first ? keyOf(first.node.ref) : undefined;
  }
  const others = all.filter((bounds) => bounds !== current);

  let next: NodeBounds | undefined;
  if (direction === 'left' || direction === 'right') {
    const row = others.filter(
      (bounds) =>
        bounds.y === current.y && (direction === 'left' ? bounds.x < current.x : bounds.x > current.x),
    );
    next = row.sort((a, b) => (direction === 'left' ? b.x - a.x : a.x - b.x))[0];
  } else {
    const ahead = others.filter((bounds) =>
      direction === 'up' ? bounds.y < current.y : bounds.y > current.y,
    );
    const rowY = ahead.reduce<number | undefined>(
      (best, bounds) =>
        best === undefined || Math.abs(bounds.y - current.y) < Math.abs(best - current.y)
          ? bounds.y
          : best,
      undefined,
    );
    next = ahead
      .filter((bounds) => bounds.y === rowY)
      .sort(
        (a, b) =>
          Math.abs(centerX(a) - centerX(current)) - Math.abs(centerX(b) - centerX(current)),
      )[0];
  }
  return next ? keyOf(next.node.ref) : from;
}
