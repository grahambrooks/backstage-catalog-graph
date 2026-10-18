import {
  CatalogGraph,
  CatalogNode,
  EMPTY_GRAPH,
  declaredNodes,
  entityAt,
  externalNodes,
  isDangling,
  isEmpty,
  neighbourhoodOf,
} from '../core/catalogGraph';
import { EdgeRouter, Point, Route } from '../core/edgeRouter';
import { Direction, step } from '../core/navigation';
import { OutlineEntity, OutlineRelation, outlineOf } from '../core/outline';
import { systemClusters } from '../core/systemClusters';
import {
  ClusterBox,
  EMPTY_LAYOUT,
  GraphLayout,
  NodeBounds,
  centerX,
  centerY,
  layoutGraph,
} from '../core/layeredLayout';
import { focusAround } from '../core/focus';
import { foldOwners } from '../core/ownerBadges';
import { SPEC_RULES } from '../core/relationType';
import { WireGraph, fromWire } from '../core/wire';
import { accentFor, relationColour, tintFor } from './palette';

/**
 * The catalog canvas.
 *
 * SVG rather than a `<canvas>`: hit-testing, hover and tooltips come free from the DOM, the
 * result stays crisp at any zoom, and it themes itself from the `--vscode-*` custom properties
 * without the renderer knowing which theme is active.
 *
 * Layout runs here, not in the extension host, because node width depends on measured text.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const NODE_HEIGHT = 52;
const NODE_HEIGHT_WITH_BADGE = 70;
const BADGE_TOP = 47;
const BADGE_HEIGHT = 16;
const BADGE_PADDING = 6;
const BADGE_GAP = 4;
const BADGE_DOT = BADGE_HEIGHT - 8;
/** Padding both sides, the kind dot and the gap after it. */
const BADGE_CHROME = BADGE_PADDING * 2 + BADGE_DOT + BADGE_GAP;
const MIN_NODE_WIDTH = 150;
const MAX_NODE_WIDTH = 320;
const ACCENT_WIDTH = 5;
const TEXT_INSET = 12;
const ARC = 10;
const CURVE_TENSION = 0.45;
const ARC_LIFT = 26;
const MAX_ARC_LIFT = 90;
const CLUSTER_ARC = 18;
/** Wider rows wrap onto several (graph pixels, before zoom); see `wrap` in the layout. */
const MAX_ROW_WIDTH = 1200;
const ARROW_LENGTH = 9;
const ARROW_SPREAD = 0.42;
/** Per wheel notch -- finer than a button press, because notches come in bursts. */
const ZOOM_STEP = 1.12;
/** One click of the toolbar's zoom buttons, or one press of + or -. */
const STEP_ZOOM = 1.2;
// Low enough that Fit to Window can show a catalog of a few dozen entities whole.
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;
const WHEEL_PAN_STEP = 48;
/** Pointer travel, in pixels, beyond which a press is a pan rather than a click. */
const DRAG_SLOP = 4;
const LABEL_SCALE_THRESHOLD = 0.72;

interface Viewport {
  scale: number;
  originX: number;
  originY: number;
}

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

const svg = document.getElementById('graph') as unknown as SVGSVGElement;
const canvas = document.getElementById('canvas') as HTMLElement;
const statusLabel = document.getElementById('status') as HTMLElement;
const legendLabel = document.getElementById('legend') as HTMLElement;
const problemsLabel = document.getElementById('problems') as HTMLElement;
const externalCheckbox = document.getElementById('external') as HTMLInputElement;
const ownersCheckbox = document.getElementById('owners') as HTMLInputElement;
const focusCheckbox = document.getElementById('focus') as HTMLInputElement;
const groupCheckbox = document.getElementById('group') as HTMLInputElement;
const outlineCheckbox = document.getElementById('outline-toggle') as HTMLInputElement;
const outlineView = document.getElementById('outline') as HTMLElement;
const problemList = document.getElementById('problem-list') as HTMLElement;
const findInput = document.getElementById('find') as HTMLInputElement;
const findStatus = document.getElementById('find-status') as HTMLElement;

let graph: CatalogGraph = EMPTY_GRAPH;
let layout: GraphLayout = EMPTY_LAYOUT;
let viewport: Viewport = { scale: 1, originX: 0, originY: 0 };
let selected: string | undefined;
let highlighted = new Set<string>();
let showExternal = true;
let focusMode = false;
let groupBySystem = false;
let showingOutline = false;
/** Each entity's containing System while `groupBySystem` is on; see `systemClusters`. */
let clusters: ReadonlyMap<string, string> = new Map();
let router = new EdgeRouter(EMPTY_LAYOUT);
/** The layout before focus mode cuts it down; Find searches and orders by this one. */
let fullLayout: GraphLayout = layout;
/** The entity under the caret when it last moved, so only a move into another entity reacts. */
let caretEntity: string | undefined;
let matches: string[] = [];
let matchIndex = 0;
let ownersAsBadges = true;
/** Every entity's owners, from the whole graph. */
let allOwners: ReadonlyMap<string, readonly CatalogNode[]> = new Map();
/** Owners drawn as badges: `allOwners` while the toggle is on, otherwise nothing. */
let owners: ReadonlyMap<string, readonly CatalogNode[]> = new Map();

