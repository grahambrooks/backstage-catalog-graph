import * as vscode from 'vscode';

import { isCatalogFileName } from './core/catalogFiles';
import { CatalogGraphPanel } from './graphPanel';

/**
 * Entry point. Registers the two commands and keeps the `isCatalogFile` context key in step
 * with the active editor, which is what puts the toolbar button on catalog files only.
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    // From the explorer's context menu the command receives the file that was right-clicked;
    // from the title bar or the palette it receives nothing and uses the active editor.
    vscode.commands.registerCommand('backstageCatalogGraph.showToSide', (uri?: vscode.Uri) =>
      showFor(context, uri, vscode.ViewColumn.Beside),
    ),
    vscode.commands.registerCommand('backstageCatalogGraph.show', (uri?: vscode.Uri) =>
      showFor(context, uri, vscode.ViewColumn.Active),
    ),
    vscode.window.onDidChangeActiveTextEditor(updateContextKey),
  );

  updateContextKey(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  // Panels are disposed through the context subscriptions and their own onDidDispose.
}

async function showFor(
  context: vscode.ExtensionContext,
  uri: vscode.Uri | undefined,
  column: vscode.ViewColumn,
): Promise<void> {
  const document =
    uri instanceof vscode.Uri
      ? await vscode.workspace.openTextDocument(uri)
      : vscode.window.activeTextEditor?.document;
  if (!document) {
    void vscode.window.showInformationMessage('Open a catalog-info.yaml first.');
    return;
  }
  if (!isCatalogDocument(document)) {
    void vscode.window.showInformationMessage(
      `${fileNameOf(document.uri)} is not a Backstage catalog descriptor. ` +
        'Expected catalog-info.yaml, *.catalog-info.yaml, catalog-all.yaml or catalog-entities.yaml.',
    );
    return;
  }
  CatalogGraphPanel.show(context, document, column);
}

function updateContextKey(editor: vscode.TextEditor | undefined): void {
  void vscode.commands.executeCommand(
    'setContext',
    'backstageCatalogGraph.isCatalogFile',
    editor !== undefined && isCatalogDocument(editor.document),
  );
}

function isCatalogDocument(document: vscode.TextDocument): boolean {
  return isCatalogFileName(fileNameOf(document.uri));
}

function fileNameOf(uri: vscode.Uri): string {
  const parts = uri.path.split('/');
  return parts[parts.length - 1] ?? '';
}
