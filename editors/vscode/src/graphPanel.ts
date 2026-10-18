import * as vscode from 'vscode';

import { buildCatalogGraph } from './core/catalogGraphBuilder';
import { readDocuments } from './core/yamlDocuments';
import { toWire } from './core/wire';

/**
 * One webview showing the catalog graph for one document, kept in step with it.
 *
 * A webview beside the editor rather than a custom editor replacing it: the graph is a view of
 * the descriptor, and the descriptor is still edited as YAML. This is the same shape as VS
 * Code's own Markdown preview, which is the interaction users already know.
 *
 * Rebuilds are debounced. The graph is cheap to build, but re-laying it out on every keystroke
 * makes the picture jump while a name is being typed, which is worse than being a moment stale.
 */
export class CatalogGraphPanel {
  private static readonly VIEW_TYPE = 'backstageCatalogGraph.preview';

  /** One panel per document, so re-running the command focuses rather than duplicates. */
  private static readonly open = new Map<string, CatalogGraphPanel>();

  private readonly disposables: vscode.Disposable[] = [];
  private rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  static show(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    column: vscode.ViewColumn,
  ): void {
    const key = document.uri.toString();
    const existing = CatalogGraphPanel.open.get(key);
    if (existing) {
      existing.panel.reveal(column, true);
      existing.scheduleRebuild(0);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CatalogGraphPanel.VIEW_TYPE,
      `Catalog: ${nameOf(document)}`,
      { viewColumn: column, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')],
      },
    );

    CatalogGraphPanel.open.set(key, new CatalogGraphPanel(context, panel, document));
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    private readonly document: vscode.TextDocument,
  ) {
    this.panel.webview.html = this.html();

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: unknown) => this.onMessage(message)),

      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === this.document.uri.toString()) {
          this.scheduleRebuild(this.rebuildDelay());
        }
      }),

      // Follow the caret: the webview selects the entity whose YAML the caret is in.
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor.document.uri.toString() !== this.document.uri.toString()) {
          return;
        }
        void this.panel.webview.postMessage({
          command: 'caret',
          offset: this.document.offsetAt(event.selections[0].active),
        });
      }),

      vscode.workspace.onDidCloseTextDocument((closed) => {
        if (closed.uri.toString() === this.document.uri.toString()) {
          this.panel.dispose();
        }
      }),

      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('backstageCatalogGraph')) {
          this.scheduleRebuild(0);
        }
      }),
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.scheduleRebuild(0);
  }

  private onMessage(message: unknown): void {
    if (!isRecord(message)) {
      return;
    }
    if (message.command === 'navigate' && typeof message.offset === 'number') {
      void this.revealAt(
        message.offset,
        typeof message.end === 'number' ? message.end : undefined,
        message.focus === true,
      );
    }
    if (message.command === 'reload') {
      this.scheduleRebuild(0);
    }
  }

  /**
   * Selects the YAML that defines the entity, in the editor column the graph came from. The
   * caret goes at the top of the selection, so it still sits inside that entity and the graph
   * keeps it selected. Without an end, only the caret moves. Unless `focus`, keyboard focus stays
   * in the graph, so a single click can select without taking the user out of it.
   */
  private async revealAt(offset: number, end?: number, focus = true): Promise<void> {
    const length = this.document.getText().length;
    const clamp = (value: number) => Math.max(0, Math.min(value, length));
    const position = this.document.positionAt(clamp(offset));
    const last = this.document.positionAt(clamp(end ?? offset));
    const editor = await vscode.window.showTextDocument(this.document, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: !focus,
    });
    // Anchor at the end and the active end at the start: the caret is the active end.
    editor.selection = new vscode.Selection(last, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  }

  private scheduleRebuild(delayMs: number): void {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
    }
    this.rebuildTimer = setTimeout(() => this.rebuild(), delayMs);
  }

  private rebuild(): void {
    if (this.disposed) {
      return;
    }
    const graph = buildCatalogGraph(readDocuments(this.document.getText()));
    void this.panel.webview.postMessage({
      command: 'render',
      graph: toWire(graph),
      showExternal: this.showExternal(),
      ownersAsBadges: this.ownersAsBadges(),
    });
  }

  private showExternal(): boolean {
    return vscode.workspace
      .getConfiguration('backstageCatalogGraph')
      .get<boolean>('showExternalReferences', true);
  }

  private ownersAsBadges(): boolean {
    return vscode.workspace
      .getConfiguration('backstageCatalogGraph')
      .get<boolean>('ownersAsBadges', true);
  }

  private rebuildDelay(): number {
    return vscode.workspace
      .getConfiguration('backstageCatalogGraph')
      .get<number>('rebuildDelayMs', 350);
  }

  private html(): string {
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.js'),
    );
    const nonce = randomNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Backstage Catalog Graph</title>