// --- Message plumbing ---------------------------------------------------------------------

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as {
    command?: string;
    graph?: WireGraph;
    showExternal?: boolean;
    ownersAsBadges?: boolean;
    offset?: number;
  };
  if (message.command === 'caret' && typeof message.offset === 'number') {
    followCaret(message.offset);
    return;
  }
  if (message.command !== 'render' || !message.graph) {
    return;
  }
  const hadContent = !isEmpty(graph);
  graph = fromWire(message.graph);
  if (typeof message.showExternal === 'boolean') {
    showExternal = message.showExternal;
    externalCheckbox.checked = showExternal;
  }
  if (typeof message.ownersAsBadges === 'boolean') {
    ownersAsBadges = message.ownersAsBadges;
    ownersCheckbox.checked = ownersAsBadges;
  }
  if (selected && !graph.nodes.has(selected)) {
    select(undefined);
  } else if (selected) {
    // The selection survived the edit, but its neighbours may not have.
    highlighted = neighbourhoodOf(graph, selected);
  }
  render();
  refreshMatches(false);
  if (!hadContent) {
    fitToWindow();
  }
});

// Colours are written into the SVG as attributes, so a theme switch -- which VS Code signals by
// re-stamping the body's classes -- needs a repaint, not just new CSS.
new MutationObserver(() => {
  measureText.clear();
  render();
  renderOutlineIfShowing();
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

function renderOutlineIfShowing(): void {
  if (showingOutline) {
    renderOutline();
  }
}

// --- Toolbar ------------------------------------------------------------------------------

byId('zoom-in').addEventListener('click', () => zoomAround(STEP_ZOOM, centreOfView()));
byId('zoom-out').addEventListener('click', () => zoomAround(1 / (STEP_ZOOM), centreOfView()));
byId('fit').addEventListener('click', () => fitToWindow());
byId('actual').addEventListener('click', () => {
  viewport.scale = 1;
  centreContent();
  applyViewport();
});
byId('reload').addEventListener('click', () => vscode.postMessage({ command: 'reload' }));
externalCheckbox.addEventListener('change', () => {
  showExternal = externalCheckbox.checked;
  render();
  runFind(false);
});
groupCheckbox.addEventListener('change', () => {
  groupBySystem = groupCheckbox.checked;
  render();
  fitToWindow();
  refreshMatches(false);
});
outlineCheckbox.addEventListener('change', () => {
  showingOutline = outlineCheckbox.checked;
  canvas.hidden = showingOutline;
  outlineView.hidden = !showingOutline;
  if (showingOutline) {
    renderOutline();
  }
});
focusCheckbox.addEventListener('change', () => {
  focusMode = focusCheckbox.checked;
  applyFocus();
  draw();
  fitToWindow();
});
ownersCheckbox.addEventListener('change', () => {
  ownersAsBadges = ownersCheckbox.checked;
  render();
  runFind(false);
});
window.addEventListener('resize', () => applyViewport());

// --- Find and caret ------------------------------------------------------------------------

/**
 * Typing selects and reveals the first match; Enter and Shift+Enter step through the rest, and
 * Escape clears the field. Ctrl/Cmd+F anywhere in the panel jumps here.
 */
findInput.addEventListener('input', () => runFind(true));
findInput.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (matches.length > 0) {
      matchIndex = (matchIndex + (event.shiftKey ? -1 : 1) + matches.length) % matches.length;
      runFind(false);
    }
  } else if (event.key === 'Escape') {
    findInput.value = '';
    runFind(true);
    findInput.blur();
  }
});
window.addEventListener('keydown', (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    findInput.focus();
    findInput.select();
  }
});

/**
 * Drawn entities whose title or reference contains the query, ignoring case, in reading order:
 * top row first, then left to right.
 */
function matching(query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  return [...fullLayout.nodes.entries()]
    .filter(
      ([key, bounds]) =>
        bounds.node.title.toLowerCase().includes(needle) || key.includes(needle),
    )
    .sort(([, a], [, b]) => a.y - b.y || a.x - b.x)
    .map(([key]) => key);
}

function runFind(restart: boolean): void {
  refreshMatches(restart);
  const target = matches[matchIndex];
  if (target) {
    reveal(target, true);
  }
}

/**
 * Recomputes the matches and the "2 of 5" status without moving to one -- for when the graph
 * changes under an unchanged query, where jumping would pull the view away mid-edit.
 */
function refreshMatches(restart: boolean): void {
  matches = matching(findInput.value);
  if (restart) {
    matchIndex = 0;
  }
  matchIndex = Math.min(matchIndex, Math.max(0, matches.length - 1));
  findStatus.textContent = !findInput.value.trim()
    ? ''
    : matches.length === 0
      ? 'No matches'
      : `${matchIndex + 1} of ${matches.length}`;
}

/**
 * Follows the caret. It reads the graph already built, and keeps the user's zoom: they chose it,
 * and the caret moves too often to keep changing it.
 */
function followCaret(offset: number): void {
  const node = entityAt(graph, offset);
  const key = node ? keyOf(node) : undefined;
  if (key === caretEntity) {
    return;
  }
  caretEntity = key;
  if (key) {
    reveal(key, false);
  }
}

/**
 * Selects a node and pans to it if it is not already wholly on screen. With `zoomToRead`, a view
 * zoomed out too far to read is first brought back to actual size.
 */
