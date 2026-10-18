import {
  CatalogGraph,
  CatalogNode,
  declaredNodes,
  entityAt,
  externalNodes,
  isDangling,
  isEmpty,
  neighbourhoodOf,
} from '../core/catalogGraph';
import {
  GraphLayout,
  NodeBounds,
  bottom,
  centerX,
  centerY,
  layoutGraph,
  right,
} from '../core/layeredLayout';
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
const ARROW_LENGTH = 9;
const ARROW_SPREAD = 0.42;
const ZOOM_STEP = 1.12;
// Low enough that Fit to Window can show a catalog of a few dozen entities whole.
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;
const WHEEL_PAN_STEP = 48;
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
const findInput = document.getElementById('find') as HTMLInputElement;
const findStatus = document.getElementById('find-status') as HTMLElement;

let graph: CatalogGraph = { nodes: new Map(), edges: [], problems: [] };
let layout: GraphLayout = { nodes: new Map(), width: 0, height: 0, layers: [] };
let viewport: Viewport = { scale: 1, originX: 0, originY: 0 };
let selected: string | undefined;
let highlighted = new Set<string>();
let showExternal = true;
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
  }
  render();
  if (!hadContent) {
    fitToWindow();
  }
});

// --- Toolbar ------------------------------------------------------------------------------

byId('zoom-in').addEventListener('click', () => zoomAround(ZOOM_STEP * 1.08, centreOfView()));
byId('zoom-out').addEventListener('click', () => zoomAround(1 / (ZOOM_STEP * 1.08), centreOfView()));
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
  return [...layout.nodes.entries()]
    .filter(
      ([key, bounds]) =>
        bounds.node.title.toLowerCase().includes(needle) || key.includes(needle),
    )
    .sort(([, a], [, b]) => a.y - b.y || a.x - b.x)
    .map(([key]) => key);
}

function runFind(restart: boolean): void {
  matches = matching(findInput.value);
  if (restart) {
    matchIndex = 0;
  }
  matchIndex = Math.min(matchIndex, Math.max(0, matches.length - 1));
  const target = matches[matchIndex];
  if (target) {
    reveal(target, true);
  }
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
  const bounds = layout.nodes.get(key);
  if (!bounds) {
    return;
  }
  select(key);
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
    render();
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

/** What is actually laid out and painted: the graph after the external and owner toggles. */
function drawnGraph(): CatalogGraph {
  // Badges come from the whole graph: an owner written in this file is a fact about the entity,
  // not a placeholder, so hiding external references does not hide it.
  allOwners = foldOwners(graph).owners;
  owners = ownersAsBadges ? allOwners : new Map();
  return ownersAsBadges ? foldOwners(visibleGraph()).graph : visibleGraph();
}

function render(): void {
  const visible = drawnGraph();
  layout = layoutGraph(visible, measure);

  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }
  const root = document.createElementNS(SVG_NS, 'g');
  root.setAttribute('id', 'viewport');
  svg.appendChild(root);

  for (const edge of visible.edges) {
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

  return (value: string, className: string): number => {
    text.setAttribute('class', className);
    text.textContent = value;
    return text.getComputedTextLength();
  };
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

  group.addEventListener('click', (event) => {
    event.stopPropagation();
    select(selected === keyFor(bounds) ? undefined : keyFor(bounds));
  });
  group.addEventListener('dblclick', (event) => {
    event.stopPropagation();
    if (node.sourceOffset !== undefined) {
      vscode.postMessage({
        command: 'navigate',
        offset: node.definition?.start ?? node.sourceOffset,
        end: node.definition?.end,
      });
    }
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

  const [start, end] = anchors(from, to);
  const control1 = { x: start.x, y: start.y + (end.y - start.y) * CURVE_TENSION };
  const control2 = { x: end.x, y: end.y - (end.y - start.y) * CURVE_TENSION };

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute(
    'd',
    `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`,
  );
  group.appendChild(path);
  group.appendChild(arrowHead(control2, end));

  if (viewport.scale >= LABEL_SCALE_THRESHOLD) {
    const mid = pointOnCurve(start, control1, control2, end, 0.5);
    const label = text(mid.x, mid.y + 3, relation, '');
    label.setAttribute('text-anchor', 'middle');
    group.appendChild(label);
  }

  return group;
}

/**
 * Picks which side of each node the edge leaves and enters. Relations run both up (a component
 * to its system) and down (a component to its owning group), so anchoring purely bottom-to-top
 * would draw half the edges backwards through their own nodes.
 */
function anchors(
  from: NodeBounds,
  to: NodeBounds,
): [{ x: number; y: number }, { x: number; y: number }] {
  const sameLayer = Math.abs(centerY(from) - centerY(to)) < 1;
  if (sameLayer) {
    return centerX(to) >= centerX(from)
      ? [
          { x: right(from), y: centerY(from) },
          { x: to.x, y: centerY(to) },
        ]
      : [
          { x: from.x, y: centerY(from) },
          { x: right(to), y: centerY(to) },
        ];
  }
  return centerY(to) > centerY(from)
    ? [
        { x: centerX(from), y: bottom(from) },
        { x: centerX(to), y: to.y },
      ]
    : [
        { x: centerX(from), y: from.y },
        { x: centerX(to), y: bottom(to) },
      ];
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
  problemsLabel.title = graph.problems.map((problem) => problem.message).join('\n');
}

// --- Selection and viewport -------------------------------------------------------------------

function select(key: string | undefined): void {
  selected = key;
  highlighted = key ? neighbourhoodOf(graph, key) : new Set();
  applyHighlight();
  renderStatus();
}

svg.addEventListener('click', () => select(undefined));

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
    render();
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
  dragAnchor = {
    x: event.clientX,
    y: event.clientY,
    originX: viewport.originX,
    originY: viewport.originY,
  };
  svg.setPointerCapture(event.pointerId);
  svg.classList.add('panning');
});

svg.addEventListener('pointermove', (event: PointerEvent) => {
  if (!dragAnchor) {
    return;
  }
  viewport.originX = dragAnchor.originX + (event.clientX - dragAnchor.x);
  viewport.originY = dragAnchor.originY + (event.clientY - dragAnchor.y);
  applyViewport();
});

for (const type of ['pointerup', 'pointercancel'] as const) {
  svg.addEventListener(type, (event: PointerEvent) => {
    dragAnchor = undefined;
    svg.releasePointerCapture(event.pointerId);
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

function truncate(value: string, className: string, boxWidth: number): string {
  const available = boxWidth - ACCENT_WIDTH - TEXT_INSET * 2;
  if (measureText(value, className) <= available) {
    return value;
  }
  let end = value.length;
  while (end > 1 && measureText(`${value.slice(0, end)}…`, className) > available) {
    end--;
  }
  return `${value.slice(0, end)}…`;
}

function keyFor(bounds: NodeBounds): string {
  return keyOf(bounds.node);
}

function keyOf(node: CatalogNode): string {
  return `${node.ref.kind}:${node.ref.namespace}/${node.ref.name}`;
}