<style>${STYLES}</style>
</head>
<body>
  <header id="toolbar">
    <button id="zoom-in" title="Zoom in">+</button>
    <button id="zoom-out" title="Zoom out">&minus;</button>
    <button id="fit" title="Fit to window">Fit</button>
    <button id="actual" title="Actual size">100%</button>
    <span class="separator"></span>
    <label id="external-toggle" title="Show placeholders for entities referenced by this file but declared elsewhere">
      <input type="checkbox" id="external" checked> External references
    </label>
    <label id="owners-toggle" title="Show each entity's owner as a badge instead of drawing an ownedBy edge to it">
      <input type="checkbox" id="owners" checked> Owners as badges
    </label>
    <label id="focus-toggle" title="Draw only the selected entity and what it is joined to; the focus follows the selection">
      <input type="checkbox" id="focus"> Focus
    </label>
    <span class="separator"></span>
    <button id="reload" title="Reload graph">Reload</button>
    <span id="problems" hidden></span>
    <span id="find-status"></span>
    <input type="search" id="find" placeholder="Find entity" title="Enter for next match, Shift+Enter for previous, Escape to clear" size="14">
  </header>
  <main id="canvas"><svg id="graph" xmlns="http://www.w3.org/2000/svg"></svg></main>
  <footer id="status-bar">
    <span id="legend"></span>
    <span id="status"></span>
  </footer>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    this.disposed = true;
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
    }
    CatalogGraphPanel.open.delete(this.document.uri.toString());
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

function nameOf(document: vscode.TextDocument): string {
  const parts = document.uri.path.split('/');
  return parts[parts.length - 1] || document.uri.path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function randomNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index++) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

const STYLES = `
  :root {
    --node-fill: var(--vscode-editorWidget-background, #ffffff);
    --node-border: var(--vscode-editorWidget-border, #d3d5db);
    --external-border: var(--vscode-descriptionForeground, #8b8b8b);
    --edge: var(--vscode-descriptionForeground, #9aa0aa);
    --accent: var(--vscode-focusBorder, #3574f0);
  }
  html, body { height: 100%; margin: 0; overflow: hidden; }
  body {
    display: flex; flex-direction: column;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  #toolbar, #status-bar {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 8px; flex: 0 0 auto;
  }
  #toolbar { border-bottom: 1px solid var(--node-border); }
  #status-bar {
    border-top: 1px solid var(--node-border);
    justify-content: space-between;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
  }
  #toolbar button {
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid var(--node-border); border-radius: 4px;
    padding: 2px 8px; cursor: pointer; font-family: inherit; font-size: inherit;
  }
  #toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--node-border)); }
  #toolbar label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  .separator { width: 1px; height: 16px; background: var(--node-border); }
  #find {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--node-border)); border-radius: 2px;
    padding: 2px 6px; font-family: inherit; font-size: inherit;
  }
  #find:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  #find-status { color: var(--vscode-descriptionForeground); margin-left: auto; }
  #problems {
    color: var(--vscode-editorWarning-foreground, #cca700);
    margin-left: auto; cursor: help;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50%;
  }
  #canvas { flex: 1 1 auto; overflow: hidden; position: relative; }
  #graph { width: 100%; height: 100%; display: block; cursor: grab; }
  #graph.panning { cursor: grabbing; }
  .node { cursor: pointer; }
  .node rect.body { fill: var(--node-fill); stroke: var(--node-border); stroke-width: 1.2; }
  .node.external rect.body {
    stroke: var(--external-border); stroke-dasharray: 5 4; fill: none;
  }
  .node.selected rect.body { stroke: var(--accent); stroke-width: 2.4; }
  .node.hovered rect.body { stroke: var(--accent); }
  text { font-family: var(--vscode-font-family); }
  text.title { font-weight: 600; font-size: 13px; }
  text.subtitle { font-size: 11px; }
  .node text.title { fill: var(--vscode-foreground); }
  .node.external text.title { font-style: italic; }
  .node text.subtitle { fill: var(--vscode-descriptionForeground); }
  .edge path { fill: none; stroke: var(--relation, var(--edge)); stroke-width: 1.5; }
  .edge.dangling path { stroke-dasharray: 5 4; stroke-width: 1.3; }
  .edge polygon { fill: var(--relation, var(--edge)); }
  .edge text {
    font-size: 10px; fill: var(--vscode-descriptionForeground); text-anchor: middle;
    paint-order: stroke; stroke: var(--vscode-editor-background); stroke-width: 3px;
  }
  .dimmed { opacity: 0.22; }
  /* A highlighted edge keeps its relation colour; the selection thickens it instead. */
  .edge.highlighted path { stroke-width: 2.4; }
  .edge.dangling.highlighted path { stroke-width: 2.2; }
  text.badge { font-size: 10px; }
  .node text.badge { fill: var(--vscode-foreground); }
  .node .badge.external rect { stroke: var(--external-border); stroke-dasharray: 3 2; }
  .node .badge.external text { font-style: italic; }
  #empty-state {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    color: var(--vscode-descriptionForeground); pointer-events: none;
  }
  #legend { display: flex; gap: 12px; flex-wrap: wrap; }
  #legend span { display: inline-flex; align-items: center; gap: 4px; }
  #legend i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  #legend i.relation { width: 12px; height: 2px; border-radius: 1px; }
  #legend b { width: 1px; height: 12px; background: var(--node-border); }
`;