function reveal(key: string, zoomToRead: boolean): void {
  if (!fullLayout.nodes.has(key)) {
    return;
  }
  // Selecting first: in focus mode it re-lays the graph out around `key`.
  select(key);
  const bounds = layout.nodes.get(key);
  if (!bounds) {
    return;
  }
  const rect = svg.getBoundingClientRect();
  const zoomed = zoomToRead && viewport.scale < LABEL_SCALE_THRESHOLD;
  if (zoomed) {
    viewport.scale = 1;
  }
  const left = viewport.originX + bounds.x * viewport.scale;
  const top = viewport.originY + bounds.y * viewport.scale;
  const onScreen =
    left >= 0 &&
    top >= 0 &&
    left + bounds.width * viewport.scale <= rect.width &&
    top + bounds.height * viewport.scale <= rect.height;
  if (zoomed || !onScreen) {
    viewport.originX = rect.width / 2 - centerX(bounds) * viewport.scale;
    viewport.originY = rect.height / 2 - centerY(bounds) * viewport.scale;
  }
  // Crossing the label threshold changes what is drawn, not just where.
  if (zoomed) {
    draw();
  } else {
    applyViewport();
  }
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element;
}

// --- Rendering ----------------------------------------------------------------------------

function visibleGraph(): CatalogGraph {
  if (showExternal) {
    return graph;
  }
  const nodes = new Map([...graph.nodes].filter(([, node]) => !node.external));
  return {
    nodes,
    edges: graph.edges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to)),
    problems: graph.problems,
  };
}

/** The graph after the external and owner toggles, before focus mode cuts it down. */
let unfocused: CatalogGraph = EMPTY_GRAPH;
/** What is drawn: `unfocused`, or in focus mode the selection's neighbourhood. */
let visible: CatalogGraph = EMPTY_GRAPH;

/** Lays out the graph and draws it: for a new graph, a toggle, or a theme change. */
function render(): void {
  relayout();
  draw();
}

/**
 * Everything that depends on the graph and the toggles: owner badges, Systems, and the full
 * layout. Moving the focus does not change any of it, so a focus move only re-runs `applyFocus`
 * -- one small layout instead of the whole graph twice.
 */
function relayout(): void {
  // Badges come from the whole graph: an owner written in this file is a fact about the entity,
  // not a placeholder, so hiding external references does not hide it.
  const folded = foldOwners(graph);
  allOwners = folded.owners;
  owners = ownersAsBadges ? allOwners : new Map();
  const shown = visibleGraph();
  unfocused = !ownersAsBadges ? shown : shown === graph ? folded.graph : foldOwners(shown).graph;
  clusters = groupBySystem ? systemClusters(unfocused) : new Map();
  fullLayout = layoutGraph(unfocused, measure, layoutOptions());
  applyFocus();
}

function layoutOptions() {
  return { maxRowWidth: MAX_ROW_WIDTH, clusters };
}

/** The drawn graph and its layout: the full layout, or in focus mode the selection's neighbourhood. */
function applyFocus(): void {
  const focus = focusMode && selected && unfocused.nodes.has(selected) ? selected : undefined;
  visible = focus
    ? focusAround(
        unfocused,
        focus,
        [...owners].filter(([, list]) => list.some((owner) => keyOf(owner) === focus)).map(([key]) => key),
      )
    : unfocused;
  layout = focus ? layoutGraph(visible, measure, layoutOptions()) : fullLayout;
  router = new EdgeRouter(layout);
}

/**
 * After a focus move: keeps the user's zoom and centres the new neighbourhood if it fits at that
 * zoom, and zooms out only when it does not.
 */
function fitIfNeeded(): void {
  const rect = svg.getBoundingClientRect();
  if (layout.width * viewport.scale <= rect.width && layout.height * viewport.scale <= rect.height) {
    centreContent();
    applyViewport();
  } else {
    fitToWindow();
  }
}

/** Rebuilds the SVG from the current layout -- no layout work. */
function draw(): void {

  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }
  const root = document.createElementNS(SVG_NS, 'g');
  root.setAttribute('id', 'viewport');
  svg.appendChild(root);

  for (const box of layout.clusters) {
    const element = renderCluster(box);
    if (element) {
      root.appendChild(element);
    }
  }
  for (const edge of visible.edges) {
    // Inside a System's box, an edge to that System says what the box already does.
    if (edge.type === 'partOf' && clusters.get(edge.from) === edge.to) {
      continue;
    }
    const element = renderEdge(edge.from, edge.to, edge.type, isDangling(graph, edge));
    if (element) {
      root.appendChild(element);
    }
  }
  for (const bounds of layout.nodes.values()) {
    root.appendChild(renderNode(bounds));
  }

  renderEmptyState(visible);
  renderStatus();
  renderLegend(visible);
  renderProblems();
  if (showingOutline) {
    renderOutline();
  }
  applyViewport();
  applyHighlight();
}

/**
 * Measures a node's width from its text, using an offscreen SVG text element so the numbers
 * match what will actually be painted.
 */
const measureText = (() => {
  const scratch = document.createElementNS(SVG_NS, 'svg');
  scratch.setAttribute('width', '1');
  scratch.setAttribute('height', '1');
  // Off-screen rather than `display: none`: a node that is not laid out has no text length.
  scratch.style.position = 'absolute';
  scratch.style.left = '-9999px';
  scratch.style.top = '0';
  scratch.style.overflow = 'hidden';
  scratch.style.pointerEvents = 'none';
  const text = document.createElementNS(SVG_NS, 'text');
  scratch.appendChild(text);
  document.body.appendChild(scratch);

  // Each measurement forces a synchronous layout, and the same strings are measured on every
  // draw, so widths are remembered. Cleared when the theme changes, in case its font does.
  const widths = new Map<string, number>();
  const measure = (value: string, className: string): number => {
    const key = `${className}\u0000${value}`;
    let width = widths.get(key);
    if (width === undefined) {
      text.setAttribute('class', className);
      text.textContent = value;
      width = text.getComputedTextLength();
      widths.set(key, width);
    }
    return width;
  };
  measure.clear = () => widths.clear();
  return measure;
})();

function measure(node: CatalogNode): { width: number; height: number } {
  const titleWidth = measureText(node.title, 'title');
  const subtitleWidth = measureText(subtitleOf(node), 'subtitle');
  const badge = badgeText(keyOf(node));
  const badgeWidth = badge === undefined ? 0 : measureText(badge, 'badge') + BADGE_CHROME;
  const width = Math.max(titleWidth, subtitleWidth, badgeWidth) + TEXT_INSET * 2 + ACCENT_WIDTH;
  return {
    width: Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, width)),
    height: badge === undefined ? NODE_HEIGHT : NODE_HEIGHT_WITH_BADGE,
  };
}

function badgeText(key: string): string | undefined {
  const list = owners.get(key);
  return list && list.length > 0 ? list.map((owner) => owner.title).join(', ') : undefined;
}

function renderNode(bounds: NodeBounds): SVGGElement {
  const node = bounds.node;
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', `node${node.external ? ' external' : ''}`);
  group.dataset.key = keyFor(bounds);

  const tint = document.createElementNS(SVG_NS, 'rect');
  setRect(tint, bounds);
  tint.setAttribute('fill', tintFor(node.kind.displayName, node.external ? 0.09 : 0.16));
  group.appendChild(tint);

  const body = document.createElementNS(SVG_NS, 'rect');
  setRect(body, bounds);
  body.setAttribute('class', 'body');
  body.setAttribute('fill-opacity', node.external ? '0' : '1');
  group.appendChild(body);

  // The accent bar follows the node's rounded left corners and is square on the right, so it
  // sits flush inside the border rather than overhanging it.
  const accent = document.createElementNS(SVG_NS, 'path');
  accent.setAttribute('d', accentPath(bounds));
  accent.setAttribute('fill', accentFor(node.kind.displayName));
  group.appendChild(accent);

  const textX = bounds.x + ACCENT_WIDTH + TEXT_INSET;
  group.appendChild(
    text(textX, bounds.y + 22, truncate(node.title, 'title', bounds.width), 'title'),
  );
  group.appendChild(
    text(
      textX,
      bounds.y + 39,
      truncate(subtitleOf(node), 'subtitle', bounds.width),
      'subtitle',
    ),
  );

  const badge = badgeText(keyFor(bounds));
  if (badge !== undefined) {
    group.appendChild(renderOwnerBadge(bounds, badge));
  }

  const tooltip = document.createElementNS(SVG_NS, 'title');
  tooltip.textContent = tooltipFor(node);
  group.appendChild(tooltip);

  // A click selects the entity here and its YAML in the editor, leaving focus on the graph; a
  // double-click also moves focus to the editor. `detail` is the browser's click count, which
  // survives the redraw a click causes in focus mode, where a `dblclick` listener would not.
  group.addEventListener('click', (event) => {
    event.stopPropagation();
    select(keyFor(bounds));
    navigate(node, event.detail >= 2);
  });
  group.addEventListener('mouseenter', () => group.classList.add('hovered'));
  group.addEventListener('mouseleave', () => group.classList.remove('hovered'));

  return group;
}

/**
 * A pill under the subtitle naming the owner, tinted with the owner's kind. It replaces the
 * `ownedBy` edge, so it carries the same dashed outline when the owner is a placeholder.
 */
function renderOwnerBadge(bounds: NodeBounds, label: string): SVGGElement {
  const owner = (owners.get(keyFor(bounds)) ?? [])[0];
  const kind = owner.kind.displayName;
  const text = truncate(label, 'badge', bounds.width - BADGE_CHROME);
  const x = bounds.x + ACCENT_WIDTH + TEXT_INSET - BADGE_PADDING / 2;
  const y = bounds.y + BADGE_TOP;

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', `badge${owner.external ? ' external' : ''}`);

  const pill = document.createElementNS(SVG_NS, 'rect');
  pill.setAttribute('x', String(x));
  pill.setAttribute('y', String(y));
  pill.setAttribute('width', String(measureText(text, 'badge') + BADGE_CHROME));
  pill.setAttribute('height', String(BADGE_HEIGHT));
  pill.setAttribute('rx', String(BADGE_HEIGHT / 2));
  pill.setAttribute('fill', tintFor(kind, 0.17));
  group.appendChild(pill);

  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', String(x + BADGE_PADDING + BADGE_DOT / 2));
  dot.setAttribute('cy', String(y + BADGE_HEIGHT / 2));
  dot.setAttribute('r', String(BADGE_DOT / 2));
  dot.setAttribute('fill', accentFor(kind));
  group.appendChild(dot);

  const caption = document.createElementNS(SVG_NS, 'text');
  caption.setAttribute('x', String(x + BADGE_PADDING + BADGE_DOT + BADGE_GAP));
  caption.setAttribute('y', String(y + BADGE_HEIGHT / 2));
  caption.setAttribute('dominant-baseline', 'central');
  caption.setAttribute('class', 'badge');
  caption.textContent = text;
  group.appendChild(caption);

  return group;
}

function setRect(rect: SVGRectElement, bounds: NodeBounds): void {
  rect.setAttribute('x', String(bounds.x));
  rect.setAttribute('y', String(bounds.y));
  rect.setAttribute('width', String(bounds.width));
  rect.setAttribute('height', String(bounds.height));
  rect.setAttribute('rx', String(ARC));
  rect.setAttribute('ry', String(ARC));
}

function accentPath(bounds: NodeBounds): string {
  const { x, y, height } = bounds;
  const w = ACCENT_WIDTH;
  return [
    `M ${x + ARC} ${y}`,
    `L ${x + w} ${y}`,
    `L ${x + w} ${y + height}`,
    `L ${x + ARC} ${y + height}`,
    `A ${ARC} ${ARC} 0 0 1 ${x} ${y + height - ARC}`,
    `L ${x} ${y + ARC}`,
    `A ${ARC} ${ARC} 0 0 1 ${x + ARC} ${y}`,
    'Z',
  ].join(' ');
}

function renderEdge(
  fromKey: string,
  toKey: string,
  relation: string,
  dangling: boolean,
): SVGGElement | undefined {
  const from = layout.nodes.get(fromKey);
  const to = layout.nodes.get(toKey);
  if (!from || !to) {
    return undefined;
  }

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', `edge${dangling ? ' dangling' : ''}`);
  // Read by the stylesheet, so a highlighted edge keeps its relation colour.
  group.style.setProperty('--relation', relationColour(relation));
  group.dataset.from = fromKey;
  group.dataset.to = toKey;

  const curves = curvesOf(router.route(from, to));
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute(
    'd',
    [
      `M ${curves[0][0].x} ${curves[0][0].y}`,
      ...curves.map(([, c1, c2, end]) => `C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`),
    ].join(' '),
  );
  group.appendChild(path);
  const last = curves[curves.length - 1];
  group.appendChild(arrowHead(last[2], last[3]));

  if (viewport.scale >= LABEL_SCALE_THRESHOLD) {
    const [p0, p1, p2, p3] = curves[Math.floor(curves.length / 2)];
    const mid = pointOnCurve(p0, p1, p2, p3, 0.5);
    const label = text(mid.x, mid.y + 3, relation, '');
    label.setAttribute('text-anchor', 'middle');
    group.appendChild(label);
  }

  return group;
}

type Curve = [Point, Point, Point, Point];

/**
 * The drawn shape of a route. Between rows, one cubic per leg with vertical tangents at every
 * point, so the edge leaves and enters nodes straight and passes through a row's gap upright.
 * Within a row, a single arc over it, rising further the further apart its ends are.
 */
function curvesOf(route: Route): Curve[] {
  const points = route.points;
  if (route.sameRow) {
    const start = points[0];
    const end = points[points.length - 1];
    const lift = Math.min(MAX_ARC_LIFT, ARC_LIFT + Math.abs(end.x - start.x) * 0.12);
    return [[start, { x: start.x, y: start.y - lift }, { x: end.x, y: end.y - lift }, end]];
  }
  const curves: Curve[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    const [p, q] = [points[index], points[index + 1]];
    const dy = (q.y - p.y) * CURVE_TENSION;
    curves.push([p, { x: p.x, y: p.y + dy }, { x: q.x, y: q.y - dy }, q]);
  }
  return curves;
}

/**
 * A System drawn as a container: a lightly tinted box behind its header node and members,
 * dashed when the System is a placeholder declared elsewhere.
 */
function renderCluster(box: ClusterBox): SVGRectElement | undefined {
  const system = graph.nodes.get(box.system);
  if (!system) {
    return undefined;
  }
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('class', `cluster${system.external ? ' external' : ''}`);
  rect.setAttribute('x', String(box.x));
  rect.setAttribute('y', String(box.y));
  rect.setAttribute('width', String(box.width));
  rect.setAttribute('height', String(box.height));
  rect.setAttribute('rx', String(CLUSTER_ARC));
  rect.setAttribute('fill', tintFor(system.kind.displayName, 0.06));
  rect.setAttribute('stroke', tintFor(system.kind.displayName, 0.45));
  return rect;
}

function arrowHead(
  control: { x: number; y: number },
  tip: { x: number; y: number },
): SVGPolygonElement {
  const angle = Math.atan2(tip.y - control.y, tip.x - control.x);
  const points = [
    `${tip.x},${tip.y}`,
    `${tip.x - ARROW_LENGTH * Math.cos(angle - ARROW_SPREAD)},${tip.y - ARROW_LENGTH * Math.sin(angle - ARROW_SPREAD)}`,
    `${tip.x - ARROW_LENGTH * Math.cos(angle + ARROW_SPREAD)},${tip.y - ARROW_LENGTH * Math.sin(angle + ARROW_SPREAD)}`,
  ].join(' ');
  const polygon = document.createElementNS(SVG_NS, 'polygon');
  polygon.setAttribute('points', points);
  return polygon;
}

function pointOnCurve(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function text(x: number, y: number, value: string, className: string): SVGTextElement {
  const element = document.createElementNS(SVG_NS, 'text');
  element.setAttribute('x', String(x));
  element.setAttribute('y', String(y));
  if (className) {
    element.setAttribute('class', className);
  }
  element.textContent = value;
  return element;
}

// --- Status, legend, problems ---------------------------------------------------------------

function renderEmptyState(visible: CatalogGraph): void {
  const existing = document.getElementById('empty-state');
  if (existing) {
    existing.remove();
  }
  if (!isEmpty(visible)) {
    return;
  }
  const element = document.createElement('div');
  element.id = 'empty-state';
  element.textContent =
    graph.problems.length === 0
      ? 'No Backstage entities found in this file'
      : 'No entities could be read -- see the problems above';
  canvas.appendChild(element);
}

function renderStatus(): void {
  if (selected) {
    const node = graph.nodes.get(selected);
    if (node) {
      statusLabel.textContent = `${node.ref.kind}:${node.ref.namespace}/${node.ref.name}`;
      return;
    }
  }
  if (isEmpty(graph)) {
    statusLabel.textContent = 'No entities';
    return;
  }
  const declared = declaredNodes(graph).length;
  const external = externalNodes(graph).length;
  const relations = graph.edges.length;
  const parts = [
    `${declared} ${declared === 1 ? 'entity' : 'entities'}`,
    `${relations} ${relations === 1 ? 'relation' : 'relations'}`,
  ];
  if (external > 0) {
    parts.push(`${external} external`);
  }
  statusLabel.textContent = parts.join(', ');
}

function renderLegend(visible: CatalogGraph): void {
  const kinds = [...new Map([...visible.nodes.values()].map((n) => [n.kind.displayName, n.kind]))]
    .sort((a, b) => a[1].rank - b[1].rank)
    .map(([name]) => name);
  const present = new Set(visible.edges.map((edge) => edge.type));
  const relations = SPEC_RULES.map((rule) => rule.relation).filter(
    (relation, index, all) => present.has(relation) && all.indexOf(relation) === index,
  );

  const entry = (swatch: HTMLElement, label: string): HTMLElement => {
    const element = document.createElement('span');
    element.append(swatch, document.createTextNode(label));
    return element;
  };
  legendLabel.replaceChildren(
    ...kinds.map((kind) => {
      const swatch = document.createElement('i');
      swatch.style.background = accentFor(kind);
      return entry(swatch, kind);
    }),
    ...(relations.length > 0 ? [document.createElement('b')] : []),
    ...relations.map((relation) => {
      const swatch = document.createElement('i');
      swatch.className = 'relation';
      swatch.style.background = relationColour(relation);
      return entry(swatch, relation);
    }),
  );
}

function renderProblems(): void {
  if (graph.problems.length === 0) {
    problemsLabel.hidden = true;
    return;
  }
  problemsLabel.hidden = false;
  const first = graph.problems[0].message;
  problemsLabel.textContent =
    graph.problems.length === 1 ? first : `${first} (+${graph.problems.length - 1} more)`;
  problemsLabel.title = 'Click to list every problem and jump to it';
  problemList.hidden = true;
}

/**
 * Every problem in a list under the warning. Picking one with a source offset moves the caret
 * there and focuses the editor.
 */
problemsLabel.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!problemList.hidden) {
    problemList.hidden = true;
    return;
  }
  problemList.replaceChildren(
    ...graph.problems.map((problem) => {
      const item = document.createElement('button');
      item.textContent = problem.message;
      item.disabled = problem.sourceOffset === undefined;
      item.addEventListener('click', () => {
        problemList.hidden = true;
        vscode.postMessage({ command: 'navigate', offset: problem.sourceOffset, focus: true });
      });
      return item;
    }),
  );
  problemList.hidden = false;
});
document.addEventListener('click', () => {
  problemList.hidden = true;
});

// --- Outline --------------------------------------------------------------------------------

/**
 * The outline view: the catalog as a tree of kind, entity, then each relation in or out (see
 * `outlineOf`). Clicking an entity selects its YAML, as clicking it in the graph does, and expands
 * or collapses it; clicking a relation goes to the entity at its other end. A double-click also
 * focuses the editor.
 */
function renderOutline(): void {
  const open = new Set(
    Array.from(outlineView.querySelectorAll<HTMLDetailsElement>('details.entity[open]')).map(
      (element) => element.dataset.key ?? '',
    ),
  );
  outlineView.replaceChildren(
    ...outlineOf(visibleGraph()).map((section) => {
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      summary.className = 'section';
      summary.append(section.kind.displayName, muted(`  ${section.entities.length}`));
      details.append(summary, ...section.entities.map((entity) => outlineEntity(entity, open)));
      return details;
    }),
  );
  markOutlineSelection();
}

function outlineEntity(entity: OutlineEntity, open: ReadonlySet<string>): HTMLElement {
  const key = keyOf(entity.node);
  const details = document.createElement('details');
  details.className = 'entity';
  details.dataset.key = key;
  details.open = open.has(key);
  const summary = document.createElement('summary');
  summary.append(titleOf(entity.node), muted(`  ${key}`));
  if (entity.node.external) {
    summary.append(muted('  external'));
  }
  activate(summary, entity.node);
  details.append(summary, ...entity.relations.map(outlineRelation));
  return details;
}

function outlineRelation(relation: OutlineRelation): HTMLElement {
  const row = document.createElement('div');
  row.className = 'relation';
  const type = document.createElement('span');
  type.textContent = `${relation.type}  `;
  type.style.color = relationColour(relation.type);
  row.append(muted(relation.outgoing ? '→ ' : '← '), type, titleOf(relation.other));
  activate(row, relation.other);
  return row;
}

function activate(element: HTMLElement, node: CatalogNode): void {
  if (node.external) {
    return;
  }
  element.classList.add('link');
  element.addEventListener('click', (event) => {
    // On an entity's summary a click also expands or collapses it. The second click of a
    // double-click must not, or the row would fold straight back up.
    if (event.detail >= 2) {
      event.preventDefault();
    }
    select(keyOf(node));
    navigate(node, event.detail >= 2);
  });
}

function titleOf(node: CatalogNode): HTMLElement {
  const span = document.createElement('span');
  span.textContent = node.title;
  if (node.external) {
    span.className = 'external';
  }
  return span;
}

function muted(value: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'muted';
  span.textContent = value;
  return span;
}

/** Marks and scrolls to the selected entity's row, following the graph's selection. */
function markOutlineSelection(): void {
  for (const element of Array.from(outlineView.querySelectorAll<HTMLElement>('details.entity'))) {
    const isSelected = element.dataset.key === selected;
    element.classList.toggle('selected', isSelected);
    if (isSelected && showingOutline) {
      element.scrollIntoView({ block: 'nearest' });
    }
  }
}

/** Asks the extension to select `node`'s YAML; `focus` also moves focus to the editor. */
function navigate(node: CatalogNode, focus: boolean): void {
  if (node.sourceOffset === undefined) {
    return;
  }
  vscode.postMessage({
    command: 'navigate',
    offset: node.definition?.start ?? node.sourceOffset,
    end: node.definition?.end,
    focus,
  });
}

// --- Keyboard -------------------------------------------------------------------------------

const ARROWS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/**
 * Arrows move the selection to the nearest node that way, selecting its YAML as a click does;
 * Enter also focuses the editor; Escape deselects. Plus, minus and 0 zoom in, out and fit.
 */
canvas.addEventListener('keydown', (event: KeyboardEvent) => {
  const direction = ARROWS[event.key];
  if (direction) {
    const next = step(layout, selected, direction);
    const node = next ? graph.nodes.get(next) : undefined;
    if (next && node) {
      reveal(next, false);
      navigate(node, false);
    }
  } else if (event.key === 'Enter') {
    const node = selected ? graph.nodes.get(selected) : undefined;
    if (node) {
      navigate(node, true);
    }
  } else if (event.key === 'Escape') {
    select(undefined);
  } else if (event.key === '+' || event.key === '=') {
    zoomAround(STEP_ZOOM, centreOfView());
  } else if (event.key === '-') {
    zoomAround(1 / (STEP_ZOOM), centreOfView());
  } else if (event.key === '0') {
    fitToWindow();
  } else {
    return;
  }
  event.preventDefault();
});
svg.addEventListener('pointerdown', () => canvas.focus());

// --- Selection and viewport -------------------------------------------------------------------

function select(key: string | undefined): void {
  const changed = key !== selected;
  selected = key;
  highlighted = key ? neighbourhoodOf(graph, key) : new Set();
  if (focusMode && changed) {
    // The focus follows the selection, so what is drawn changes, not just its emphasis.
    applyFocus();
    draw();
    fitIfNeeded();
  }
  applyHighlight();
  renderStatus();
  markOutlineSelection();
}

// A click on empty canvas deselects -- but not the click that ends a pan, or every drag would
// clear the selection (and, in focus mode, throw the focus away).
let dragged = false;
svg.addEventListener('click', () => {
  if (!dragged) {
    select(undefined);
  }
});

function applyHighlight(): void {
  const active = highlighted.size > 0;
  for (const element of Array.from(svg.querySelectorAll('.node'))) {
    const key = (element as SVGGElement).dataset.key ?? '';
    element.classList.toggle('dimmed', active && !highlighted.has(key));
    element.classList.toggle('selected', key === selected);
  }
  for (const element of Array.from(svg.querySelectorAll('.edge'))) {
    const edge = element as SVGGElement;
    const joined =
      highlighted.has(edge.dataset.from ?? '') && highlighted.has(edge.dataset.to ?? '');
    element.classList.toggle('dimmed', active && !joined);
    element.classList.toggle('highlighted', active && joined);
  }
}

function applyViewport(): void {
  const root = svg.querySelector('#viewport');
  root?.setAttribute(
    'transform',
    `translate(${viewport.originX}, ${viewport.originY}) scale(${viewport.scale})`,
  );
}

function centreOfView(): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  return { x: rect.width / 2, y: rect.height / 2 };
}

function centreContent(): void {
  const rect = svg.getBoundingClientRect();
  viewport.originX = (rect.width - layout.width * viewport.scale) / 2;
  viewport.originY = (rect.height - layout.height * viewport.scale) / 2;
}

function fitToWindow(): void {
  const rect = svg.getBoundingClientRect();
  if (layout.width <= 0 || layout.height <= 0 || rect.width <= 0 || rect.height <= 0) {
    return;
  }
  viewport.scale = Math.min(
    1,
    Math.max(MIN_SCALE, Math.min(rect.width / layout.width, rect.height / layout.height)),
  );
  centreContent();
  applyViewport();
}

/** Zooms about a point in client coordinates, so what is under the cursor stays put. */
function zoomAround(factor: number, anchor: { x: number; y: number }): void {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewport.scale * factor));
  if (next === viewport.scale) {
    return;
  }
  const graphX = (anchor.x - viewport.originX) / viewport.scale;
  const graphY = (anchor.y - viewport.originY) / viewport.scale;
  const wasBelowLabelThreshold = viewport.scale < LABEL_SCALE_THRESHOLD;

  viewport.scale = next;
  viewport.originX = anchor.x - graphX * viewport.scale;
  viewport.originY = anchor.y - graphY * viewport.scale;

  // Edge labels appear and disappear at a threshold, so crossing it needs a re-render.
  if (wasBelowLabelThreshold !== next < LABEL_SCALE_THRESHOLD) {
    draw();
  } else {
    applyViewport();
  }
}

svg.addEventListener(
  'wheel',
  (event: WheelEvent) => {
    event.preventDefault();
    if (!event.ctrlKey && !event.metaKey) {
      const delta = Math.sign(event.deltaY) * WHEEL_PAN_STEP;
      if (event.shiftKey) {
        viewport.originX -= delta;
      } else {
        viewport.originY -= delta;
      }
      applyViewport();
      return;
    }
    const rect = svg.getBoundingClientRect();
    zoomAround(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  },
  { passive: false },
);

let dragAnchor: { x: number; y: number; originX: number; originY: number } | undefined;

svg.addEventListener('pointerdown', (event: PointerEvent) => {
  if (event.button !== 0) {
    return;
  }
  dragged = false;
  // No pointer capture yet: Chromium sends the click that follows a captured press to the
  // capturing element, so capturing here would steal every click from the nodes.
  dragAnchor = {
    x: event.clientX,
    y: event.clientY,
    originX: viewport.originX,
    originY: viewport.originY,
  };
});

svg.addEventListener('pointermove', (event: PointerEvent) => {
  if (!dragAnchor) {
    return;
  }
  if (
    !dragged &&
    Math.abs(event.clientX - dragAnchor.x) + Math.abs(event.clientY - dragAnchor.y) > DRAG_SLOP
  ) {
    // Now it is a pan: capture, so the drag keeps tracking outside the canvas.
    dragged = true;
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('panning');
  }
  if (!dragged) {
    return;
  }
  viewport.originX = dragAnchor.originX + (event.clientX - dragAnchor.x);
  viewport.originY = dragAnchor.originY + (event.clientY - dragAnchor.y);
  applyViewport();
});

for (const type of ['pointerup', 'pointercancel'] as const) {
  svg.addEventListener(type, (event: PointerEvent) => {
    dragAnchor = undefined;
    if (svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
    svg.classList.remove('panning');
  });
}

// --- Text helpers ---------------------------------------------------------------------------

function subtitleOf(node: CatalogNode): string {
  if (node.external) {
    return `${node.kind.displayName} · external`;
  }
  const extras = [node.type, node.lifecycle].filter((value): value is string => Boolean(value));
  return extras.length === 0
    ? node.kind.displayName
    : `${node.kind.displayName} · ${extras.join(' · ')}`;
}

function tooltipFor(node: CatalogNode): string {
  const lines = [node.title, `${node.ref.kind}:${node.ref.namespace}/${node.ref.name}`];
  if (node.description) {
    lines.push('', node.description);
  }
  const facts: string[] = [];
  if (node.type) {
    facts.push(`type: ${node.type}`);
  }
  if (node.lifecycle) {
    facts.push(`lifecycle: ${node.lifecycle}`);
  }
  if (node.tags.length > 0) {
    facts.push(`tags: ${node.tags.join(', ')}`);
  }
  const owned = allOwners.get(keyOf(node));
  if (owned && owned.length > 0) {
    facts.push(`owner: ${owned.map((owner) => keyOf(owner)).join(', ')}`);
  }
  if (facts.length > 0) {
    lines.push('', facts.join(' · '));
  }
  lines.push(
    '',
    node.external
      ? 'Referenced but not defined in this file.'
      : 'Double-click to jump to the definition.',
  );
  return lines.join('\n');
}

/** The longest prefix of `value` that fits with an ellipsis, found by bisection. */
function truncate(value: string, className: string, boxWidth: number): string {
  const available = boxWidth - ACCENT_WIDTH - TEXT_INSET * 2;
  if (measureText(value, className) <= available) {
    return value;
  }
  let low = 1;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measureText(`${value.slice(0, middle)}…`, className) <= available) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${value.slice(0, low)}…`;
}

function keyFor(bounds: NodeBounds): string {
  return keyOf(bounds.node);
}

function keyOf(node: CatalogNode): string {
  return `${node.ref.kind}:${node.ref.namespace}/${node.ref.name}`;
}
